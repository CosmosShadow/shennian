// @covers src/agents/acp/adapter.ts
// @covers src/agents/acp/process-client.ts
// @covers src/agents/acp/events.ts

import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import { AcpAgentAdapter } from '../agents/acp/adapter.js'
import { AcpProcessClient } from '../agents/acp/process-client.js'
import { getAcpRuntimeAuthState } from '../agents/acp/auth-state.js'

const fixture = fileURLToPath(new URL('./fixtures/acp-test-agent.mjs', import.meta.url))
const adversarialFixture = fileURLToPath(new URL('./fixtures/acp-adversarial-agent.mjs', import.meta.url))
const authFixture = fileURLToPath(new URL('./fixtures/acp-auth-agent.mjs', import.meta.url))

function createAdapter(mode?: string): AcpAgentAdapter {
  return new AcpAgentAdapter({
    id: 'test-agent',
    name: 'Test Agent',
    launch: { command: process.execPath, args: [fixture, ...(mode ? [mode] : [])] },
    source: 'local',
  })
}

describe('AcpAgentAdapter', () => {
  it('negotiates ACP v1, streams events, and requires an explicit permission choice', async () => {
    const adapter = createAdapter()
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))

    await adapter.start('shennian-session', process.cwd())
    const sending = adapter.send('hello')

    const permission = await waitForEvent(events, 'approval-pending')
    expect(permission.permission?.options).toEqual([
      { id: 'allow', name: 'Allow once', kind: 'allow_once' },
      { id: 'reject', name: 'Reject once', kind: 'reject_once' },
    ])
    expect(permission.permission).toMatchObject({
      sessionId: 'shennian-session',
      agentSessionId: 'acp-session-1',
      runId: expect.any(String),
      toolCallId: 'tool-1',
    })
    await adapter.respondToPermission(permission.permission!.id, 'allow')
    await sending

    expect(events.map((event) => event.state)).toEqual([
      'start',
      'delta',
      'tool-call',
      'approval-pending',
      'tool-result',
      'delta',
      'final',
    ])
    expect(events[1]).toMatchObject({ text: 'thinking', thinking: true })
    expect(events[5]).toMatchObject({ text: 'done' })
    expect(events.at(-1)?.agentSessionId).toBe('acp-session-1')
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
    await adapter.stop()
  })

  it('maps ACP model config and session mode without duplicating tool snapshots', async () => {
    const adapter = createAdapter('duplicate-tools')
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('shennian-session', process.cwd())
    const sending = adapter.send('hello', 'fast', 'code')
    const permission = await waitForEvent(events, 'approval-pending')
    expect(adapter.getSessionOptions()).toEqual({
      models: [{
        id: 'default', name: 'Default',
        supportedReasoningEfforts: [{ id: 'ask', name: 'Ask' }, { id: 'code', name: 'Code' }],
      }, {
        id: 'fast', name: 'Fast', isDefault: true,
        supportedReasoningEfforts: [{ id: 'ask', name: 'Ask' }, { id: 'code', name: 'Code' }],
      }],
      modes: [{ id: 'ask', name: 'Ask' }, { id: 'code', name: 'Code' }],
    })
    await adapter.respondToPermission(permission.permission!.id, 'allow')
    await sending
    expect(events.filter((event) => event.state === 'tool-call')).toHaveLength(1)
    await adapter.stop()
  })

  it('announces provider model options once the session exists and skips a model it no longer offers', async () => {
    const adapter = createAdapter('relay-hello')
    const announced: string[][] = []
    adapter.on('sessionOptions', () => announced.push(adapter.getSessionOptions().models.map((model) => model.id)))
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('shennian-session', process.cwd())
    expect(announced).toEqual([])

    // 'ghost' comes from a stale cached list; the message must still complete on the current model.
    await adapter.send('hello', 'ghost')

    expect(announced).toEqual([['default', 'fast']])
    expect(events.at(-1)?.state).toBe('final')
    expect(adapter.getSessionOptions().models.find((model) => model.isDefault)?.id).toBe('default')
    await adapter.stop()
  })

  it('compiles explicit client services separately for a Managed session', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-policy-'))
    const output = path.join(directory, 'capabilities.json')
    const adapter = new AcpAgentAdapter({
      id: 'policy-agent', name: 'Policy Agent',
      launch: { command: process.execPath, args: [fixture], env: { ACP_FIXTURE_CAPABILITIES_FILE: output } },
      clientCapabilities: { readTextFile: true, writeTextFile: true, terminal: true },
    })
    adapter.configure({
      managedAgentPolicy: {
        executionMode: 'restricted',
        requestedPolicy: { executionMode: 'restricted' },
        adapterPolicy: { fileAccess: 'workspace-read' },
      } as Parameters<NonNullable<typeof adapter.configure>>[0]['managedAgentPolicy'],
    })
    await adapter.start('managed-session', directory)
    const capabilities = JSON.parse(fs.readFileSync(output, 'utf8'))
    expect(capabilities.fs).toEqual({ readTextFile: true, writeTextFile: false })
    expect(capabilities.terminal).toBe(true)
    await adapter.stop()
  })

  it('closes every client capability — including the managed-room-only terminal bridge — for a public visitor turn', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-public-'))
    const output = path.join(directory, 'capabilities.json')
    const adapter = new AcpAgentAdapter({
      id: 'public-policy-agent', name: 'Public Policy Agent',
      launch: { command: process.execPath, args: [fixture], env: { ACP_FIXTURE_CAPABILITIES_FILE: output } },
      clientCapabilities: { readTextFile: true, writeTextFile: true, terminal: true },
    })
    const publicPolicy = {
      requestedPolicy: { version: 1, fileAccess: 'workspace-read', externalCapabilities: {
        commandNetwork: false, webSearch: false, browser: false, computerUse: false, mcp: false,
      } },
      executionMode: 'restricted',
      enforcement: {
        level: 'partial', executableFingerprint: `sha256:${'a'.repeat(64)}`,
        unsupportedCapabilities: [], runtimeVersion: '1.0.0', platform: process.platform,
        effectivePolicy: { version: 1, fileAccess: 'workspace-read', externalCapabilities: {
          commandNetwork: false, webSearch: false, browser: false, computerUse: false, mcp: false,
        } },
      },
      adapterPolicy: {
        version: 1, workDir: directory, fileAccess: 'workspace-read',
        externalCapabilities: { commandNetwork: false, webSearch: false, browser: false, computerUse: false, mcp: false },
        denySensitiveFiles: true, failClosed: true,
      },
      environmentPolicy: { inheritDaemonEnv: false, loadLoginShell: false,
        providerEnvKeys: [], sessionEnvKeys: [],
        shellSubprocess: { inherit: 'none', allowedEnvKeys: [], deniedEnvKeys: [] } },
    } as Parameters<NonNullable<typeof adapter.configure>>[0]['managedAgentPolicy']
    adapter.configure({ managedAgentPolicy: publicPolicy })
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('public-session', directory)
    const sending = adapter.send('hello', undefined, undefined, undefined, undefined, { source: 'published_agent' })
    const permission = await waitForEvent(events, 'approval-pending')
    await adapter.respondToPermission(permission.permission!.id, 'allow')
    await sending
    const capabilities = JSON.parse(fs.readFileSync(output, 'utf8'))
    // `auth.terminal` only advertises that the Owner's own `shennian agent auth`
    // CLI command can complete an interactive terminal login on request; it is
    // never reachable from a visitor's conversation turn (see `authenticate()`,
    // which requires an explicit `interactiveTerminal` flag no turn ever
    // passes), so it is out of scope for this fix and stays as declared.
    expect(capabilities.fs).toEqual({ readTextFile: false, writeTextFile: false })
    expect(capabilities.terminal).toBe(false)
    await adapter.stop()
  })

  it('resumes an existing ACP session without replaying history', async () => {
    const adapter = createAdapter()
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))

    await adapter.start('shennian-session', process.cwd(), 'existing-acp-session')
    await adapter.resume('existing-acp-session')

    expect(events).toEqual([])
    expect(await adapter.getStatus()).toMatchObject({ active: false, canStop: false })
    await adapter.stop()
  })

  it('uses the unified recovery contract and sends exactly one minimal Continue prompt', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-recovery-'))
    const promptFile = path.join(directory, 'prompts.jsonl')
    const adapter = new AcpAgentAdapter({
      id: 'recovery-agent', name: 'Recovery Agent',
      launch: { command: process.execPath, args: [fixture], env: { ACP_FIXTURE_PROMPT_FILE: promptFile } },
    })
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('shennian-session', directory, 'existing-acp-session')
    const beforeContinueDispatch = vi.fn()
    const recovering = adapter.recoverInterruptedRun({
      sessionId: 'shennian-session', shennianRunId: 'run-1', workDir: directory,
      agentSessionId: 'existing-acp-session', providerRunId: null, lastObservedEventSeq: 0,
      continueDispatchState: 'none', beforeContinueDispatch,
      sendContext: { source: 'upgrade_recovery', recovery: 'upgrade' },
    })
    const permission = await waitForEvent(events, 'approval-pending')
    await adapter.respondToPermission(permission.permission!.id, 'allow')
    await expect(recovering).resolves.toEqual({ result: 'continued' })
    expect(beforeContinueDispatch).toHaveBeenCalledOnce()
    const prompts = fs.readFileSync(promptFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(prompts).toEqual([[{ type: 'text', text: 'Continue.' }]])
    await adapter.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('reuses ordinary ACP client capabilities for a native-full managed Agent', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-native-full-'))
    const output = path.join(directory, 'capabilities.json')
    const adapter = new AcpAgentAdapter({
      id: 'native-full-agent', name: 'Native Full Agent',
      launch: { command: process.execPath, args: [fixture], env: { ACP_FIXTURE_CAPABILITIES_FILE: output } },
      clientCapabilities: { readTextFile: true, writeTextFile: true, terminal: true },
    })
    adapter.configure({
      managedAgentPolicy: {
        executionMode: 'native-full',
        requestedPolicy: { executionMode: 'native-full' },
        adapterPolicy: { fileAccess: 'host-full' },
      } as Parameters<NonNullable<typeof adapter.configure>>[0]['managedAgentPolicy'],
    })
    await adapter.start('managed-native-full-session', directory)
    const capabilities = JSON.parse(fs.readFileSync(output, 'utf8'))
    expect(capabilities.fs).toEqual({ readTextFile: true, writeTextFile: true })
    expect(capabilities.terminal).toBe(true)
    await adapter.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('restarts the ACP transport when a managed Room turn refreshes its capability', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-room-context-'))
    const environmentFile = path.join(directory, 'environment.txt')
    const adapter = new AcpAgentAdapter({
      id: 'managed-room-agent',
      name: 'Managed Room Agent',
      launch: {
        command: process.execPath,
        args: [fixture],
        env: { ACP_FIXTURE_ENV_FILE: environmentFile },
      },
      source: 'local',
    })
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    adapter.configure({ env: { SHENNIAN_MANAGED_ROOM_CONTEXT: 'first-turn' } })
    await adapter.start('managed-room-session', directory)

    const firstSend = adapter.send('first')
    const firstPermission = await waitForNthEvent(events, 'approval-pending', 1)
    await adapter.respondToPermission(firstPermission.permission!.id, 'allow')
    await firstSend

    adapter.configure({ env: { SHENNIAN_MANAGED_ROOM_CONTEXT: 'second-turn' } })
    const secondSend = adapter.send('second')
    const secondPermission = await waitForNthEvent(events, 'approval-pending', 2)
    await adapter.respondToPermission(secondPermission.permission!.id, 'allow')
    await secondSend

    expect(fs.readFileSync(environmentFile, 'utf8').trim().split('\n')).toEqual([
      'first-turn',
      'second-turn',
    ])
    expect(events.filter((event) => event.state === 'final').map((event) => event.agentSessionId))
      .toEqual(['acp-session-1', 'acp-session-1'])
    await adapter.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('fails closed for missing or broken ACP resume without sending recovery input twice', async () => {
    const noResume = createAdapter('no-resume')
    await noResume.start('s', process.cwd(), 'existing')
    await expect(noResume.recoverInterruptedRun({
      sessionId: 's', shennianRunId: 'r', workDir: process.cwd(), agentSessionId: 'existing',
      providerRunId: null, lastObservedEventSeq: 0, continueDispatchState: 'none',
    })).resolves.toEqual({ result: 'interrupted_by_upgrade', reason: 'resume_unsupported' })
    await noResume.stop()

    const broken = createAdapter('resume-error')
    await broken.start('s', process.cwd(), 'missing')
    await expect(broken.recoverInterruptedRun({
      sessionId: 's', shennianRunId: 'r', workDir: process.cwd(), agentSessionId: 'missing',
      providerRunId: null, lastObservedEventSeq: 0, continueDispatchState: 'none',
    })).resolves.toMatchObject({ result: 'recovery_failed', reason: 'provider_error' })
    await broken.stop()
  })

  it('paginates external session indexes and keeps metadata minimal', async () => {
    const adapter = createAdapter()
    await adapter.start('shennian-session', process.cwd())
    expect(await adapter.listExternalSessions()).toEqual([
      { agentSessionId: 'external-1', cwd: process.cwd(), title: 'First' },
      { agentSessionId: 'external-2', cwd: process.cwd(), title: 'Second', updatedAt: '2026-09-09T00:00:00Z' },
    ])
    await adapter.stop()
  })

  it('does not invent external history for an Agent without list/load capabilities', async () => {
    const adapter = createAdapter('no-history')
    await adapter.start('shennian-session', process.cwd())
    expect(await adapter.listExternalSessions()).toEqual([])
    await expect(adapter.loadExternalSession('hidden-session'))
      .rejects.toThrow('ACP session history import is unsupported')
    await adapter.stop()
  })

  it.skipIf(process.platform === 'win32')('canonicalizes cwd aliases before filtering external sessions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-cwd-'))
    const workspace = path.join(root, 'workspace')
    const alias = path.join(root, 'workspace-alias')
    fs.mkdirSync(workspace)
    fs.symlinkSync(workspace, alias, 'dir')
    const adapter = createAdapter()
    try {
      await adapter.start('shennian-session', alias)
      const sessions = await adapter.listExternalSessions({ cwd: alias })
      expect(sessions).toHaveLength(2)
      expect(sessions.every((session) => session.cwd === fs.realpathSync.native(workspace))).toBe(true)
    } finally {
      await adapter.stop()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('loads external history with stable identities and keeps resume replay-free', async () => {
    const adapter = createAdapter()
    await adapter.start('shennian-session', process.cwd())
    const first = await adapter.loadExternalSession('external-1')
    const second = await adapter.loadExternalSession('external-1')
    expect(first).toEqual(second)
    expect(first.map((message) => message.sourceId)).toEqual([
      'message:old-user',
      'message:old-agent',
      'tool:old-tool',
    ])
    expect(first.map(({ role, payload }) => ({ role, payload }))).toEqual([
      { role: 'user', payload: 'older question' },
      { role: 'agent', payload: 'older answer' },
      {
        role: 'agent',
        payload: JSON.stringify({
          v: 1,
          type: 'tool_use',
          name: 'Read file',
          toolCallId: 'old-tool',
          status: 'completed',
        }),
      },
    ])
    await adapter.stop()
  })

  it.each(['version-mismatch', 'oversize', 'invalid-json'])('fails closed for %s protocol output without leaking stderr', async (mode) => {
    const client = new AcpProcessClient(
      { command: process.execPath, args: [adversarialFixture, mode] },
      { onSessionUpdate: () => {}, onPermission: async () => ({ outcome: { outcome: 'cancelled' } }) },
    )
    let message = ''
    try {
      await client.start(process.cwd())
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    } finally {
      await client.close()
    }
    expect(message).toBeTruthy()
    expect(message).not.toContain('super-secret-value')
  })

  it('accepts unknown optional response fields on stable v1', async () => {
    const client = new AcpProcessClient(
      { command: process.execPath, args: [adversarialFixture, 'future-field'] },
      { onSessionUpdate: () => {}, onPermission: async () => ({ outcome: { outcome: 'cancelled' } }) },
    )
    expect((await client.start(process.cwd())).protocolVersion).toBe(1)
    await client.close()
  })

  it('times out a stalled initialize request and closes the process', async () => {
    const client = new AcpProcessClient(
      { command: process.execPath, args: [adversarialFixture, 'stall'] },
      { onSessionUpdate: () => {}, onPermission: async () => ({ outcome: { outcome: 'cancelled' } }) },
      process.env,
      {},
      { initializeMs: 20 },
    )
    await expect(client.start(process.cwd())).rejects.toThrow('timed out')
    await client.close()
  })

  it.each([
    ['crash-prompt', undefined, 'connection closed'],
    ['stall-prompt', 20, 'timed out'],
  ] as const)('fails and cleans up when a prompt %s', async (mode, promptTimeoutMs, message) => {
    const adapter = new AcpAgentAdapter({
      id: `failure-${mode}`, name: 'Failure Agent',
      launch: { command: process.execPath, args: [fixture, mode] },
    }, { promptTimeoutMs })
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('failure-session', process.cwd())
    await expect(adapter.send('trigger failure')).rejects.toThrow(message)
    expect(events.at(-1)?.state).toBe('error')
    await expect(adapter.stop()).resolves.toBeUndefined()
  })

  it('rejects duplicate or expired permission responses and cancels pending permission on stop', async () => {
    const adapter = createAdapter()
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('shennian-session', process.cwd())
    const sending = adapter.send('permission lifecycle').catch(() => {})
    const permission = await waitForEvent(events, 'approval-pending')
    await adapter.respondToPermission(permission.permission!.id, 'reject')
    await expect(adapter.respondToPermission(permission.permission!.id, 'reject')).rejects.toThrow('no longer pending')
    await sending

    const second = adapter.send('permission stop').catch(() => {})
    const nextPermission = await waitForNthEvent(events, 'approval-pending', 2)
    await adapter.stop()
    await expect(adapter.respondToPermission(nextPermission.permission!.id, 'allow')).rejects.toThrow('no longer pending')
    await second
  })

  it('expires an unanswered permission and rejects a late mobile response', async () => {
    const adapter = new AcpAgentAdapter({
      id: 'expiring-agent', name: 'Expiring Agent',
      launch: { command: process.execPath, args: [fixture] },
    }, { permissionTimeoutMs: 20 })
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('expiring-session', process.cwd())
    const sending = adapter.send('expire permission')
    const permission = await waitForEvent(events, 'approval-pending')
    await new Promise((resolve) => setTimeout(resolve, 40))
    await sending
    await expect(adapter.respondToPermission(permission.permission!.id, 'allow')).rejects.toThrow('no longer pending')
    await adapter.stop()
  })

  it('surfaces auth_required, authenticates, reinitializes, and retries the original prompt exactly once', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-auth-'))
    const marker = path.join(directory, 'authenticated')
    const adapter = new AcpAgentAdapter({
      id: 'auth-agent',
      name: 'Auth Agent',
      launch: { command: process.execPath, args: [authFixture], env: { ACP_AUTH_MARKER: marker } },
    })
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    await adapter.start('auth-session', directory)
    expect(adapter.getAuthMethods().map((method) => method.id)).toEqual(['fixture-login'])
    await expect(adapter.send('before login')).rejects.toThrow('Authentication required')
    expect(adapter.hasPendingAuthenticationRetry()).toBe(true)
    expect(events.at(-1)).toMatchObject({ state: 'error', errorCode: 'acp_auth_required' })
    expect(getAcpRuntimeAuthState('acp:auth-agent')).toBe('required')
    await adapter.authenticate('fixture-login')
    expect(getAcpRuntimeAuthState('acp:auth-agent')).toBe('ready')
    expect(adapter.hasPendingAuthenticationRetry()).toBe(false)
    await waitForEvent(events, 'final')
    expect(events.filter((event) => event.state === 'delta')).toHaveLength(1)
    expect(events.filter((event) => event.state === 'final')).toHaveLength(1)
    await adapter.logout()
    await adapter.stop()
  })
})

async function waitForEvent(events: AgentEvent[], state: string): Promise<AgentEvent> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const event = events.find((candidate) => candidate.state === state)
    if (event) return event
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${state}`)
}

async function waitForNthEvent(events: AgentEvent[], state: string, count: number): Promise<AgentEvent> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const matches = events.filter((candidate) => candidate.state === state)
    if (matches.length >= count) return matches[count - 1]!
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${state} #${count}`)
}
