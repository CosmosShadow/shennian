// @arch open-source/docs/cli-runtime.md
// @covers src/agents/codex-conversation-settings.ts
// @covers src/agents/codex-approvals.ts
// @covers src/session/handlers/codex-settings.ts
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CODEX_CONVERSATION_SETTINGS as defaults, type ReqFrame } from '@shennian/wire'
import { normalizeCodexConversationSettings, codexThreadPermissionParams, codexTurnPermissionParams } from '../agents/codex-conversation-settings.js'
import { CodexAdapter } from '../agents/codex.js'
import { CodexApprovals } from '../agents/codex-approvals.js'
import { NativeSessionCleanupOutbox } from '../session/native-cleanup-outbox.js'
import { handleCodexSettings } from '../session/handlers/codex-settings.js'
import { recordSession, listSessionRecords } from '../session/store.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'
import type { SessionManagerRuntime } from '../session/types.js'
import type { AgentEvent } from '../agents/adapter.js'

let directory: string
beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-settings-')))
  vi.stubEnv('SHENNIAN_HOME', directory)
})
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }) })

function fixture() {
  const sendRes = vi.fn()
  const runtime = { sessions: new Map(), client: { sendRes },
    chatQueue: { getSnapshot: () => ({ busy: false, pending: [] }) } } as unknown as SessionManagerRuntime
  const req: ReqFrame = { type: 'req', id: 'settings-request', method: 'chat.codex.settings.set', params: {
    ...getPersonalSyncIdentity(), sessionId: 'personal-settings', settings: { ...defaults, codexHome: directory },
    codexSettingsSession: { agentType: 'codex', workDir: directory, sessionMode: 'standard', sessionScope: 'personal' },
  } }
  return { runtime, req, sendRes }
}

describe('personal Codex settings', () => {
  it('canonicalizes an existing directory and rejects commands, relative/nonexistent paths and unknown keys', () => {
    expect(normalizeCodexConversationSettings({ ...defaults, codexHome: ` ${directory} ` })).toEqual({ ...defaults, codexHome: directory })
    for (const input of [{ ...defaults, codexHome: 'codex3' }, { ...defaults, codexHome: `${directory}/missing` },
      { ...defaults, codexHome: `${directory}\ncommand` }, { ...defaults, args: ['--dangerous'] },
      { ...defaults, sandbox: 'unrecognized' }, { ...defaults, networkAccess: 'true' }, { ...defaults, sandbox: ['read-only'] },
      { ...defaults, approvalPolicy: ['never'] }]) {
      expect(() => normalizeCodexConversationSettings(input)).toThrow()
    }
  })
  it('persists settings, preserves them on native-session updates, and reads the same snapshot on a new runtime', () => {
    const { runtime, req, sendRes } = fixture()
    handleCodexSettings(runtime, req)
    recordSession({ sessionId: 'personal-settings', agentType: 'codex', workDir: directory, agentSessionId: 'exact-thread' })
    handleCodexSettings({ ...runtime, sessions: new Map() }, { ...req, method: 'chat.codex.settings.get' })
    expect(sendRes).toHaveBeenLastCalledWith({ type: 'res', id: req.id, ok: true, payload: {
      settings: { ...defaults, codexHome: directory }, homeLocked: true, busy: false,
    } })
    expect(listSessionRecords()[0]?.codexSettings?.codexHome).toBe(directory)
  })
  it('requires sync identity and server-attested personal scope; cannot configure managed/steward/manager sessions', () => {
    const { runtime, req } = fixture()
    const scopes = [undefined, { agentType: 'codex', workDir: directory, agentIdentityId: 'managed' },
      { agentType: 'codex', workDir: directory, sessionScope: 'steward' },
      { agentType: 'codex', workDir: directory, sessionMode: 'manager' }, { agentType: 'claude', workDir: directory }]
    for (const codexSettingsSession of scopes) expect(() => handleCodexSettings(runtime,
      { ...req, params: { ...req.params, codexSettingsSession } })).toThrow()
    expect(() => handleCodexSettings(runtime, { ...req, params: { ...req.params, daemonInstallationId: 'other' } })).toThrow()
    expect(listSessionRecords()).toHaveLength(0)
  })
  it('locks the account once a thread exists but permits idle sandbox changes', () => {
    const { runtime, req } = fixture()
    handleCodexSettings(runtime, req)
    recordSession({ sessionId: 'personal-settings', agentType: 'codex', workDir: directory, agentSessionId: 'thread' })
    expect(() => handleCodexSettings(runtime, { ...req, params: { ...req.params, settings: defaults } })).toThrow('codex_home_locked')
    handleCodexSettings(runtime, { ...req, params: { ...req.params, settings: { ...defaults, codexHome: directory, sandbox: 'read-only' } } })
    expect(listSessionRecords()[0]?.codexSettings?.sandbox).toBe('read-only')
  })
  it('does not change settings during runs, queued input, or upgrade recovery', () => {
    for (const update of [
      { chatQueue: { getSnapshot: () => ({ busy: true, pending: [] }) } },
      { chatQueue: { getSnapshot: () => ({ busy: false, pending: [{}] }) } },
      { recoveryBarrier: { isDispatchFrozen: () => true, isRecovering: () => false } },
      { recoveryBarrier: { isDispatchFrozen: () => false, isRecovering: () => true } },
    ]) {
      const { runtime, req } = fixture()
      expect(() => handleCodexSettings({ ...runtime, ...update } as unknown as SessionManagerRuntime, req)).toThrow('codex_settings_busy')
    }
    expect(listSessionRecords()).toHaveLength(0)
  })
  it('applies explicit permission options to both new threads and exact resume and every turn', async () => {
    const adapter = new CodexAdapter()
    const settings = { ...defaults, codexHome: directory, sandbox: 'workspace-write' as const, approvalPolicy: 'on-request' as const }
    adapter.configure({ sessionId: 'test', codexSettings: settings })
    await adapter.start('test', directory)
    const internal = adapter as unknown as { sendRpc: ReturnType<typeof vi.fn>; resolveCodexProjectId: () => Promise<string>;
      initializeAppServer: () => Promise<void>; startTurn: (thread: string, text: string) => Promise<unknown>;
      buildProcessEnv: () => NodeJS.ProcessEnv }
    internal.resolveCodexProjectId = async () => 'project'
    internal.sendRpc = vi.fn(async (method: string) => method === 'thread/start' ? { thread: { id: 'exact-thread' } } : {})
    await internal.initializeAppServer()
    expect(internal.sendRpc).toHaveBeenCalledWith('thread/start', expect.objectContaining(codexThreadPermissionParams(settings)))
    await internal.initializeAppServer()
    expect(internal.sendRpc).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ ...codexThreadPermissionParams(settings), threadId: 'exact-thread' }))
    await internal.startTurn('exact-thread', 'test')
    expect(internal.sendRpc).toHaveBeenCalledWith('turn/start', expect.objectContaining(codexTurnPermissionParams(settings, directory)))
    expect(internal.buildProcessEnv().CODEX_HOME).toBe(directory)
  })
  it('rejects external-writer fallback for nondefault settings rather than silently ignoring them', async () => {
    const adapter = new CodexAdapter()
    adapter.configure({ codexSettings: { ...defaults, sandbox: 'read-only' } })
    await adapter.start('test', directory, 'existing-thread')
    const internal = adapter as unknown as { ensureAppServer: () => Promise<void> }
    internal.ensureAppServer = async () => { throw new Error('thread existing-thread already has an active writer') }
    await expect(adapter.prepareSend('test')).rejects.toThrow('codex_settings_external_owner_unsupported')
  })
  it('does not let a closing old app-server reject the next turn transport requests', async () => {
    const adapter = new CodexAdapter()
    const oldProcess = Object.assign(new EventEmitter(), { kill: vi.fn() })
    const oldReject = vi.fn(), nextReject = vi.fn()
    const internal = adapter as unknown as { process: unknown; pendingRequests: Map<number, unknown>;
      killProcess: () => Promise<void> }
    internal.process = oldProcess
    internal.pendingRequests.set(1, { reject: oldReject, timer: setTimeout(() => {}, 10000) })
    const stopping = internal.killProcess()
    expect(oldReject).toHaveBeenCalled()
    const nextTimer = setTimeout(() => {}, 10000)
    internal.pendingRequests.set(2, { reject: nextReject, timer: nextTimer })
    oldProcess.emit('close', 0)
    await stopping
    expect(nextReject).not.toHaveBeenCalled()
    expect(internal.pendingRequests.has(2)).toBe(true)
    clearTimeout(nextTimer)
    internal.pendingRequests.clear()
  })
  it('keeps a custom Codex home in the durable cleanup job after the session record is purged', async () => {
    const execute = vi.fn(async () => ({ outcome: 'archived' as const }))
    const options = { rootDir: directory, daemonInstallationId: 'test-installation', sourceGuard: () => true,
      lifecycle: { execute } }
    const outbox = new NativeSessionCleanupOutbox(options)
    outbox.enqueue({ sessionId: 'test-session', deletionRevision: 1, deletedAt: new Date().toISOString(),
      nativeCleanupPolicy: 'auto', workDir: directory,
      sources: [{ agentType: 'codex', sourceSessionKey: '00000000-0000-4000-8000-000000000001' }] }, directory)
    const reloaded = new NativeSessionCleanupOutbox(options)
    await reloaded.drain()
    expect(execute).toHaveBeenCalledWith('codex', '00000000-0000-4000-8000-000000000001', { workDir: directory, codexHome: directory })
    expect(reloaded.listJobs()[0]?.state).toBe('succeeded_archived')
  })
  it('keeps legacy defaults and never passes full access when a read-only sandbox was selected', () => {
    expect(codexThreadPermissionParams()).toEqual({ approvalPolicy: 'never', sandbox: 'danger-full-access', config: { 'features.default_mode_request_user_input': true } })
    expect(codexTurnPermissionParams({ ...defaults, sandbox: 'read-only' }, directory)).toEqual({ approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } })
  })
})

describe('Codex remote one-shot approvals', () => {
  it('binds to the active thread and turn; accepts once, rejects stale IDs and duplicate answers', () => {
    const reply = vi.fn(), emit = vi.fn()
    const approvals = new CodexApprovals(reply, emit)
    approvals.request('item/commandExecution/requestApproval', 51, { threadId: 'thread', turnId: 'turn', command: 'echo hello' }, 'thread', 'turn', false)
    const event = emit.mock.calls[0]?.[0] as AgentEvent
    expect(event.permission?.options.map((item) => item.id)).toEqual(['accept', 'decline'])
    expect(() => approvals.respond(event.permission!.id, 'accept', 'other')).toThrow('codex_approval_expired')
    approvals.respond(event.permission!.id, 'accept', 'turn')
    expect(reply).toHaveBeenCalledWith(51, { decision: 'accept' })
    expect(() => approvals.respond(event.permission!.id, 'accept', 'turn')).toThrow()
  })
  it('declines managed/foreign prompts and cannot choose a decision the provider did not offer', () => {
    const reply = vi.fn(), emit = vi.fn()
    const approvals = new CodexApprovals(reply, emit)
    approvals.request('item/fileChange/requestApproval', 1, { threadId: 'thread', turnId: 'turn' }, 'thread', 'turn', true)
    approvals.request('item/fileChange/requestApproval', 2, { threadId: 'foreign', turnId: 'turn' }, 'thread', 'turn', false)
    expect(reply.mock.calls).toEqual([[1, { decision: 'decline' }], [2, { decision: 'decline' }]])
    approvals.request('item/commandExecution/requestApproval', 3, { threadId: 'thread', turnId: 'turn', availableDecisions: ['decline'] }, 'thread', 'turn', false)
    const event = emit.mock.calls[0]?.[0] as AgentEvent
    expect(event.permission?.options.map((item) => item.id)).toEqual(['decline'])
    expect(() => approvals.respond(event.permission!.id, 'accept', 'turn')).toThrow('codex_approval_invalid')
    approvals.clear()
    expect(reply).toHaveBeenLastCalledWith(3, { decision: 'decline' })
  })
  it('refuses supplemental permission grants without changing sandbox policy', () => {
    const reply = vi.fn(), emit = vi.fn()
    const approvals = new CodexApprovals(reply, emit)
    expect(approvals.request('item/permissions/requestApproval', 5, { threadId: 'thread', turnId: 'turn' }, 'thread', 'turn', false)).toBe(true)
    expect(reply).toHaveBeenCalledWith(5, { permissions: {}, scope: 'turn' })
    expect(emit).not.toHaveBeenCalled()
  })
  it('clears resolved and interrupted approvals without granting persistent access', () => {
    const reply = vi.fn(), emit = vi.fn()
    const approvals = new CodexApprovals(reply, emit)
    approvals.request('item/fileChange/requestApproval', 'rpc', { threadId: 'thread', turnId: 'turn' }, 'thread', 'turn', false)
    const id = (emit.mock.calls[0]?.[0] as AgentEvent).permission!.id
    approvals.resolved('rpc')
    expect(() => approvals.respond(id, 'accept', 'turn')).toThrow()
    approvals.clear()
    expect(reply).not.toHaveBeenCalled()
  })
})
