import { Hono } from 'hono'
import { cors } from 'hono/cors'
import OpenAI from 'openai'

type Bindings = {
  CORS_ORIGINS?: string
}

const HF_SPACES = {
  zImage: 'https://luca115-z-image-turbo.hf.space',
  qwen: 'https://mcp-tools-qwen-image-fast.hf.space',
  upscaler: 'https://tuan2308-upscaler.hf.space',
}

function extractCompleteEventData(sseStream: string): unknown {
  const lines = sseStream.split('\n')
  let isCompleteEvent = false

  for (const line of lines) {
    if (line.startsWith('event:')) {
      const eventType = line.substring(6).trim()
      if (eventType === 'complete') {
        isCompleteEvent = true
      } else if (eventType === 'error') {
        throw new Error('Quota exhausted, please set HF Token')
      } else {
        isCompleteEvent = false
      }
    } else if (line.startsWith('data:') && isCompleteEvent) {
      const jsonData = line.substring(5).trim()
      return JSON.parse(jsonData)
    }
  }
  throw new Error(`No complete event in response: ${sseStream.substring(0, 200)}`)
}

async function callGradioApi(baseUrl: string, endpoint: string, data: unknown[], hfToken?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`

  const queue = await fetch(`${baseUrl}/gradio_api/call/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })

  if (!queue.ok) throw new Error(`Queue request failed: ${queue.status}`)

  const queueData = await queue.json() as { event_id?: string }
  if (!queueData.event_id) throw new Error('No event_id returned')

  const result = await fetch(`${baseUrl}/gradio_api/call/${endpoint}/${queueData.event_id}`, { headers })
  const text = await result.text()

  return extractCompleteEventData(text) as unknown[]
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

app.use('/*', async (c, next) => {
  const origins = c.env?.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000']
  return cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-API-Key', 'X-HF-Token'],
  })(c, next)
})

app.get('/', (c) => {
  return c.json({ message: 'Z-Image API is running' })
})

app.post('/generate', async (c) => {
  const apiKey = c.req.header('X-API-Key')
  if (!apiKey) {
    return c.json({ error: 'API Key is required' }, 401)
  }

  let body: {
    prompt: string
    negative_prompt?: string
    model?: string
    width?: number
    height?: number
    num_inference_steps?: number
  }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Input validation
  if (!body.prompt || typeof body.prompt !== 'string') {
    return c.json({ error: 'prompt is required and must be a string' }, 400)
  }
  if (body.prompt.length > 10000) {
    return c.json({ error: 'prompt exceeds maximum length of 10000' }, 400)
  }

  const width = body.width ?? 1024
  const height = body.height ?? 1024
  const steps = body.num_inference_steps ?? 9

  if (width < 256 || width > 2048 || height < 256 || height > 2048) {
    return c.json({ error: 'width and height must be between 256 and 2048' }, 400)
  }
  if (steps < 1 || steps > 50) {
    return c.json({ error: 'num_inference_steps must be between 1 and 50' }, 400)
  }

  const client = new OpenAI({
    baseURL: 'https://ai.gitee.com/v1',
    apiKey: apiKey.trim(),
  })

  try {
    const response = await client.images.generate({
      prompt: body.prompt,
      model: body.model || 'z-image-turbo',
      size: `${width}x${height}` as '1024x1024',
      // @ts-expect-error extra_body is supported by OpenAI SDK
      extra_body: {
        negative_prompt: body.negative_prompt || '',
        num_inference_steps: steps,
      },
    })

    const imageData = response.data?.[0]
    if (!imageData || (!imageData.url && !imageData.b64_json)) {
      return c.json({ error: 'No image returned from API' }, 500)
    }

    return c.json({
      url: imageData.url,
      b64_json: imageData.b64_json,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image generation failed'
    return c.json({ error: message }, 500)
  }
})

app.post('/generate-hf', async (c) => {
  let body: { prompt: string; width?: number; height?: number; model?: string; seed?: number }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.prompt) return c.json({ error: 'prompt is required' }, 400)

  const hfToken = c.req.header('X-HF-Token')
  const width = body.width ?? 1024
  const height = body.height ?? 1024
  const seed = body.seed ?? Math.floor(Math.random() * 2147483647)
  const baseUrl = body.model === 'qwen' ? HF_SPACES.qwen : HF_SPACES.zImage

  try {
    const data = await callGradioApi(baseUrl, 'generate_image', [body.prompt, height, width, 8, seed, false], hfToken)
    const result = data as Array<{ url?: string } | number>
    const imageUrl = (result[0] as { url?: string })?.url
    if (!imageUrl) return c.json({ error: 'No image returned' }, 500)
    return c.json({ url: imageUrl, seed: result[1] })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Generation failed' }, 500)
  }
})

app.post('/upscale', async (c) => {
  let body: { url: string; scale?: number }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.url) return c.json({ error: 'url is required' }, 400)

  const hfToken = c.req.header('X-HF-Token')
  const scale = body.scale ?? 4

  try {
    const data = await callGradioApi(
      HF_SPACES.upscaler,
      'realesrgan',
      [
        { path: body.url, meta: { _type: 'gradio.FileData' } },
        'RealESRGAN_x4plus',
        0.5,
        false,
        scale
      ],
      hfToken
    )
    const result = data as Array<{ url?: string }>
    const imageUrl = result[0]?.url
    if (!imageUrl) return c.json({ error: 'No image returned' }, 500)
    return c.json({ url: imageUrl })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Upscale failed' }, 500)
  }
})

export default app
