/**
 * E2E test: send a real image to the /stream endpoint via the Nian proxy
 * and verify the model returns a meaningful image description.
 *
 * Run: pnpm test:e2e:image
 *
 * Requires:
 *   - SHENNIAN_REAL_E2E=1
 *   - ~/.shennian/config.json with a valid machineToken
 *   - The token owner has Nian model entitlement and credits
 *   - Server deployed and reachable
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CONFIG_PATH = path.join(os.homedir(), '.shennian', 'config.json')

function loadConfig(): { machineToken?: string; serverUrl?: string } {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
}

// A 32x32 solid red PNG — DashScope requires at least 10x10
const TINY_RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NMQEAAAjDMMC/ZzDBvlRA01vZJvwHAAAAAAAAAAAAbx2jxAE/i2AjOgAAAABJRU5ErkJggg=='

const realE2eEnabled = process.env.SHENNIAN_REAL_E2E === '1'

describe.runIf(realE2eEnabled)('E2E: image analysis via /stream', () => {
  it('returns a text response when given an image in tool result (JSON-serialized)', async () => {
    const config = loadConfig()
    if (!config.machineToken) {
      console.warn('Skipping E2E test: no machineToken in ~/.shennian/config.json')
      return
    }

    const serverUrl = (config.serverUrl ?? 'https://shennian.ai').replace(/\/$/, '')

    // Simulate the exact message sequence pi-agent-core sends:
    // 1. User asks about an image
    // 2. Assistant calls read_image tool
    // 3. Tool returns JSON-serialized ImageContent (the real bug scenario)
    const messages = [
      { role: 'user', content: '请描述这张图片的内容' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '让我看看这张图片。' },
          {
            type: 'toolCall',
            id: 'call_test_001',
            name: 'read_image',
            arguments: { path: '/tmp/test.png' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call_test_001',
        toolName: 'read_image',
        // This is exactly how pi-agent-core serializes it:
        // ImageContent wrapped in a JSON string inside TextContent
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              content: [
                { type: 'image', data: TINY_RED_PNG_B64, mimeType: 'image/png' },
              ],
            }),
          },
        ],
        isError: false,
      },
    ]

    const body = {
      model: { id: 'qwen-plus', provider: 'shennian-proxy', api: 'openai-completions' },
      context: {
        systemPrompt: '你是一个图片分析助手。描述用户给你的图片。',
        messages,
        tools: [
          {
            name: 'read_image',
            description: 'Read an image file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      },
      options: { temperature: 0.7, maxTokens: 512 },
    }

    const response = await fetch(`${serverUrl}/api/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.machineToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error(`[E2E] HTTP ${response.status}: ${errBody}`)
    }
    expect(response.ok).toBe(true)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    // Read SSE stream and collect text deltas
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let fullText = ''
    let gotStart = false
    let gotDone = false
    let gotError = false
    let errorMessage = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data) continue

        try {
          const event = JSON.parse(data) as {
            type: string
            delta?: string
            errorMessage?: string
          }
          if (event.type === 'start') gotStart = true
          if (event.type === 'text_delta' && event.delta) fullText += event.delta
          if (event.type === 'done') gotDone = true
          if (event.type === 'error') {
            gotError = true
            errorMessage = event.errorMessage ?? ''
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    console.log('[E2E] Model response:', fullText.slice(0, 500))
    if (gotError) console.error('[E2E] Error:', errorMessage)

    expect(gotError).toBe(false)

    expect(gotStart).toBe(true)
    expect(gotDone).toBe(true)
    // Model should return some text describing the image (even if it's just a 1x1 red pixel)
    expect(fullText.length).toBeGreaterThan(5)
  }, 60_000)
})
