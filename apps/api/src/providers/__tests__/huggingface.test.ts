/**
 * HuggingFace Provider Tests
 * Tests with mocked fetch - no real API calls
 */

import { ApiErrorCode } from '@z-image/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HuggingFaceProvider } from '../huggingface'
import type { ProviderGenerateRequest } from '../types'

// Default request with all required fields
const defaultRequest: ProviderGenerateRequest = {
  prompt: 'a cat',
  model: 'z-image-turbo',
  width: 1024,
  height: 1024,
}

describe('HuggingFaceProvider', () => {
  const provider = new HuggingFaceProvider()

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('properties', () => {
    it('should have correct id', () => {
      expect(provider.id).toBe('huggingface')
    })

    it('should have correct name', () => {
      expect(provider.name).toBe('HuggingFace')
    })
  })

  // Helper to mock Gradio API flow (queue + result)
  function mockGradioSuccess(imageUrl: string, seed?: number) {
    const mockFetch = vi.mocked(fetch)

    // First call: queue request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ event_id: 'test-event-123' }),
    } as Response)

    // Second call: result with SSE format
    const sseData =
      seed !== undefined
        ? `event: complete\ndata: [{"url": "${imageUrl}"}, ${seed}]\n\n`
        : `event: complete\ndata: [{"url": "${imageUrl}"}]\n\n`

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => sseData,
    } as Response)
  }

  function mockGradioSuccessObjectPayload(imageUrl: string) {
    const mockFetch = vi.mocked(fetch)

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ event_id: 'test-event-123' }),
    } as Response)

    // Some Spaces return an object shape: { data: [...] }
    const sseData = `event: complete\ndata: {"data":[{"url":"${imageUrl}"}]}\n\n`

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => sseData,
    } as Response)
  }

  function mockGradioQueueError(status: number, errorText: string) {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status,
      text: async () => errorText,
    } as Response)
  }

  function mockGradioSSEError(errorMessage: string) {
    const mockFetch = vi.mocked(fetch)

    // Queue succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ event_id: 'test-event-123' }),
    } as Response)

    // Result returns error event
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `event: error\ndata: {"error": "${errorMessage}"}\n\n`,
    } as Response)
  }

  describe('generate - successful request', () => {
    it('should return image URL from Gradio API', async () => {
      mockGradioSuccess('https://hf.space/generated.png', 12345)

      const result = await provider.generate({
        prompt: 'a beautiful landscape',
        model: 'z-image-turbo',
        width: 1024,
        height: 1024,
        steps: 9,
        seed: 12345,
      })

      expect(result.url).toBe('https://hf.space/generated.png')
      expect(result.seed).toBe(12345)
    })

    it('should use default model when not specified', async () => {
      mockGradioSuccess('https://hf.space/img.png')

      const mockFetch = vi.mocked(fetch)
      await provider.generate(defaultRequest)

      // Verify it called the default space URL
      expect(mockFetch.mock.calls[0][0]).toContain('mrfakename-z-image-turbo.hf.space')
    })

    it('should include auth token in headers when provided', async () => {
      mockGradioSuccess('https://hf.space/img.png')

      await provider.generate({
        ...defaultRequest,
        authToken: 'hf_test_token',
      })

      const mockFetch = vi.mocked(fetch)
      const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer hf_test_token')
    })

    it('should work without auth token (public spaces)', async () => {
      mockGradioSuccess('https://hf.space/img.png')

      const result = await provider.generate(defaultRequest)
      expect(result.url).toBe('https://hf.space/img.png')
    })

    it('should handle complete payload returned as an object with data[]', async () => {
      mockGradioSuccessObjectPayload('https://hf.space/img.png')

      const result = await provider.generate(defaultRequest)
      expect(result.url).toBe('https://hf.space/img.png')
    })

    it('should generate random seed if not provided', async () => {
      mockGradioSuccess('https://hf.space/img.png')

      const result = await provider.generate(defaultRequest)

      expect(result.seed).toBeGreaterThan(0)
      expect(result.seed).toBeLessThanOrEqual(2147483647)
    })
  })

  describe('generate - model-specific behavior', () => {
    it('should use correct endpoint for z-image-turbo', async () => {
      mockGradioSuccess('https://hf.space/img.png')

      await provider.generate({
        ...defaultRequest,
        model: 'z-image-turbo',
      })

      const mockFetch = vi.mocked(fetch)
      expect(mockFetch.mock.calls[0][0]).toContain('/gradio_api/call/generate_image')
    })

    it('should parse seed from qwen-image-fast response format', async () => {
      const mockFetch = vi.mocked(fetch)

      // Queue request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ event_id: 'test-123' }),
      } as Response)

      // Qwen returns seed as string: "Seed used for generation: 42"
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          'event: complete\ndata: [{"url": "https://hf.space/img.png"}, "Seed used for generation: 42"]\n\n',
      } as Response)

      const result = await provider.generate({
        ...defaultRequest,
        model: 'qwen-image-fast',
      })

      expect(result.seed).toBe(42)
    })

    it('should normalize relative Gradio file URLs against the space base URL', async () => {
      // Relative URL that some gradio deployments return.
      mockGradioSuccess('/gradio_api/file=generated.png', 123)

      const result = await provider.generate({
        ...defaultRequest,
        model: 'z-image-turbo',
        seed: 123,
      })

      expect(result.url).toBe(
        'https://mrfakename-z-image-turbo.hf.space/gradio_api/file=generated.png'
      )
    })
  })

  describe('generate - error handling', () => {
    it('should handle queue request failure', async () => {
      mockGradioQueueError(500, 'Internal server error')

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.PROVIDER_ERROR,
      })
    })

    it('should handle 429 rate limit error', async () => {
      mockGradioQueueError(429, 'Too many requests')

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.RATE_LIMITED,
      })
    })

    it('should handle 401 unauthorized error', async () => {
      mockGradioQueueError(401, 'Unauthorized')

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.AUTH_INVALID,
      })
    })

    it('should handle 503 service unavailable', async () => {
      mockGradioQueueError(503, 'Service unavailable')

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.PROVIDER_ERROR,
      })
    })

    it('should handle SSE error event', async () => {
      mockGradioSSEError('Generation failed due to NSFW content')

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.PROVIDER_ERROR,
      })
    })

    it('should handle quota exceeded error', async () => {
      // Note: HuggingFace parseHuggingFaceError checks for rate limit (429) first,
      // then for "quota" or "exceeded" in message. Since 429 matches first,
      // "Quota exceeded" with 429 returns RATE_LIMITED. Use different status for QUOTA_EXCEEDED.
      mockGradioQueueError(402, 'Quota exceeded')

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.QUOTA_EXCEEDED,
      })
    })

    it('should handle timeout error message', async () => {
      mockGradioQueueError(504, 'Request timed out')

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.TIMEOUT,
      })
    })

    it('should handle missing event_id in queue response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No event_id
      } as Response)

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.PROVIDER_ERROR,
      })
    })

    it('should handle no image in response', async () => {
      const mockFetch = vi.mocked(fetch)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ event_id: 'test-123' }),
      } as Response)

      // Empty result array
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'event: complete\ndata: [{}]\n\n',
      } as Response)

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.GENERATION_FAILED,
      })
    })

    it('should handle unexpected SSE response format', async () => {
      const mockFetch = vi.mocked(fetch)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ event_id: 'test-123' }),
      } as Response)

      // No complete or error event
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'event: heartbeat\ndata: {}\n\n',
      } as Response)

      await expect(provider.generate(defaultRequest)).rejects.toMatchObject({
        code: ApiErrorCode.PROVIDER_ERROR,
      })
    })
  })
})
