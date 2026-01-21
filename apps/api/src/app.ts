/**
 * Z-Image API - Platform Agnostic Hono App
 *
 * This module exports a platform-agnostic Hono app that can be used
 * with any runtime (Node.js, Cloudflare Workers, Deno, Bun, etc.)
 */

import {
  DEFAULT_OPTIMIZE_SYSTEM_PROMPT,
  DEFAULT_TRANSLATE_SYSTEM_PROMPT,
  Errors,
  type GenerateRequest,
  type GenerateSuccessResponse,
  getModelByProviderAndId,
  getModelsByProvider,
  HF_SPACES,
  type ImageDetails,
  isAllowedImageUrl,
  LLM_PROVIDER_CONFIGS,
  type LLMProviderType,
  MODEL_CONFIGS,
  type OptimizeRequest,
  type OptimizeResponse,
  PROVIDER_CONFIGS,
  type ProviderType,
  type TranslateRequest,
  type TranslateResponse,
  type VideoGenerateRequest,
  validateDimensions,
  validatePrompt,
  validateScale,
  validateSteps,
} from '@z-image/shared'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getLLMProvider, hasLLMProvider } from './llm-providers'
import {
  bodyLimit,
  errorHandler,
  notFoundHandler,
  rateLimitPresets,
  requestId,
  requestLogger,
  securityHeaders,
  sendError,
  timeout,
} from './middleware'
import { registerOpenAIRoutes } from './openai/routes'
import { getProvider, hasProvider } from './providers'
import { createVideoTask, getVideoTaskStatus } from './providers/gitee'
import { callGradioApi, formatDimensions, formatDuration } from './utils'

export interface AppConfig {
  corsOrigins?: string[]
}

function createCorsMiddleware(origins: string[]) {
  return cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-HF-Token',
      'X-MS-Token',
      'X-DeepSeek-Token',
      'X-Request-ID',
    ],
  })
}

function createApiApp(config: AppConfig = {}) {
  const app = new Hono().basePath('/api')

  // Default CORS origins for development
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000']
  const origins = config.corsOrigins || defaultOrigins

  // Pre-create CORS middleware instance (optimization)
  const corsMiddleware = createCorsMiddleware(origins)

  // Global error handlers
  app.onError(errorHandler)
  app.notFound(notFoundHandler)

  // Apply middleware in correct order
  app.use('/*', requestId) // Request ID first for logging
  app.use('/*', corsMiddleware)
  app.use('/*', securityHeaders)
  app.use('/*', requestLogger)

  // Apply timeout to all generation endpoints (120 seconds)
  app.use('/generate', timeout(120000))
  app.use('/generate-hf', timeout(120000))
  app.use('/upscale', timeout(120000))
  app.use('/optimize', timeout(60000)) // 60 seconds for LLM
  app.use('/translate', timeout(30000)) // 30 seconds for translation
  app.use('/video/generate', timeout(30000)) // 30 seconds for video task creation
  app.use('/video/status/*', timeout(30000)) // 30 seconds for status check

  // Apply body limit (50KB for most endpoints)
  app.use('/generate', bodyLimit(50 * 1024))
  app.use('/generate-hf', bodyLimit(50 * 1024))
  app.use('/upscale', bodyLimit(50 * 1024))
  app.use('/optimize', bodyLimit(50 * 1024))
  app.use('/translate', bodyLimit(20 * 1024)) // 20KB for translation
  app.use('/video/generate', bodyLimit(50 * 1024))

  // Apply rate limiting to prevent abuse
  app.use('/generate', rateLimitPresets.generate) // 10 req/min
  app.use('/generate-hf', rateLimitPresets.generate) // 10 req/min
  app.use('/upscale', rateLimitPresets.generate) // 10 req/min
  app.use('/optimize', rateLimitPresets.optimize) // 20 req/min
  app.use('/translate', rateLimitPresets.optimize) // 20 req/min
  app.use('/video/generate', rateLimitPresets.video) // 5 req/min
  app.use('/video/status/*', rateLimitPresets.readonly) // 60 req/min

  // Health check
  app.get('/', (c) => {
    return c.json({
      status: 'ok',
      message: 'Z-Image API is running',
      timestamp: new Date().toISOString(),
    })
  })

  // Get all providers
  app.get('/providers', (c) => {
    const providers = Object.values(PROVIDER_CONFIGS).map((p) => ({
      id: p.id,
      name: p.name,
      requiresAuth: p.requiresAuth,
      authHeader: p.authHeader,
    }))
    return c.json({ providers })
  })

  // Get models by provider
  app.get('/providers/:provider/models', (c) => {
    const provider = c.req.param('provider') as ProviderType
    if (!PROVIDER_CONFIGS[provider]) {
      return c.json({ error: `Invalid provider: ${provider}` }, 400)
    }
    const models = getModelsByProvider(provider).map((m) => ({
      id: m.id,
      name: m.name,
      features: m.features,
    }))
    return c.json({ provider, models })
  })

  // Get all models
  app.get('/models', (c) => {
    const models = MODEL_CONFIGS.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      features: m.features,
    }))
    return c.json({ models })
  })

  // Get all LLM providers
  app.get('/llm-providers', (c) => {
    const providers = Object.values(LLM_PROVIDER_CONFIGS).map((p) => ({
      id: p.id,
      name: p.name,
      needsAuth: p.needsAuth,
      authHeader: p.authHeader,
      models: p.models,
    }))
    return c.json({ providers })
  })

  // Fetch models from custom OpenAI-compatible provider
  app.post('/custom-models', async (c) => {
    let body: { baseUrl: string; apiKey: string }
    try {
      body = await c.req.json()
    } catch {
      return sendError(c, Errors.invalidParams('body', 'Invalid JSON body'))
    }

    const { baseUrl, apiKey } = body

    if (!baseUrl || !apiKey) {
      return sendError(c, Errors.invalidParams('body', 'baseUrl and apiKey are required'))
    }

    // Normalize base URL to get /models endpoint
    let url = baseUrl.trim()
    if (url.endsWith('/')) {
      url = url.slice(0, -1)
    }
    // Remove /chat/completions if present
    if (url.endsWith('/chat/completions')) {
      url = url.slice(0, -'/chat/completions'.length)
    }
    // Ensure /v1 is present
    if (!url.endsWith('/v1')) {
      url = `${url}/v1`
    }
    url = `${url}/models`

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        if (response.status === 401) {
          return sendError(c, Errors.authInvalid('Custom Provider'))
        }
        return sendError(
          c,
          Errors.providerError('Custom Provider', `Failed to fetch models: ${errorText}`)
        )
      }

      const data = (await response.json()) as { data?: Array<{ id: string; owned_by?: string }> }
      const models = (data.data || []).map((m) => ({
        id: m.id,
        name: m.id,
        owned_by: m.owned_by,
      }))

      return c.json({ models })
    } catch (err) {
      return sendError(
        c,
        Errors.providerError(
          'Custom Provider',
          err instanceof Error ? err.message : 'Failed to fetch models'
        )
      )
    }
  })

  // Prompt optimization endpoint
  app.post('/optimize', async (c) => {
    let body: OptimizeRequest
    try {
      body = await c.req.json()
    } catch {
      return sendError(c, Errors.invalidParams('body', 'Invalid JSON body'))
    }

    const {
      prompt,
      provider = 'pollinations',
      lang = 'en',
      model,
      systemPrompt,
      customConfig,
    } = body

    // Validate prompt
    if (!prompt || typeof prompt !== 'string') {
      return sendError(c, Errors.invalidPrompt('Prompt is required'))
    }
    if (prompt.length > 4000) {
      return sendError(c, Errors.invalidPrompt('Prompt must be less than 4000 characters'))
    }

    // Validate provider
    if (!hasLLMProvider(provider)) {
      return sendError(c, Errors.invalidProvider(provider))
    }

    // Get provider config
    const providerConfig = LLM_PROVIDER_CONFIGS[provider as LLMProviderType]

    // Get auth token if required (not needed for custom provider)
    let authToken: string | undefined
    if (provider !== 'custom' && providerConfig.needsAuth && providerConfig.authHeader) {
      authToken = c.req.header(providerConfig.authHeader)
      if (!authToken) {
        return sendError(c, Errors.authRequired(providerConfig.name))
      }
    }

    // Validate custom config for custom provider
    if (provider === 'custom') {
      if (!customConfig?.baseUrl || !customConfig?.apiKey || !customConfig?.model) {
        return sendError(
          c,
          Errors.invalidParams(
            'customConfig',
            'Custom provider requires baseUrl, apiKey, and model'
          )
        )
      }
    }

    // Build final system prompt with language instruction
    const langInstruction = lang === 'zh' ? '请用中文输出。' : 'Ensure the output is in English.'
    const finalSystemPrompt = `${systemPrompt || DEFAULT_OPTIMIZE_SYSTEM_PROMPT}\n\n${langInstruction}`

    try {
      const llmProvider = getLLMProvider(provider as LLMProviderType)

      // Custom provider needs customConfig passed to complete()
      const result =
        provider === 'custom'
          ? await (
              llmProvider as unknown as {
                complete: (
                  req: Parameters<typeof llmProvider.complete>[0],
                  config?: typeof customConfig
                ) => ReturnType<typeof llmProvider.complete>
              }
            ).complete(
              {
                prompt,
                systemPrompt: finalSystemPrompt,
                model: customConfig?.model,
                maxTokens: 1000,
              },
              customConfig
            )
          : await llmProvider.complete({
              prompt,
              systemPrompt: finalSystemPrompt,
              model,
              authToken,
              maxTokens: 1000,
            })

      const response: OptimizeResponse = {
        optimized: result.content,
        provider: provider as LLMProviderType,
        model: result.model,
      }

      return c.json(response)
    } catch (err) {
      return sendError(c, err)
    }
  })

  // Prompt translation endpoint (Chinese to English)
  app.post('/translate', async (c) => {
    let body: TranslateRequest
    try {
      body = await c.req.json()
    } catch {
      return sendError(c, Errors.invalidParams('body', 'Invalid JSON body'))
    }

    const { prompt, provider = 'pollinations', model, customConfig } = body

    // Validate prompt
    if (!prompt || typeof prompt !== 'string') {
      return sendError(c, Errors.invalidPrompt('Prompt is required'))
    }
    if (prompt.length > 2000) {
      return sendError(c, Errors.invalidPrompt('Prompt must be less than 2000 characters'))
    }

    // Validate provider
    if (!hasLLMProvider(provider)) {
      return sendError(c, Errors.invalidProvider(provider))
    }

    // Get provider config
    const providerConfig = LLM_PROVIDER_CONFIGS[provider as LLMProviderType]

    // Get auth token if required (not needed for custom provider)
    let authToken: string | undefined
    if (provider !== 'custom' && providerConfig.needsAuth && providerConfig.authHeader) {
      authToken = c.req.header(providerConfig.authHeader)
      if (!authToken) {
        return sendError(c, Errors.authRequired(providerConfig.name))
      }
    }

    // Validate custom config for custom provider
    if (provider === 'custom') {
      if (!customConfig?.baseUrl || !customConfig?.apiKey || !customConfig?.model) {
        return sendError(
          c,
          Errors.invalidParams(
            'customConfig',
            'Custom provider requires baseUrl, apiKey, and model'
          )
        )
      }
    }

    try {
      const llmProvider = getLLMProvider(provider as LLMProviderType)

      // Custom provider needs customConfig passed to complete()
      const result =
        provider === 'custom'
          ? await (
              llmProvider as unknown as {
                complete: (
                  req: Parameters<typeof llmProvider.complete>[0],
                  config?: typeof customConfig
                ) => ReturnType<typeof llmProvider.complete>
              }
            ).complete(
              {
                prompt,
                systemPrompt: DEFAULT_TRANSLATE_SYSTEM_PROMPT,
                model: customConfig?.model,
                maxTokens: 1000,
                temperature: 0.3,
              },
              customConfig
            )
          : await llmProvider.complete({
              prompt,
              systemPrompt: DEFAULT_TRANSLATE_SYSTEM_PROMPT,
              model,
              authToken,
              maxTokens: 1000,
              temperature: 0.3, // Lower temperature for more accurate translation
            })

      const translateResponse: TranslateResponse = {
        translated: result.content,
        provider: provider as LLMProviderType,
        model: result.model,
      }

      return c.json(translateResponse)
    } catch (err) {
      return sendError(c, err)
    }
  })

  // Unified generate endpoint
  app.post('/generate', async (c) => {
    let body: GenerateRequest & { negative_prompt?: string; num_inference_steps?: number }
    try {
      body = await c.req.json()
    } catch {
      return sendError(c, Errors.invalidParams('body', 'Invalid JSON body'))
    }

    // Determine provider (default to gitee for backward compatibility)
    const providerId = body.provider || 'gitee'
    if (!hasProvider(providerId)) {
      return sendError(c, Errors.invalidProvider(providerId))
    }

    // Get auth token based on provider
    const providerConfig = PROVIDER_CONFIGS[providerId]
    const authToken = c.req.header(providerConfig?.authHeader || 'X-API-Key')

    // Check auth requirement
    if (providerConfig?.requiresAuth && !authToken) {
      return sendError(c, Errors.authRequired(providerConfig.name))
    }

    // Validate prompt
    const promptValidation = validatePrompt(body.prompt)
    if (!promptValidation.valid) {
      return sendError(c, Errors.invalidPrompt(promptValidation.error || 'Invalid prompt'))
    }

    // Validate dimensions
    const width = body.width ?? 1024
    const height = body.height ?? 1024
    const dimensionsValidation = validateDimensions(width, height)
    if (!dimensionsValidation.valid) {
      return sendError(
        c,
        Errors.invalidDimensions(dimensionsValidation.error || 'Invalid dimensions')
      )
    }

    // Validate steps
    const steps = body.steps ?? body.num_inference_steps ?? 9
    const stepsValidation = validateSteps(steps)
    if (!stepsValidation.valid) {
      return sendError(c, Errors.invalidParams('steps', stepsValidation.error || 'Invalid steps'))
    }

    try {
      const startTime = Date.now()
      const provider = getProvider(providerId as ProviderType)
      const result = await provider.generate({
        model: body.model,
        prompt: body.prompt,
        negativePrompt: body.negativePrompt || body.negative_prompt,
        loras: body.loras,
        width,
        height,
        steps,
        seed: body.seed,
        guidanceScale: body.guidanceScale,
        authToken,
      })
      const duration = Date.now() - startTime

      // Get model and provider display names
      const modelConfig = getModelByProviderAndId(providerId as ProviderType, body.model)
      const modelName = modelConfig?.name || body.model
      const providerName = providerConfig?.name || providerId

      const imageDetails: ImageDetails = {
        // Return the raw provider URL; clients may opt into /api/proxy-image for CORS-safe downloads.
        url: result.url,
        provider: providerName,
        model: modelName,
        dimensions: formatDimensions(width, height),
        duration: formatDuration(duration),
        seed: result.seed,
        steps,
        prompt: body.prompt,
        negativePrompt: body.negativePrompt || body.negative_prompt || '',
      }

      const response: GenerateSuccessResponse = { imageDetails }
      return c.json(response)
    } catch (err) {
      return sendError(c, err)
    }
  })

  // Legacy HuggingFace endpoint (for backward compatibility)
  app.post('/generate-hf', async (c) => {
    let body: {
      prompt: string
      width?: number
      height?: number
      model?: string
      seed?: number
      steps?: number
    }
    try {
      body = await c.req.json()
    } catch {
      return sendError(c, Errors.invalidParams('body', 'Invalid JSON body'))
    }

    // Validate prompt
    const promptValidation = validatePrompt(body.prompt)
    if (!promptValidation.valid) {
      return sendError(c, Errors.invalidPrompt(promptValidation.error || 'Invalid prompt'))
    }

    const hfToken = c.req.header('X-HF-Token')
    const width = body.width ?? 1024
    const height = body.height ?? 1024
    const modelId = body.model || 'z-image-turbo'
    const steps = body.steps ?? 9

    const dimensionsValidation = validateDimensions(width, height)
    if (!dimensionsValidation.valid) {
      return sendError(
        c,
        Errors.invalidDimensions(dimensionsValidation.error || 'Invalid dimensions')
      )
    }

    try {
      const startTime = Date.now()
      const provider = getProvider('huggingface')
      const result = await provider.generate({
        model: modelId,
        prompt: body.prompt,
        width,
        height,
        steps,
        seed: body.seed,
        authToken: hfToken,
      })
      const duration = Date.now() - startTime

      // Get model display name
      const modelConfig = getModelByProviderAndId('huggingface', modelId)
      const modelName = modelConfig?.name || modelId

      const imageDetails: ImageDetails = {
        url: result.url,
        provider: 'HuggingFace',
        model: modelName,
        dimensions: formatDimensions(width, height),
        duration: formatDuration(duration),
        seed: result.seed,
        steps,
        prompt: body.prompt,
        negativePrompt: '',
      }

      const response: GenerateSuccessResponse = { imageDetails }
      return c.json(response)
    } catch (err) {
      return sendError(c, err)
    }
  })

  // Upscale endpoint
  app.post('/upscale', async (c) => {
    let body: { url: string; scale?: number }
    try {
      body = await c.req.json()
    } catch {
      return sendError(c, Errors.invalidParams('body', 'Invalid JSON body'))
    }

    if (!body.url || typeof body.url !== 'string') {
      return sendError(c, Errors.invalidParams('url', 'url is required'))
    }

    if (!isAllowedImageUrl(body.url)) {
      return sendError(c, Errors.invalidParams('url', 'URL not allowed'))
    }

    const hfToken = c.req.header('X-HF-Token')
    const scale = body.scale ?? 4

    const scaleValidation = validateScale(scale)
    if (!scaleValidation.valid) {
      return sendError(c, Errors.invalidParams('scale', scaleValidation.error || 'Invalid scale'))
    }

    try {
      const data = await callGradioApi(
        HF_SPACES.upscaler,
        'realesrgan',
        [
          { path: body.url, meta: { _type: 'gradio.FileData' } },
          'RealESRGAN_x4plus',
          0.5,
          false,
          scale,
        ],
        hfToken
      )
      const result = data as Array<{ url?: string }>
      const imageUrl = result[0]?.url
      if (!imageUrl) {
        return sendError(c, Errors.generationFailed('HuggingFace Upscaler', 'No image returned'))
      }
      return c.json({ url: imageUrl })
    } catch (err) {
      return sendError(c, err)
    }
  })

  // Image proxy endpoint (for CORS bypass when downloading external images)
  // Max image size: 10MB
  const MAX_PROXY_IMAGE_SIZE = 10 * 1024 * 1024

  app.get('/proxy-image', async (c) => {
    const url = c.req.query('url')

    if (!url || typeof url !== 'string') {
      return sendError(c, Errors.invalidParams('url', 'url query parameter is required'))
    }

    if (!isAllowedImageUrl(url)) {
      return sendError(c, Errors.invalidParams('url', 'URL not allowed'))
    }

    try {
      const response = await fetch(url)
      if (!response.ok) {
        return sendError(
          c,
          Errors.generationFailed('Image Proxy', `Failed to fetch image: ${response.status}`)
        )
      }

      // Check content length before streaming
      const contentLength = response.headers.get('content-length')
      if (contentLength && Number.parseInt(contentLength, 10) > MAX_PROXY_IMAGE_SIZE) {
        return sendError(
          c,
          Errors.invalidParams(
            'url',
            `Image too large. Maximum size: ${MAX_PROXY_IMAGE_SIZE / 1024 / 1024}MB`
          )
        )
      }

      const contentType = response.headers.get('content-type') || 'image/png'

      // Use streaming response to avoid loading entire image into memory
      return new Response(response.body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
          ...(contentLength && { 'Content-Length': contentLength }),
        },
      })
    } catch (err) {
      return sendError(c, err)
    }
  })

  // Video generation - Create task
  app.post('/video/generate', async (c) => {
    let body: VideoGenerateRequest
    try {
      body = await c.req.json()
    } catch {
      return sendError(c, Errors.invalidParams('body', 'Invalid JSON body'))
    }

    const authToken = c.req.header('X-API-Key')

    if (!authToken) {
      return sendError(c, Errors.authRequired('Gitee AI'))
    }

    if (body.provider !== 'gitee') {
      return c.json({ error: 'Use frontend direct call for HuggingFace' }, 400)
    }

    if (!body.imageUrl || !body.prompt) {
      return sendError(c, Errors.invalidParams('body', 'imageUrl and prompt are required'))
    }

    const dimensionsValidation = validateDimensions(body.width, body.height)
    if (!dimensionsValidation.valid) {
      return sendError(
        c,
        Errors.invalidDimensions(dimensionsValidation.error || 'Invalid dimensions')
      )
    }

    try {
      const taskId = await createVideoTask(
        body.imageUrl,
        body.prompt,
        body.width,
        body.height,
        authToken
      )

      return c.json({ taskId, status: 'pending' })
    } catch (err) {
      return sendError(c, err)
    }
  })

  // Video generation - Query status
  // Recommended polling interval in seconds
  const VIDEO_POLL_INTERVAL = 3

  app.get('/video/status/:taskId', async (c) => {
    const taskId = c.req.param('taskId')
    const authToken = c.req.header('X-API-Key')

    if (!authToken) {
      return sendError(c, Errors.authRequired('Gitee AI'))
    }

    try {
      const result = await getVideoTaskStatus(taskId, authToken)

      // Add Retry-After header for pending/processing status to guide client polling
      if (result.status === 'pending' || result.status === 'processing') {
        c.header('Retry-After', VIDEO_POLL_INTERVAL.toString())
      }

      return c.json(result)
    } catch (err) {
      return sendError(c, err)
    }
  })

  return app
}

function createOpenAIApp(config: AppConfig = {}) {
  const app = new Hono().basePath('/v1')

  const defaultOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000']
  const origins = config.corsOrigins || defaultOrigins
  const corsMiddleware = createCorsMiddleware(origins)

  app.onError(errorHandler)
  app.notFound(notFoundHandler)

  app.use('/*', requestId)
  app.use('/*', corsMiddleware)
  app.use('/*', securityHeaders)
  app.use('/*', requestLogger)

  app.use('/*', timeout(120000))
  app.use('/*', bodyLimit(50 * 1024))
  app.use('/*', rateLimitPresets.generate)

  registerOpenAIRoutes(app)

  return app
}

export function createApp(config: AppConfig = {}) {
  const app = new Hono()
  app.onError(errorHandler)
  app.notFound(notFoundHandler)
  app.route('/', createOpenAIApp(config))
  app.route('/', createApiApp(config))
  return app
}

// Default app instance for simple usage
const app = createApp()

export default app
