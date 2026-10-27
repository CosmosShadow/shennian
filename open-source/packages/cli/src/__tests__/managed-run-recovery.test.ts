// @covers open-source/packages/cli/src/session/handlers/chat.ts

import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentAdapter,
  registerAgent,
  unregisterAgent,
  type AgentSendContext,
} from '../agents/adapter.js'
import { recoverJournaledRun } from '../session/handlers/chat-recovery.js'
import type { PreparedManagedRoomTurn } from '../session/queue.js'
import type { RunJournalRecord } from '../session/run-recovery/schema.js'
import type { SessionManagerRuntime } from '../session/types.js'

const agentType = 'custom:managed-recovery-fixture' as const
let adapter: FixtureAdapter

class FixtureAdapter extends AgentAdapter {
  readonly type = agentType
  readonly starts: unknown[][] = []
  readonly sends: Array<{ text: string; context?: AgentSendContext }> = []
  readonly configurations: Array<Record<string, unknown>> = []
  override get recoveryCapabilities() {
    return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true }
  }
  async start(...args: [string, string, string | null | undefined]) { this.starts.push(args) }
  configure(options: Record<string, unknown>) { this.configurations.push(options) }
  async send(text: string, _model?: string, _effort?: string, _attachments?: never, _prompt?: string | null, context?: AgentSendContext) {
    this.sends.push({ text, context })
  }
  async resume() {}
  async stop() {}
}

afterEach(() => unregisterAgent(agentType))

function record(source: RunJournalRecord['source'] = 'managed_direct'): RunJournalRecord {
  const managed = prepared()
  return {
    schemaVersion: 1, daemonInstallationId: 'install', sessionId: 'session', runId: 'run',
    clientMessageId: 'message', agentType, sessionMode: 'standard', workDir: '/workspace',
    agentSessionId: 'native-session', modelId: null, reasoningEffort: null,
    nativeSessionVisibility: 'user', providerRunId: 'provider-run', lastObservedEventSeq: 2,
    phase: 'running', source, parentSessionId: source === 'manager_worker' ? 'parent' : null,
    roomContextRegistryKey: source === 'managed_room' ? 'registry' : null,
    activationCauseMessageId: source === 'managed_room' ? 'cause' : null,
    rootCauseMessageId: source === 'managed_room' ? 'root' : null,
    activationSequence: source === 'managed_room' ? '1' : null,
    activationHopCount: source === 'managed_room' ? 0 : null,
    upgradeJobId: 'upgrade', interruptionReason: 'planned_upgrade',
    managedPolicyVersion: source === 'personal' ? null : managed.managedRoomPromptSnapshot.managedRoomPolicyVersion,
    managedRuntimePolicyHash: source === 'personal' ? null : managed.managedRoomPromptSnapshot.runtimePermissionPolicyHash,
    continueDispatchState: 'none', deliveryMode: 'direct', externalRunId: null,
    recoveryAttempts: 0,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  }
}

function prepared(): PreparedManagedRoomTurn {
  const requestedPolicy = {
    version: 1, fileAccess: 'workspace-write' as const,
    externalCapabilities: {
      commandNetwork: false, webSearch: false, browser: false, computerUse: false, mcp: false,
    },
  }
  const enforcement = {
    level: 'hard' as const, effectivePolicy: requestedPolicy, unsupportedCapabilities: [],
    runtimeVersion: '1', platform: 'darwin',
  }
  return {
    agentType, workDir: '/workspace', agentSessionId: 'native-session',
    systemPrompt: 'fresh managed prompt', sessionMode: 'standard' as const, managerConfig: null,
    managerDefaultWorkerAgentType: null, managerDefaultWorkerModelId: null,
    roomContextRegistryKey: 'a'.repeat(64), managedRoomContextToken: `mrc_${'b'.repeat(43)}`,
    managedAgentPolicy: {
      requestedPolicy, enforcement,
      adapterPolicy: {
        version: 1, workDir: '/workspace', fileAccess: 'workspace-write' as const,
        externalCapabilities: requestedPolicy.externalCapabilities,
        denySensitiveFiles: true, failClosed: true,
      },
      environmentPolicy: {
        inheritDaemonEnv: false, loadLoginShell: false, providerEnvKeys: [], sessionEnvKeys: [],
        shellSubprocess: { inherit: 'none' as const, allowedEnvKeys: [], deniedEnvKeys: [] },
      },
    },
    managedRoomPromptSnapshot: {
      providerBaseVersion: 'provider-owned', managedRoomPolicyVersion: 'managed-room-surface-v9',
      sessionModeInstructionsHash: null, agentSystemPromptHash: null,
      runtimePermissionPolicyHash: createHash('sha256')
        .update(JSON.stringify({ requestedPolicy, enforcement })).digest('hex'),
      resolvedWorkDirHash: createHash('sha256').update('/workspace').digest('hex'),
      enforcementLevel: 'hard' as const, trustedRoomContextHash: 'c'.repeat(64),
      allowedRoomOperations: [],
    },
  }
}

function runtime(prepareManagedRecovery: SessionManagerRuntime['prepareManagedRecovery']): SessionManagerRuntime {
  return {
    client: { sendEvent: vi.fn(), sendAgentEvent: vi.fn() } as never,
    pendingTransfers: new Map(), processedReqIds: new Set(), reloadCustomAgents: vi.fn(),
    resolvePath: (value) => value, resolveAuthorizedPath: vi.fn() as never,
    resolveAuthorizedPathAsync: vi.fn() as never, runTextAcc: new Map(), sessions: new Map(),
    evictIdleSessions: vi.fn(), nativeFusion: null, managerRuntime: null, chatQueue: null,
    prepareManagedRecovery,
  }
}

describe('managed Run recovery', () => {
  it('rebuilds current authority, issues a fresh token, and sends only internal Continue', async () => {
    adapter = new FixtureAdapter()
    registerAgent(agentType, () => adapter)
    const prepareManagedRecovery = vi.fn(async () => prepared())
    const beforeContinueDispatch = vi.fn()
    expect(await recoverJournaledRun(runtime(prepareManagedRecovery), record('managed_room'), beforeContinueDispatch))
      .toEqual({ result: 'continued' })
    expect(prepareManagedRecovery).toHaveBeenCalledOnce()
    expect(adapter.starts[0]).toEqual(['session', '/workspace', 'native-session'])
    expect(adapter.sends).toEqual([expect.objectContaining({
      text: 'Continue.',
      context: expect.objectContaining({ source: 'room_activation', recovery: 'upgrade' }),
    })])
    expect(beforeContinueDispatch).toHaveBeenCalledOnce()
  })

  it('fails closed after revocation without starting or continuing an Agent', async () => {
    adapter = new FixtureAdapter()
    registerAgent(agentType, () => adapter)
    expect(await recoverJournaledRun(runtime(async () => null), record())).toMatchObject({
      result: 'recovery_failed', reason: 'permission_context_unavailable',
    })
    expect(adapter.starts).toEqual([])
    expect(adapter.sends).toEqual([])
  })

  it('fails closed when the current managed policy version or hash changed', async () => {
    adapter = new FixtureAdapter()
    registerAgent(agentType, () => adapter)
    const changed = prepared()
    ;(changed.managedRoomPromptSnapshot as { managedRoomPolicyVersion: string }).managedRoomPolicyVersion = 'v2'
    expect(await recoverJournaledRun(runtime(async () => changed), record())).toMatchObject({
      result: 'recovery_failed', reason: 'permission_context_unavailable',
    })
    expect(adapter.starts).toEqual([])
    expect(adapter.sends).toEqual([])
  })

  it.each(['managed_direct', 'manager_event'] as const)('recovers private %s with a freshly issued private capability', async source => {
    adapter = new FixtureAdapter()
    registerAgent(agentType, () => adapter)
    const current = prepared()
    const managerRuntime = runtime(vi.fn(async () => current))
    const revokeManagedRoomContextToken = vi.fn()
    managerRuntime.revokeManagedRoomContextToken = revokeManagedRoomContextToken

    await expect(recoverJournaledRun(managerRuntime, record(source)))
      .resolves.toEqual({ result: 'continued' })

    expect(revokeManagedRoomContextToken).not.toHaveBeenCalled()
    expect(adapter.configurations.at(-1)).toMatchObject({
      managedAgentPolicy: current.managedAgentPolicy,
    })
    expect(adapter.configurations.at(-1)).toMatchObject({
      env: {
        SHENNIAN_MANAGED_ROOM_CONTEXT: current.managedRoomContextToken,
        SHENNIAN_MANAGED_ROOM_IPC_ROOT: expect.any(String),
      },
    })
    expect(adapter.sends).toEqual([expect.objectContaining({
      text: 'Continue.',
      context: {
        source: 'managed_private',
        recovery: 'upgrade',
        modelSelectionSource: 'upgrade_recovery_model',
      },
    })])
  })

  it('recovers a standalone Agent with fresh policy and no Room capability', async () => {
    adapter = new FixtureAdapter()
    registerAgent(agentType, () => adapter)
    const current = { ...prepared(), standalone: true as const,
      managedRoomContextToken: '', roomContextRegistryKey: '' }
    await expect(recoverJournaledRun(runtime(async () => current), record('managed_direct')))
      .resolves.toEqual({ result: 'continued' })
    expect(adapter.configurations.at(-1)).toMatchObject({ managedAgentPolicy: current.managedAgentPolicy })
    expect((adapter.configurations.at(-1)?.env as Record<string, unknown>)).not.toHaveProperty('SHENNIAN_MANAGED_ROOM_CONTEXT')
    expect(adapter.sends[0]?.context).toMatchObject({ source: 'managed_private', recovery: 'upgrade' })
  })

  it('rebuilds a Manager worker only from the current parent policy', async () => {
    adapter = new FixtureAdapter()
    registerAgent(agentType, () => adapter)
    const current = prepared().managedAgentPolicy
    const workerRuntime = runtime(undefined)
    workerRuntime.managerRuntime = {
      getManagedAgentPolicyForWorker: () => current,
    } as never
    await expect(recoverJournaledRun(workerRuntime, record('manager_worker')))
      .resolves.toEqual({ result: 'continued' })
    expect(adapter.sends[0]).toMatchObject({
      text: 'Continue.', context: { source: 'upgrade_recovery', recovery: 'upgrade' },
    })

    adapter = new FixtureAdapter()
    registerAgent(agentType, () => adapter)
    workerRuntime.managerRuntime = null
    await expect(recoverJournaledRun(workerRuntime, record('manager_worker'))).resolves.toMatchObject({
      result: 'recovery_failed', reason: 'permission_context_unavailable',
    })
    expect(adapter.sends).toEqual([])
  })
})
