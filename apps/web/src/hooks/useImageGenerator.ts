/**
 * Image Generator Hook
 *
 * Core state management and API calls for image generation
 */

import type { ImageDetails } from '@z-image/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { generateImage, optimizePrompt, translatePrompt, upscaleImage } from '@/lib/api'
import {
  ASPECT_RATIOS,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_PROMPT,
  getDefaultLLMModel,
  getDefaultModel,
  getEffectiveSystemPrompt,
  getModelsByProvider,
  type LLMProviderType,
  type LLMSettings,
  loadLLMSettings,
  loadSettings,
  PROVIDER_CONFIGS,
  type ProviderType,
  saveLLMSettings,
  saveSettings,
} from '@/lib/constants'
import { encryptAndStoreToken, loadAllTokens, loadTokensArray } from '@/lib/crypto'
import type { ImageHistoryItem } from '@/lib/historyStore'
import { saveToHistory } from '@/lib/historyStore'
import { parseTokens } from '@/lib/tokenRotation'

const IMAGE_DETAILS_KEY = 'lastImageDetails'

type ImageDetailsWithMeta = ImageDetails & { historyId?: string; generatedAt?: number }

export function useImageGenerator() {
  const [tokens, setTokens] = useState<Record<ProviderType, string>>({
    gitee: '',
    huggingface: '',
    modelscope: '',
  })
  const [provider, setProvider] = useState<ProviderType>(
    () => loadSettings().provider ?? 'huggingface'
  )
  const [model, setModel] = useState(() => loadSettings().model ?? 'z-image-turbo')
  const [prompt, setPrompt] = useState(() => loadSettings().prompt ?? DEFAULT_PROMPT)
  const [negativePrompt, setNegativePrompt] = useState(
    () => loadSettings().negativePrompt ?? DEFAULT_NEGATIVE_PROMPT
  )
  const [width, setWidth] = useState(() => loadSettings().width ?? 1024)
  const [height, setHeight] = useState(() => loadSettings().height ?? 1024)
  const [steps, setSteps] = useState(() => loadSettings().steps ?? 9)
  const [loading, setLoading] = useState(false)
  const [imageDetails, setImageDetails] = useState<ImageDetailsWithMeta | null>(() => {
    try {
      const stored = localStorage.getItem(IMAGE_DETAILS_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [historyId, setHistoryId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(IMAGE_DETAILS_KEY)
      if (!stored) return null
      const parsed = JSON.parse(stored) as ImageDetailsWithMeta
      return parsed?.historyId || null
    } catch {
      return null
    }
  })
  const [generatedAt, setGeneratedAt] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(IMAGE_DETAILS_KEY)
      if (!stored) return null
      const parsed = JSON.parse(stored) as ImageDetailsWithMeta
      return typeof parsed?.generatedAt === 'number' ? parsed.generatedAt : null
    } catch {
      return null
    }
  })
  const [status, setStatus] = useState('Ready.')
  const [elapsed, setElapsed] = useState(0)
  const [selectedRatio, setSelectedRatio] = useState(() => loadSettings().selectedRatio ?? '1:1')
  const [uhd, setUhd] = useState(() => loadSettings().uhd ?? false)
  const [upscale8k] = useState(() => loadSettings().upscale8k ?? false)
  const [showInfo, setShowInfo] = useState(false)
  const [isBlurred, setIsBlurred] = useState(() => localStorage.getItem('isBlurred') === 'true')
  const [isUpscaled, setIsUpscaled] = useState(false)
  const [isUpscaling, setIsUpscaling] = useState(false)
  const initialized = useRef(false)

  // LLM Settings for prompt optimization
  const [llmSettings, setLLMSettings] = useState<LLMSettings>(loadLLMSettings)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)

  // Get current token for selected provider
  const currentToken = tokens[provider]

  // Get models for current provider
  const availableModels = getModelsByProvider(provider)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      loadAllTokens().then(setTokens)
    }
  }, [])

  // Update model when provider changes
  useEffect(() => {
    const models = getModelsByProvider(provider)
    if (!models.find((m) => m.id === model)) {
      setModel(getDefaultModel(provider))
    }
  }, [provider, model])

  useEffect(() => {
    if (initialized.current) {
      saveSettings({
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        selectedRatio,
        uhd,
        upscale8k,
        provider,
        model,
      })
    }
  }, [prompt, negativePrompt, width, height, steps, selectedRatio, uhd, upscale8k, provider, model])

  useEffect(() => {
    if (imageDetails) {
      localStorage.setItem(IMAGE_DETAILS_KEY, JSON.stringify(imageDetails))
    } else {
      localStorage.removeItem(IMAGE_DETAILS_KEY)
    }
  }, [imageDetails])

  useEffect(() => {
    localStorage.setItem('isBlurred', String(isBlurred))
  }, [isBlurred])

  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const timer = setInterval(() => setElapsed((e) => e + 0.1), 100)
    return () => clearInterval(timer)
  }, [loading])

  const saveToken = async (p: ProviderType, token: string) => {
    setTokens((prev) => ({ ...prev, [p]: token }))
    await encryptAndStoreToken(p, token)
    if (token) toast.success(`${PROVIDER_CONFIGS[p].name} token saved`)
  }

  const addStatus = useCallback((msg: string) => {
    setStatus((prev) => `${prev}\n${msg}`)
  }, [])

  const handleRatioSelect = (ratio: (typeof ASPECT_RATIOS)[number]) => {
    setSelectedRatio(ratio.label)
    const preset = uhd ? ratio.presets[1] : ratio.presets[0]
    setWidth(preset.w)
    setHeight(preset.h)
  }

  const handleUhdToggle = (enabled: boolean) => {
    setUhd(enabled)
    const ratio = ASPECT_RATIOS.find((r) => r.label === selectedRatio)
    if (ratio) {
      const preset = enabled ? ratio.presets[1] : ratio.presets[0]
      setWidth(preset.w)
      setHeight(preset.h)
    }
  }

  const handleDownload = async () => {
    if (!imageDetails?.url) return
    const { downloadImage } = await import('@/lib/utils')
    await downloadImage(imageDetails.url, `zenith-${Date.now()}.png`, imageDetails.provider)
  }

  const handleUpscale = async () => {
    if (!imageDetails?.url || isUpscaling || isUpscaled) return
    setIsUpscaling(true)
    addStatus('Upscaling to 4x...')

    // Get HuggingFace tokens array for rotation
    const hfTokens = parseTokens(tokens.huggingface)
    const result = await upscaleImage(
      imageDetails.url,
      4,
      hfTokens.length > 0 ? hfTokens : undefined
    )

    if (result.success && result.data.url) {
      setImageDetails((prev) => (prev ? { ...prev, url: result.data.url as string } : null))
      setIsUpscaled(true)
      addStatus('4x upscale complete!')
      toast.success('Image upscaled to 4x!')
    } else {
      addStatus(`Upscale failed: ${result.success ? 'No URL returned' : result.error}`)
      toast.error('Upscale failed')
    }

    setIsUpscaling(false)
  }

  const handleDelete = () => {
    setImageDetails(null)
    setHistoryId(null)
    setGeneratedAt(null)
    setIsUpscaled(false)
    setIsBlurred(false)
    setShowInfo(false)
    toast.success('Image deleted')
  }

  const handleLoadFromHistory = useCallback((item: ImageHistoryItem) => {
    setProvider(item.providerId)
    setModel(item.modelId)
    setPrompt(item.prompt)
    setNegativePrompt(item.negativePrompt || '')
    setWidth(item.width)
    setHeight(item.height)
    setSteps(item.steps)

    setHistoryId(item.id)
    setGeneratedAt(item.timestamp)
    setIsUpscaled(false)
    setIsBlurred(false)
    setShowInfo(false)

    setImageDetails({
      url: item.url,
      provider: item.providerName,
      model: item.modelName,
      dimensions: `${item.width} x ${item.height}`,
      duration: item.duration || '',
      seed: item.seed,
      steps: item.steps,
      prompt: item.prompt,
      negativePrompt: item.negativePrompt || '',
      historyId: item.id,
      generatedAt: item.timestamp,
    })
    toast.success('Loaded from history')
  }, [])

  const handleGenerate = async () => {
    const providerConfig = PROVIDER_CONFIGS[provider]
    const providerTokens = parseTokens(currentToken)

    if (providerConfig.requiresAuth && providerTokens.length === 0) {
      toast.error(`Please configure your ${providerConfig.name} token first`)
      return
    }

    setLoading(true)
    setImageDetails(null)
    setHistoryId(null)
    setGeneratedAt(null)
    setIsUpscaled(false)
    setIsBlurred(false)
    setShowInfo(false)
    setStatus('Initializing...')

    try {
      addStatus(`Sending request to ${providerConfig.name}...`)

      const result = await generateImage(
        {
          provider,
          prompt,
          negativePrompt,
          width,
          height,
          steps,
          model,
        },
        { tokens: providerTokens.length > 0 ? providerTokens : undefined }
      )

      if (!result.success) {
        throw new Error(result.error)
      }

      const details = result.data.imageDetails
      if (!details?.url) throw new Error('No image returned')
      addStatus(`Image generated in ${details.duration}!`)

      // Auto upscale to 8K if enabled
      if (upscale8k && details.url.startsWith('http')) {
        addStatus('Upscaling to 8K...')
        const hfTokens = parseTokens(tokens.huggingface)
        const upResult = await upscaleImage(
          details.url,
          4,
          hfTokens.length > 0 ? hfTokens : undefined
        )

        if (upResult.success && upResult.data.url) {
          details.url = upResult.data.url
          addStatus('8K upscale complete!')
        } else {
          addStatus(`8K upscale failed: ${upResult.success ? 'No URL' : upResult.error}`)
          toast.error('8K upscale failed, showing original image')
        }
      }

      const now = Date.now()
      const newHistoryId = saveToHistory({
        url: details.url,
        prompt: details.prompt,
        negativePrompt: details.negativePrompt,
        providerId: provider,
        providerName: details.provider,
        modelId: model,
        modelName: details.model,
        width,
        height,
        steps: details.steps,
        seed: details.seed,
        duration: details.duration,
        source: 'home',
      })

      setHistoryId(newHistoryId)
      setGeneratedAt(now)
      setImageDetails({ ...details, historyId: newHistoryId, generatedAt: now })
      toast.success('Image generated!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred'
      addStatus(`Error: ${msg}`)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // LLM Settings handlers
  const updateLLMSettings = useCallback((updates: Partial<LLMSettings>) => {
    setLLMSettings((prev) => {
      const newSettings = { ...prev, ...updates }
      saveLLMSettings(newSettings)
      return newSettings
    })
  }, [])

  const setLLMProvider = useCallback(
    (provider: LLMProviderType) => {
      updateLLMSettings({
        llmProvider: provider,
        llmModel: getDefaultLLMModel(provider),
      })
    },
    [updateLLMSettings]
  )

  const setLLMModel = useCallback(
    (model: string) => {
      updateLLMSettings({ llmModel: model })
    },
    [updateLLMSettings]
  )

  const setAutoTranslate = useCallback(
    (enabled: boolean) => {
      updateLLMSettings({ autoTranslate: enabled })
    },
    [updateLLMSettings]
  )

  const setCustomSystemPrompt = useCallback(
    (prompt: string) => {
      updateLLMSettings({ customSystemPrompt: prompt })
    },
    [updateLLMSettings]
  )

  const setTranslateProvider = useCallback(
    (provider: LLMProviderType) => {
      updateLLMSettings({
        translateProvider: provider,
        translateModel: getDefaultLLMModel(provider),
      })
    },
    [updateLLMSettings]
  )

  const setTranslateModel = useCallback(
    (model: string) => {
      updateLLMSettings({ translateModel: model })
    },
    [updateLLMSettings]
  )

  const setCustomOptimizeConfig = useCallback(
    (config: Partial<{ baseUrl: string; apiKey: string; model: string }>) => {
      setLLMSettings((prev) => {
        const newSettings = {
          ...prev,
          customOptimizeConfig: { ...prev.customOptimizeConfig, ...config },
        }
        saveLLMSettings(newSettings)
        return newSettings
      })
    },
    []
  )

  const setCustomTranslateConfig = useCallback(
    (config: Partial<{ baseUrl: string; apiKey: string; model: string }>) => {
      setLLMSettings((prev) => {
        const newSettings = {
          ...prev,
          customTranslateConfig: { ...prev.customTranslateConfig, ...config },
        }
        saveLLMSettings(newSettings)
        return newSettings
      })
    },
    []
  )

  // Get tokens for LLM provider (maps llm provider to token provider)
  const getTokensForLLMProvider = useCallback(
    async (llmProvider: LLMProviderType): Promise<string[]> => {
      switch (llmProvider) {
        case 'gitee-llm':
          return loadTokensArray('gitee')
        case 'modelscope-llm':
          return loadTokensArray('modelscope')
        case 'huggingface-llm':
          return loadTokensArray('huggingface')
        case 'deepseek':
          return loadTokensArray('deepseek')
        default:
          return []
      }
    },
    []
  )

  const getLLMTokens = useCallback(async (): Promise<string[]> => {
    return getTokensForLLMProvider(llmSettings.llmProvider)
  }, [llmSettings.llmProvider, getTokensForLLMProvider])

  const getTranslateTokens = useCallback(async (): Promise<string[]> => {
    return getTokensForLLMProvider(llmSettings.translateProvider)
  }, [llmSettings.translateProvider, getTokensForLLMProvider])

  // Optimize prompt handler
  const handleOptimize = useCallback(async () => {
    if (!prompt.trim() || isOptimizing) return

    setIsOptimizing(true)
    addStatus('Optimizing prompt...')

    try {
      const tokens = await getLLMTokens()
      const result = await optimizePrompt(
        {
          prompt,
          provider: llmSettings.llmProvider,
          model:
            llmSettings.llmProvider === 'custom'
              ? llmSettings.customOptimizeConfig.model
              : llmSettings.llmModel,
          lang: 'en',
          systemPrompt: getEffectiveSystemPrompt(llmSettings.customSystemPrompt),
          customConfig:
            llmSettings.llmProvider === 'custom' ? llmSettings.customOptimizeConfig : undefined,
        },
        tokens.length > 0 ? tokens : undefined
      )

      if (result.success) {
        setPrompt(result.data.optimized)
        addStatus('Prompt optimized!')
        toast.success('Prompt optimized!')
      } else {
        addStatus(`Optimization failed: ${result.error}`)
        toast.error(result.error)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Optimization failed'
      addStatus(`Error: ${msg}`)
      toast.error(msg)
    } finally {
      setIsOptimizing(false)
    }
  }, [prompt, isOptimizing, llmSettings, getLLMTokens, addStatus])

  // Translate prompt handler
  const handleTranslate = useCallback(async () => {
    if (!prompt.trim() || isTranslating) return

    setIsTranslating(true)
    addStatus('Translating prompt...')

    try {
      const tokens = await getTranslateTokens()
      const result = await translatePrompt(
        {
          prompt,
          provider: llmSettings.translateProvider,
          model:
            llmSettings.translateProvider === 'custom'
              ? llmSettings.customTranslateConfig.model
              : llmSettings.translateModel,
          customConfig:
            llmSettings.translateProvider === 'custom'
              ? llmSettings.customTranslateConfig
              : undefined,
        },
        tokens.length > 0 ? tokens : undefined
      )

      if (result.success) {
        setPrompt(result.data.translated)
        addStatus('Prompt translated!')
        toast.success('Prompt translated to English!')
      } else {
        addStatus(`Translation failed: ${result.error}`)
        toast.error(result.error)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Translation failed'
      addStatus(`Error: ${msg}`)
      toast.error(msg)
    } finally {
      setIsTranslating(false)
    }
  }, [prompt, isTranslating, llmSettings, getTranslateTokens, addStatus])

  return {
    // State
    tokens,
    currentToken,
    provider,
    model,
    availableModels,
    prompt,
    negativePrompt,
    width,
    height,
    steps,
    loading,
    imageDetails,
    status,
    elapsed,
    selectedRatio,
    uhd,
    showInfo,
    isBlurred,
    isUpscaled,
    isUpscaling,
    // LLM State
    llmSettings,
    isOptimizing,
    isTranslating,
    // Setters
    setProvider,
    setModel,
    setPrompt,
    setNegativePrompt,
    setWidth,
    setHeight,
    setSteps,
    setShowInfo,
    setIsBlurred,
    // LLM Setters
    setLLMProvider,
    setLLMModel,
    setTranslateProvider,
    setTranslateModel,
    setAutoTranslate,
    setCustomSystemPrompt,
    setCustomOptimizeConfig,
    setCustomTranslateConfig,
    // Handlers
    saveToken,
    handleRatioSelect,
    handleUhdToggle,
    handleDownload,
    handleUpscale,
    handleDelete,
    handleGenerate,
    handleLoadFromHistory,
    historyId,
    generatedAt,
    // LLM Handlers
    handleOptimize,
    handleTranslate,
  }
}
