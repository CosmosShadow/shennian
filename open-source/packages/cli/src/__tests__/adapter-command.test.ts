// @covers open-source/packages/cli/src/commands/adapter.ts
// @covers open-source/packages/cli/src/adapter-kit/check.ts
// @covers open-source/packages/cli/src/adapter-kit/registry.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAdapterCommand } from '../commands/adapter.js'
import { getShennianDir } from '../config/index.js'
import { detectAgents } from '../agents/detect.js'
import { createAgent } from '../agents/adapter.js'
import type { AdapterSubmissionPayload } from '../adapter-kit/submission-client.js'

const HOST_SOURCE_PATH = fileURLToPath(new URL('../../bin/shennian-adapter-host.ts', import.meta.url))
// A spawned adapter host's cwd is the adapter's own workDir, which has no
// node_modules of its own; resolve tsx's loader to an absolute path so
// `--import` still finds it regardless of cwd.
const TSX_LOADER_PATH = createRequire(import.meta.url).resolve('tsx')

const CONFORMANT_ADAPTER = `
export default {
  name: 'Conformant Adapter',
  version: '1.0.0',
  async listModels() {
    return { models: ['model-a', 'model-b'], defaultModel: 'model-a' }
  },
  async start({ sessionId, systemPrompt }) {
    return { session: { systemPrompt }, nativeSessionId: \`native-\${sessionId}\` }
  },
  async send({ session, output }) {
    // Pulls the mandated token straight out of the real systemPrompt channel,
    // proving the value came from start()/resume(), not from the user turn.
    const match = /must contain the exact text (\\S+)/.exec(session.systemPrompt || '')
    output.delta(match ? \`Understood: \${match[1]}\` : 'no token available')
    output.final()
  },
  async stop() {},
  async resume({ nativeSessionId, systemPrompt }) {
    return { session: { systemPrompt }, nativeSessionId }
  },
}
`

const NON_CONFORMANT_ADAPTER = `
export default {
  name: 'Echo Adapter',
  version: '1.0.0',
  async listModels() {
    return { models: ['model-a'], defaultModel: 'model-a' }
  },
  async start({ sessionId }) {
    return { session: {}, nativeSessionId: \`native-\${sessionId}\` }
  },
  async send({ text, output }) {
    // Ignores systemPrompt entirely and just echoes the user turn back.
    output.delta(\`echo:\${text}\`)
    output.final()
  },
  async stop() {},
  async resume({ nativeSessionId }) {
    return { session: {}, nativeSessionId }
  },
}
`

function stopFailureAdapter(failOnResume: boolean): string {
  return `
export default {
  name: 'Stop Failure Adapter',
  version: '1.0.0',
  async listModels() { return { models: ['model-a'], defaultModel: 'model-a' } },
  async start({ sessionId, systemPrompt }) {
    return { session: { systemPrompt, resumed: false }, nativeSessionId: \`native-\${sessionId}\` }
  },
  async send({ session, output }) {
    const match = /must contain the exact text (\\S+)/.exec(session.systemPrompt || '')
    output.delta(match ? match[1] : 'missing')
    output.final()
  },
  async stop({ session }) {
    if (${failOnResume ? 'session.resumed' : '!session.resumed'}) throw new Error('stop-broken')
  },
  async resume({ nativeSessionId, systemPrompt }) {
    return { session: { systemPrompt, resumed: true }, nativeSessionId }
  },
}
`
}

let tmpDir: string
let output: string
const submit = vi.fn<(payload: AdapterSubmissionPayload) => Promise<Record<string, unknown>>>()

function makeProgram(): Command {
  const program = new Command().exitOverride()
  registerAdapterCommand(program, {
    hostPath: HOST_SOURCE_PATH,
    hostNodeArgs: ['--import', TSX_LOADER_PATH],
    clientVersion: '0.5.test',
    submissionClient: { submit },
  })
  return program
}

function writeAdapterFile(source: string): string {
  const file = path.join(tmpDir, 'adapter.mjs')
  fs.writeFileSync(file, source)
  return file
}

function lastJson(): Record<string, unknown> {
  const lines = output.trim().split('\n').filter(Boolean)
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-command-'))
  output = ''
  submit.mockReset()
  submit.mockResolvedValue({ submissionId: 'submission-1', status: 'pending', duplicate: false })
  process.exitCode = undefined
  const registryPath = path.join(getShennianDir(), 'node-adapters.json')
  fs.rmSync(registryPath, { force: true })
  const stdoutWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as typeof process.stdout.write
  ;(process.stdout as unknown as { __restore: () => void }).__restore = () => {
    process.stdout.write = stdoutWrite
  }
})

afterEach(() => {
  ;(process.stdout as unknown as { __restore: () => void }).__restore()
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.exitCode = undefined
})

describe('shennian adapter CLI (protocol V1)', () => {
  it('init scaffolds a template that already declares all five lifecycle functions', async () => {
    const program = makeProgram()
    await program.parseAsync(['adapter', 'init', tmpDir, '--name', 'My Adapter'], { from: 'user' })
    const result = lastJson()
    expect(result.ok).toBe(true)
    expect((result.result as Record<string, unknown>).maxCheckAttempts).toBe(3)
    expect(result.nextAction).toMatchObject({ type: 'implement_and_check' })
    const source = fs.readFileSync(path.join(tmpDir, 'adapter.mjs'), 'utf-8')
    for (const method of ['listModels', 'start', 'send', 'stop', 'resume']) {
      expect(source).toContain(`async ${method}(`)
    }
  })

  it('refuses to overwrite an existing adapter.mjs', async () => {
    fs.writeFileSync(path.join(tmpDir, 'adapter.mjs'), '// existing')
    const program = makeProgram()
    await program.parseAsync(['adapter', 'init', tmpDir, '--name', 'X'], { from: 'user' })
    const result = lastJson()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('adapter_file_exists')
  })

  it('does not expose arbitrary Adapter load errors in structured diagnostics', async () => {
    const entry = writeAdapterFile(`throw new Error('PRIVATE_PROVIDER_VALUE_DO_NOT_PRINT')`)
    const program = makeProgram()
    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '5000'], { from: 'user' })
    const result = lastJson()
    expect(result).toMatchObject({ ok: false, stage: 'contract', error: 'adapter_contract_invalid' })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_VALUE_DO_NOT_PRINT')
  }, 10_000)

  it('runs check end to end and passes a real systemPrompt/resume conformant adapter', async () => {
    const entry = writeAdapterFile(CONFORMANT_ADAPTER)
    const program = makeProgram()
    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'], { from: 'user' })
    const result = lastJson()
    expect(result.ok).toBe(true)
    const body = result.result as Record<string, unknown>
    expect(body.stage).toBe('passed')
    expect(body.systemPromptVerified).toBe(true)
    expect(body.resumeVerified).toBe(true)
    expect(body.defaultModel).toBe('model-a')
  }, 30_000)

  it('fails check at the systemPrompt stage when the adapter ignores the real instructions channel', async () => {
    const entry = writeAdapterFile(NON_CONFORMANT_ADAPTER)
    const program = makeProgram()
    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'], { from: 'user' })
    const result = lastJson()
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('systemPrompt')
    expect(result.error).toBe('system_prompt_unsupported')
    expect(result.nextAction).toMatchObject({ type: 'edit_and_retry', maxAttempts: 3 })
    expect(JSON.stringify(result)).toContain('Never concatenate')
  }, 30_000)

  it('keeps stage/error/nextAction when the Runtime step times out', async () => {
    const entry = writeAdapterFile(`
export default {
  name: 'Hanging Adapter', version: '1.0.0',
  async listModels() { return new Promise(() => {}) },
  async start() {}, async send() {}, async stop() {}, async resume() {},
}
`)
    const program = makeProgram()
    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '1000'], { from: 'user' })
    expect(lastJson()).toMatchObject({
      ok: false,
      stage: 'models',
      error: 'models_invalid',
      nextAction: { type: 'edit_and_retry', maxAttempts: 3 },
    })
  }, 10_000)

  it.each([
    ['the started session', false],
    ['the resumed session', true],
  ])('fails check at the stop stage when stopping %s fails', async (_label, failOnResume) => {
    const entry = writeAdapterFile(stopFailureAdapter(failOnResume))
    const program = makeProgram()
    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'], { from: 'user' })
    const result = lastJson()
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('stop')
    expect(result.error).toBe('stop_failed')
  }, 30_000)

  it('loads adapter top-level code only inside Runtime subprocesses', async () => {
    const markerPath = path.join(tmpDir, 'adapter-pids.txt')
    const source = `
import fs from 'node:fs'
fs.appendFileSync(${JSON.stringify(markerPath)}, \`\${process.pid}\\n\`)
${CONFORMANT_ADAPTER}
`
    const entry = writeAdapterFile(source)
    const program = makeProgram()
    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'], { from: 'user' })
    expect(lastJson().ok).toBe(true)
    const loadedBy = fs.readFileSync(markerPath, 'utf8').trim().split('\n').map(Number)
    expect(loadedBy).toHaveLength(2)
    expect(loadedBy).not.toContain(process.pid)
  }, 30_000)

  it('add only accepts an adapter whose passing check still matches the current file', async () => {
    const entry = writeAdapterFile(CONFORMANT_ADAPTER)
    const program = makeProgram()

    // Without a prior passing check, add must refuse.
    await program.parseAsync(['adapter', 'add', 'my-adapter', '--entry', entry], { from: 'user' })
    expect(lastJson().ok).toBe(false)
    expect(lastJson().error).toBe('adapter_not_checked')

    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'], { from: 'user' })
    expect(lastJson().ok).toBe(true)

    await program.parseAsync(['adapter', 'add', 'my-adapter', '--entry', entry], { from: 'user' })
    const added = lastJson()
    expect(added.ok).toBe(true)
    expect((added.result as Record<string, unknown>).adapterRef).toBe('custom:my-adapter')
    const discovered = await detectAgents({ agentType: 'custom:my-adapter' })
    expect(discovered).toEqual([
      expect.objectContaining({
        type: 'custom:my-adapter',
        display: expect.objectContaining({ name: 'Conformant Adapter' }),
        models: [
          { id: 'model-a', name: 'model-a', isDefault: true },
          { id: 'model-b', name: 'model-b', isDefault: false },
        ],
      }),
    ])
    expect(createAgent('custom:my-adapter')).not.toBeNull()

    // Editing the file after the check invalidates the cached fingerprint.
    fs.appendFileSync(entry, '\n// changed\n')
    await program.parseAsync(['adapter', 'add', 'other-name', '--entry', entry], { from: 'user' })
    expect(lastJson().ok).toBe(false)
    expect(lastJson().error).toBe('adapter_not_checked')

    await program.parseAsync(['adapter', 'list'], { from: 'user' })
    const listedAfterChange = (lastJson().result as { adapters: Array<Record<string, unknown>> }).adapters
    expect(listedAfterChange.some((adapter) => adapter.id === 'custom:my-adapter')).toBe(false)
    expect(await detectAgents({ agentType: 'custom:my-adapter' })).toEqual([])
    expect(createAgent('custom:my-adapter')).toBeNull()
  }, 30_000)

  it('lists official adapters and locally registered adapters together', async () => {
    const entry = writeAdapterFile(CONFORMANT_ADAPTER)
    const program = makeProgram()
    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'], { from: 'user' })
    await program.parseAsync(['adapter', 'add', 'my-adapter', '--entry', entry], { from: 'user' })
    await program.parseAsync(['adapter', 'list'], { from: 'user' })
    const listed = (lastJson().result as { adapters: Array<Record<string, unknown>> }).adapters
    expect(listed.some((a) => a.kind === 'official' && a.id === 'claude')).toBe(true)
    expect(listed.some((a) => a.kind === 'local' && a.id === 'custom:my-adapter')).toBe(true)
  }, 30_000)

  it('show returns the official Markdown detail, and remove unregisters a local adapter', async () => {
    const program = makeProgram()
    await program.parseAsync(['adapter', 'show', 'claude'], { from: 'user' })
    const shown = lastJson()
    expect(shown.ok).toBe(true)
    expect(typeof (shown.result as Record<string, unknown>).doc).toBe('string')

    const entry = writeAdapterFile(CONFORMANT_ADAPTER)
    await program.parseAsync(['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'], { from: 'user' })
    await program.parseAsync(['adapter', 'add', 'removable', '--entry', entry], { from: 'user' })
    await program.parseAsync(['adapter', 'remove', 'removable'], { from: 'user' })
    expect(lastJson().ok).toBe(true)
    await program.parseAsync(['adapter', 'remove', 'removable'], { from: 'user' })
    expect(lastJson().ok).toBe(false)
    expect(lastJson().error).toBe('adapter_not_found')
  }, 30_000)

  it('requires general-purpose scope and explicit user consent before submission', async () => {
    const entry = writeAdapterFile(CONFORMANT_ADAPTER)
    const program = makeProgram()
    await program.parseAsync(['adapter', 'submit', entry, '--agent', 'Example Agent'], { from: 'user' })
    expect(lastJson()).toMatchObject({ ok: false, error: 'adapter_submission_not_general' })

    await program.parseAsync(
      ['adapter', 'submit', entry, '--agent', 'Example Agent', '--general-purpose'],
      { from: 'user' },
    )
    expect(lastJson()).toMatchObject({ ok: false, error: 'adapter_submission_consent_required' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('submits only the unchanged checked adapter.mjs and preserves its fingerprint', async () => {
    const entry = writeAdapterFile(CONFORMANT_ADAPTER)
    const program = makeProgram()
    await program.parseAsync(
      ['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'],
      { from: 'user' },
    )
    const checked = lastJson()
    expect(checked.ok).toBe(true)

    await program.parseAsync([
      'adapter', 'submit', entry, '--agent', 'Example Agent',
      '--general-purpose', '--confirm-share',
    ], { from: 'user' })

    expect(lastJson()).toMatchObject({
      ok: true,
      command: 'adapter.submit',
      result: {
        submissionId: 'submission-1',
        status: 'pending',
        officialAdapterRegistered: false,
      },
    })
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'adapter.mjs',
      content: CONFORMANT_ADAPTER,
      targetAgent: 'Example Agent',
      adapterName: 'Conformant Adapter',
      adapterVersion: '1.0.0',
      clientVersion: '0.5.test',
      models: ['model-a', 'model-b'],
      defaultModel: 'model-a',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  }, 30_000)

  it('refuses sensitive source locally and never sends it to the Server', async () => {
    const entry = writeAdapterFile(CONFORMANT_ADAPTER)
    const program = makeProgram()
    await program.parseAsync(
      ['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'],
      { from: 'user' },
    )
    fs.appendFileSync(entry, '\nconst privatePath = "/Users/alice/private-project"\n')
    await program.parseAsync(
      ['adapter', 'check', entry, '--workdir', tmpDir, '--timeout', '15000'],
      { from: 'user' },
    )
    expect(lastJson().ok).toBe(true)
    await program.parseAsync([
      'adapter', 'submit', entry, '--agent', 'Example Agent',
      '--general-purpose', '--confirm-share',
    ], { from: 'user' })
    expect(lastJson()).toMatchObject({
      ok: false,
      error: 'adapter_submission_sensitive_content',
      nextAction: {
        type: 'generate_clean_single_file',
        issues: expect.arrayContaining(['absolute_path']),
      },
    })
    expect(submit).not.toHaveBeenCalled()
  }, 30_000)
})
