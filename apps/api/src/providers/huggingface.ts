/**
 * HuggingFace Provider Implementation
 */

import { Errors, HF_SPACES } from '@z-image/shared'
import { MAX_INT32 } from '../constants'
import { callGradioApi } from '../utils'
import type { ImageProvider, ProviderGenerateRequest, ProviderGenerateResult } from './types'

function normalizeImageUrl(baseUrl: string, url: string): string {
  try {
    // Handles absolute URLs and relative paths like "/gradio_api/file=..."
    return new URL(url, baseUrl).toString()
  } catch {
    return url
  }
}

/** Parse seed from response based on model */
function parseSeedFromResponse(modelId: string, result: unknown[], fallbackSeed: number): number {
  // Qwen Image Fast returns seed as string: "Seed used for generation: 12345"
  if (modelId === 'qwen-image-fast' && typeof result[1] === 'string') {
    const match = result[1].match(/Seed used for generation:\s*(\d+)/)
    if (match) return Number.parseInt(match[1], 10)
  }
  // Other models return seed as number in data[1]
  if (typeof result[1] === 'number') return result[1]
  return fallbackSeed
}

/** Model-specific Gradio configurations */
const MODEL_CONFIGS: Record<
  string,
  { endpoint: string; buildData: (r: ProviderGenerateRequest, seed: number) => unknown[] }
> = {
  'z-image-turbo': {
    endpoint: 'generate_image',
    buildData: (r, seed) => [r.prompt, r.height, r.width, r.steps ?? 9, seed, false],
  },
  'qwen-image-fast': {
    endpoint: 'generate_image',
    buildData: (r, seed) => [r.prompt, seed, true, '1:1', 3, r.steps ?? 8],
  },
  'ovis-image': {
    endpoint: 'generate',
    buildData: (r, seed) => [r.prompt, r.height, r.width, seed, r.steps ?? 24, 4],
  },
  'flux-1-schnell': {
    endpoint: 'infer',
    buildData: (r, seed) => [r.prompt, seed, false, r.width, r.height, r.steps ?? 8],
  },
}

export class HuggingFaceProvider implements ImageProvider {
  readonly id = 'huggingface'
  readonly name = 'HuggingFace'

  async generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    const seed = request.seed ?? Math.floor(Math.random() * MAX_INT32)
    const modelId = request.model || 'z-image-turbo'
    const baseUrl = HF_SPACES[modelId as keyof typeof HF_SPACES] || HF_SPACES['z-image-turbo']
    const config = MODEL_CONFIGS[modelId] || MODEL_CONFIGS['z-image-turbo']

    // Debug: log model info (uncomment for debugging)
    // console.log(`[HuggingFace] Model: ${modelId}, BaseURL: ${baseUrl}`)

    const data = await callGradioApi(
      baseUrl,
      config.endpoint,
      config.buildData(request, seed),
      request.authToken
    )

    const result = data as Array<{ url?: string } | number | string>
    const first = result[0]
    const rawUrl =
      typeof first === 'string' ? first : (first as { url?: string } | null | undefined)?.url
    const imageUrl = rawUrl ? normalizeImageUrl(baseUrl, rawUrl) : undefined
    if (!imageUrl) {
      throw Errors.generationFailed('HuggingFace', 'No image returned')
    }

    return {
      url: imageUrl,
      seed: parseSeedFromResponse(modelId, result, seed),
    }
  }
}

export const huggingfaceProvider = new HuggingFaceProvider()
