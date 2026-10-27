// @arch open-source/docs/cli-runtime.md
// @covers src/agents/opencode.ts
// @covers src/session/handlers/agent-workspace-validation.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'

const fake = vi.hoisted(() => ({ binary: '' }))

// Only command lookup and the login-shell environment are replaced; spawning,
// process groups, signals and the adapter/validation code are real.
vi.mock('../agents/command-spec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agents/command-spec.js')>()),
  resolveBuiltinCommand: () => ({
    command: 'opencode', args: [], display: 'opencode', kind: 'native', path: fake.binary,
  }),
}))
vi.mock('../agent-env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent-env.js')>()),
  buildAgentProcessEnv: (extra: NodeJS.ProcessEnv = {}) => ({ ...process.env, ...extra }),
}))

import { OpenCodeAdapter } from '../agents/opencode.js'
import { validateAgentWorkspaceConfiguration } from '../session/handlers/agent-workspace-validation.js'

const posix = process.platform !== 'win32'
let workDir = ''

function alive(pid: number): boolean {
  try { process.kill(pid, 0) } catch { return false }
  return !spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().startsWith('Z')
}

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return condition()
}

function installFakeOpenCode(body: string): void {
  fake.binary = path.join(workDir, 'opencode')
  fs.writeFileSync(fake.binary, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
}

function reportedDescendant(): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(path.join(workDir, 'descendant.pid'), 'utf8').trim(), 10)
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function requireReportedDescendant(): number {
  const pid = reportedDescendant()
  if (pid === null) throw new Error('OpenCode fixture did not report its descendant process')
  return pid
}

// Starts a helper that outlives SIGTERM, the way an LSP/MCP server or shell tool would.
const HANG_WITH_HELPER = `(trap '' TERM; exec sleep 300) &
descendant=$!
printf '%s\\n' "$descendant" > "$PWD/descendant.pid.$$"
mv "$PWD/descendant.pid.$$" "$PWD/descendant.pid"
while true; do sleep 1; done`

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-opencode-tree-'))
})

afterEach(() => {
  const descendant = reportedDescendant()
  if (descendant !== null) {
    try { process.kill(descendant, 'SIGKILL') } catch { /* already stopped */ }
  }
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe.skipIf(!posix)('OpenCode subprocess tree', () => {
  it('stop() ends the run and every helper process it started', async () => {
    installFakeOpenCode(HANG_WITH_HELPER)
    const adapter = new OpenCodeAdapter()
    await adapter.start('session', workDir)
    await adapter.send('hello')
    expect(await until(() => reportedDescendant() !== null)).toBe(true)
    const descendant = requireReportedDescendant()
    expect(alive(descendant)).toBe(true)

    await adapter.stop()

    expect(await until(() => !alive(descendant))).toBe(true)
  })

  it('a timed-out agent check answers with a stable code and leaves no process behind', async () => {
    installFakeOpenCode(HANG_WITH_HELPER)
    const cleanupNativeSession = vi.fn()

    const started = Date.now()
    const result = await validateAgentWorkspaceConfiguration(
      { runtimeAdapter: 'opencode', workDir, modelId: null, sessionMode: 'standard' },
      {
        resolveWorkDir: async () => workDir,
        validateWorkDir: async () => true,
        timeoutMs: 400,
        cleanupNativeSession,
      },
    )

    expect(result).toEqual({ ok: false, errorCode: 'agent_validation_response_timeout' })
    expect(Date.now() - started).toBeLessThan(10_000)
    const descendant = reportedDescendant()
    expect(descendant === null || await until(() => !alive(descendant))).toBe(true)
    expect(cleanupNativeSession).not.toHaveBeenCalled()
  })

  it('cleans up a helper after the OpenCode leader exits successfully', async () => {
    installFakeOpenCode(`(trap '' TERM; exec sleep 300) </dev/null >/dev/null 2>&1 &
descendant=$!
printf '%s\\n' "$descendant" > "$PWD/descendant.pid.$$"
mv "$PWD/descendant.pid.$$" "$PWD/descendant.pid"
echo '{"type":"text","part":{"text":"hello"}}'
exit 0`)

    await expect(validateAgentWorkspaceConfiguration(
      { runtimeAdapter: 'opencode', workDir, modelId: null, sessionMode: 'standard' },
      { resolveWorkDir: async () => workDir, validateWorkDir: async () => true },
    )).resolves.toEqual({ ok: true })

    expect(await until(() => !alive(requireReportedDescendant()))).toBe(true)
  })

  it('does not hide a real provider error behind the timeout path', async () => {
    installFakeOpenCode(`echo '{"type":"error","error":{"data":{"message":"401 authentication required"}}}'
sleep 1
exit 1`)

    await expect(validateAgentWorkspaceConfiguration(
      { runtimeAdapter: 'opencode', workDir, modelId: null, sessionMode: 'standard' },
      { resolveWorkDir: async () => workDir, validateWorkDir: async () => true, timeoutMs: 5_000 },
    )).resolves.toEqual({ ok: false, errorCode: 'agent_validation_runtime_auth_required' })
  })

  it('keeps only a bounded amount of stderr for the failure message', async () => {
    installFakeOpenCode('head -c 2000000 /dev/zero | tr "\\0" x >&2\nexit 3')
    const adapter = new OpenCodeAdapter()
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('session', workDir)
    await adapter.send('hello')

    expect(await until(() => events.some((event) => event.state === 'error'))).toBe(true)
    const message = events.find((event) => event.state === 'error')?.message ?? ''
    expect(message.length).toBeGreaterThan(0)
    expect(message.length).toBeLessThanOrEqual(64 * 1024)
  })
})
