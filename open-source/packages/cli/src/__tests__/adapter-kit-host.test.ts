// @covers open-source/packages/cli/src/adapter-kit/host.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { runAdapterRuntimeHost } from '../adapter-kit/host.js'
import { ADAPTER_PROTOCOL_VERSION } from '../adapter-kit/types.js'

type WireMessage = {
  type: 'response' | 'event'
  id?: string | null
  ok?: boolean
  result?: Record<string, unknown>
  error?: { code: string; message: string }
  requestId?: string
  event?: { state: string; text?: string; message?: string; code?: string; nativeSessionId?: string }
}

let tmpDir: string | null = null

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = null
})

function writeAdapter(source: string): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-kit-host-'))
  const file = path.join(tmpDir, 'adapter.mjs')
  fs.writeFileSync(file, source)
  return file
}

const ECHO_ADAPTER = `
export default {
  name: 'Echo Adapter',
  version: '1.0.0',
  async listModels() {
    return { models: ['model-a', 'model-b'], defaultModel: 'model-a' }
  },
  async start({ sessionId, modelId, systemPrompt }) {
    return { session: { sessionId, modelId, systemPrompt }, nativeSessionId: \`native-\${sessionId}\` }
  },
  async send({ text, output }) {
    output.delta(\`echo:\${text}\`)
    output.final({ inputTokens: 1, outputTokens: 1 })
  },
  async stop() {},
  async resume({ nativeSessionId, systemPrompt }) {
    return { session: { systemPrompt }, nativeSessionId }
  },
}
`

class HostHarness {
  readonly input = new PassThrough()
  readonly messages: WireMessage[] = []
  readonly exitCodes: number[] = []

  constructor(entryPath: string, workDir: string) {
    void runAdapterRuntimeHost({
      entryPath,
      workDir,
      input: this.input,
      write: (message) => this.messages.push(message as WireMessage),
      exit: (code) => this.exitCodes.push(code),
    })
  }

  send(request: Record<string, unknown>): void {
    this.input.write(`${JSON.stringify(request)}\n`)
  }

  sendRaw(line: string): void {
    this.input.write(`${line}\n`)
  }

  async waitForResponse(id: string, timeoutMs = 2000): Promise<WireMessage> {
    return this.waitFor((m) => m.type === 'response' && m.id === id, timeoutMs)
  }

  async waitForTerminal(requestId: string, timeoutMs = 2000): Promise<WireMessage> {
    return this.waitFor(
      (m) => m.type === 'event' && m.requestId === requestId && (m.event?.state === 'final' || m.event?.state === 'error'),
      timeoutMs,
    )
  }

  async waitFor(predicate: (m: WireMessage) => boolean, timeoutMs: number): Promise<WireMessage> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const found = this.messages.find(predicate)
      if (found) return found
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`Timed out waiting for a matching message. Seen: ${JSON.stringify(this.messages)}`)
  }
}

function req(id: string, method: string, params: Record<string, unknown> = {}) {
  return { protocolVersion: ADAPTER_PROTOCOL_VERSION, id, method, params }
}

describe('Adapter Runtime host (protocol V1)', () => {
  it('runs the full listModels -> start -> send -> stop cycle', async () => {
    const entry = writeAdapter(ECHO_ADAPTER)
    const host = new HostHarness(entry, tmpDir as string)

    host.send(req('1', 'listModels', { workDir: tmpDir }))
    const models = await host.waitForResponse('1')
    expect(models.ok).toBe(true)
    expect(models.result?.defaultModel).toBe('model-a')

    host.send(req('2', 'start', { sessionId: 's1', workDir: tmpDir, modelId: 'model-a', systemPrompt: 'be terse' }))
    const started = await host.waitForResponse('2')
    expect(started.ok).toBe(true)
    expect(started.result?.nativeSessionId).toBe('native-s1')

    host.send(req('3', 'send', { modelId: 'model-a', text: 'hi', attachments: [] }))
    const accepted = await host.waitForResponse('3')
    expect(accepted.ok).toBe(true)
    const terminal = await host.waitForTerminal('3')
    expect(terminal.event?.state).toBe('final')
    expect(host.messages.some((m) => m.type === 'event' && m.event?.text === 'echo:hi')).toBe(true)

    host.send(req('4', 'stop', { reason: 'client_stop' }))
    const stopped = await host.waitForResponse('4')
    expect(stopped.ok).toBe(true)
  })

  it('rejects every request with adapter_contract_invalid when a required method is missing', async () => {
    const entry = writeAdapter(`export default { name: 'Broken', version: '1.0.0' }`)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'listModels', { workDir: tmpDir }))
    const response = await host.waitForResponse('1')
    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe('adapter_contract_invalid')
  })

  it('responds invalid_json for a malformed stdin line', async () => {
    const entry = writeAdapter(ECHO_ADAPTER)
    const host = new HostHarness(entry, tmpDir as string)
    host.sendRaw('{not json')
    const response = await host.waitFor((m) => m.type === 'response' && m.error?.code === 'invalid_json', 2000)
    expect(response.id).toBeNull()
  })

  it('responds method_not_found for an unsupported method', async () => {
    const entry = writeAdapter(ECHO_ADAPTER)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'unknownMethod'))
    const response = await host.waitForResponse('1')
    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe('method_not_found')
  })

  it('rejects send before start with session_not_started', async () => {
    const entry = writeAdapter(ECHO_ADAPTER)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'send', { modelId: 'model-a', text: 'hi', attachments: [] }))
    const response = await host.waitForResponse('1')
    expect(response.error?.code).toBe('session_not_started')
  })

  it('rejects start and resume when the required systemPrompt is missing', async () => {
    const entry = writeAdapter(ECHO_ADAPTER)
    const host = new HostHarness(entry, tmpDir as string)

    host.send(req('1', 'start', { sessionId: 's1', workDir: tmpDir, modelId: 'model-a' }))
    const startResponse = await host.waitForResponse('1')
    expect(startResponse.ok).toBe(false)
    expect(startResponse.error?.code).toBe('invalid_request')

    host.send(req('2', 'resume', {
      sessionId: 's2',
      nativeSessionId: 'native-s2',
      workDir: tmpDir,
      modelId: 'model-a',
    }))
    const resumeResponse = await host.waitForResponse('2')
    expect(resumeResponse.ok).toBe(false)
    expect(resumeResponse.error?.code).toBe('invalid_request')
  })

  it('rejects a second start with session_already_started', async () => {
    const entry = writeAdapter(ECHO_ADAPTER)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'start', { sessionId: 's1', workDir: tmpDir, modelId: 'model-a', systemPrompt: 'test prompt' }))
    await host.waitForResponse('1')
    host.send(req('2', 'start', { sessionId: 's2', workDir: tmpDir, modelId: 'model-a', systemPrompt: 'test prompt' }))
    const response = await host.waitForResponse('2')
    expect(response.error?.code).toBe('session_already_started')
  })

  it('rejects a second turn while one is active with turn_active', async () => {
    const entry = writeAdapter(`
      let release
      const gate = new Promise((resolve) => { release = resolve })
      export default {
        name: 'Slow Adapter',
        version: '1.0.0',
        async listModels() { return { models: ['model-a'], defaultModel: 'model-a' } },
        async start({ sessionId }) { return { session: {}, nativeSessionId: \`native-\${sessionId}\` } },
        async send({ output }) {
          await gate
          output.final()
        },
        async stop() { release() },
        async resume({ nativeSessionId }) { return { session: {}, nativeSessionId } },
      }
    `)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'start', { sessionId: 's1', workDir: tmpDir, modelId: 'model-a', systemPrompt: 'test prompt' }))
    await host.waitForResponse('1')
    host.send(req('2', 'send', { modelId: 'model-a', text: 'first', attachments: [] }))
    await host.waitForResponse('2')
    host.send(req('3', 'send', { modelId: 'model-a', text: 'second', attachments: [] }))
    const response = await host.waitForResponse('3')
    expect(response.error?.code).toBe('turn_active')
    host.send(req('4', 'stop', { reason: 'client_stop' }))
    await host.waitForResponse('4')
  })

  it('auto-terminates with final when the handler resolves without emitting one', async () => {
    const entry = writeAdapter(`
      export default {
        name: 'Silent Adapter',
        version: '1.0.0',
        async listModels() { return { models: ['model-a'], defaultModel: 'model-a' } },
        async start({ sessionId }) { return { session: {}, nativeSessionId: \`native-\${sessionId}\` } },
        async send() {},
        async stop() {},
        async resume({ nativeSessionId }) { return { session: {}, nativeSessionId } },
      }
    `)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'start', { sessionId: 's1', workDir: tmpDir, modelId: 'model-a', systemPrompt: 'test prompt' }))
    await host.waitForResponse('1')
    host.send(req('2', 'send', { modelId: 'model-a', text: 'hi', attachments: [] }))
    await host.waitForResponse('2')
    const terminal = await host.waitForTerminal('2')
    expect(terminal.event?.state).toBe('final')
  })

  it('normalizes a thrown send error to send_failed', async () => {
    const entry = writeAdapter(`
      export default {
        name: 'Throwing Adapter',
        version: '1.0.0',
        async listModels() { return { models: ['model-a'], defaultModel: 'model-a' } },
        async start({ sessionId }) { return { session: {}, nativeSessionId: \`native-\${sessionId}\` } },
        async send() { throw new Error('boom') },
        async stop() {},
        async resume({ nativeSessionId }) { return { session: {}, nativeSessionId } },
      }
    `)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'start', { sessionId: 's1', workDir: tmpDir, modelId: 'model-a', systemPrompt: 'test prompt' }))
    await host.waitForResponse('1')
    host.send(req('2', 'send', { modelId: 'model-a', text: 'hi', attachments: [] }))
    await host.waitForResponse('2')
    const terminal = await host.waitForTerminal('2')
    expect(terminal.event?.state).toBe('error')
    expect(terminal.event?.code).toBe('send_failed')
    expect(terminal.event?.message).toBe('boom')
  })

  it('resumes the exact requested nativeSessionId, never a different one', async () => {
    const entry = writeAdapter(ECHO_ADAPTER)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'resume', {
      sessionId: 's2',
      nativeSessionId: 'native-original',
      workDir: tmpDir,
      modelId: 'model-a',
      systemPrompt: 'be terse',
    }))
    const response = await host.waitForResponse('1')
    expect(response.ok).toBe(true)
    expect(response.result?.nativeSessionId).toBe('native-original')
  })

  it('rejects listModels output with no models as models_invalid', async () => {
    const entry = writeAdapter(`
      export default {
        name: 'Empty Models Adapter',
        version: '1.0.0',
        async listModels() { return { models: [], defaultModel: '' } },
        async start({ sessionId }) { return { session: {}, nativeSessionId: \`native-\${sessionId}\` } },
        async send({ output }) { output.final() },
        async stop() {},
        async resume({ nativeSessionId }) { return { session: {}, nativeSessionId } },
      }
    `)
    const host = new HostHarness(entry, tmpDir as string)
    host.send(req('1', 'listModels', { workDir: tmpDir }))
    const response = await host.waitForResponse('1')
    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe('models_invalid')
  })
})
