/**
 * Gradio API Utilities
 */

import { Errors } from '@z-image/shared'

const PROVIDER_NAME = 'HuggingFace'

/**
 * Parse HuggingFace error message into appropriate ApiError
 */
export function parseHuggingFaceError(message: string, status?: number): Error {
  const lowerMsg = message.toLowerCase()

  // Check for rate limit / queue errors
  if (status === 429 || lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests')) {
    return Errors.rateLimited(PROVIDER_NAME)
  }

  // Check for quota errors
  if (lowerMsg.includes('quota') || lowerMsg.includes('exceeded')) {
    return Errors.quotaExceeded(PROVIDER_NAME)
  }

  // Check for authentication errors
  if (
    status === 401 ||
    status === 403 ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('forbidden')
  ) {
    return Errors.authInvalid(PROVIDER_NAME, message)
  }

  // Check for timeout
  if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out')) {
    return Errors.timeout(PROVIDER_NAME)
  }

  // Check for service unavailable
  if (status === 503 || lowerMsg.includes('unavailable') || lowerMsg.includes('loading')) {
    return Errors.providerError(PROVIDER_NAME, 'Service is temporarily unavailable or loading')
  }

  // Generic provider error
  return Errors.providerError(PROVIDER_NAME, message)
}

/**
 * Extract complete event data from SSE stream
 */
export function extractCompleteEventData(sseStream: string): unknown {
  const lines = sseStream.split('\n')
  let currentEvent = ''

  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.substring(6).trim()
    } else if (line.startsWith('data:')) {
      const jsonData = line.substring(5).trim()
      if (currentEvent === 'complete') {
        // Gradio queue "complete" payload isn't consistent across spaces:
        // some return an array directly, others return an object like { data: [...] }.
        return JSON.parse(jsonData)
      }
      if (currentEvent === 'error') {
        // Parse actual error message from data
        try {
          const errorData = JSON.parse(jsonData)
          const errorMsg =
            errorData?.error || errorData?.message || JSON.stringify(errorData) || 'Unknown error'
          throw parseHuggingFaceError(errorMsg)
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw parseHuggingFaceError(jsonData || 'Unknown SSE error')
          }
          throw e
        }
      }
    }
  }
  // No complete/error event found, show raw response for debugging
  throw Errors.providerError(
    PROVIDER_NAME,
    `Unexpected SSE response: ${sseStream.substring(0, 200)}`
  )
}

/**
 * Call Gradio API with queue mechanism
 */
export async function callGradioApi(
  baseUrl: string,
  endpoint: string,
  data: unknown[],
  hfToken?: string
): Promise<unknown[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`

  const queue = await fetch(`${baseUrl}/gradio_api/call/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })

  if (!queue.ok) {
    const errText = await queue.text().catch(() => '')
    throw parseHuggingFaceError(errText || `Queue request failed: ${queue.status}`, queue.status)
  }

  const queueData = (await queue.json()) as { event_id?: string }
  if (!queueData.event_id) {
    throw Errors.providerError(PROVIDER_NAME, 'No event_id returned from queue')
  }

  const result = await fetch(`${baseUrl}/gradio_api/call/${endpoint}/${queueData.event_id}`, {
    headers,
  })
  if (!result.ok) {
    const errText = await result.text().catch(() => '')
    throw parseHuggingFaceError(errText || `Result request failed: ${result.status}`, result.status)
  }

  const text = await result.text()
  const complete = extractCompleteEventData(text)

  // Normalize the "complete" payload to the common `unknown[]` that providers expect.
  if (Array.isArray(complete)) return complete as unknown[]
  if (
    complete &&
    typeof complete === 'object' &&
    Array.isArray((complete as { data?: unknown }).data)
  ) {
    return (complete as { data: unknown[] }).data
  }

  throw Errors.providerError(
    PROVIDER_NAME,
    `Unexpected complete payload: ${JSON.stringify(complete).slice(0, 200)}`
  )
}
