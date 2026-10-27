// @covers open-source/packages/cli/src/session/run-recovery/coordinator.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActiveRunJournal } from '../session/run-recovery/journal.js'
import { RunRecoveryBarrier } from '../session/run-recovery/barrier.js'
import { RunRecoveryCoordinator } from '../session/run-recovery/coordinator.js'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-recovery-'))
  roots.push(root)
  const journal = new ActiveRunJournal('install-a', { directory: path.join(root, 'active') })
  const record = journal.begin({
    daemonInstallationId: 'install-a', sessionId: 's1', runId: 'r1', clientMessageId: 'm1',
    agentType: 'codex', sessionMode: 'standard', workDir: '/tmp/p', agentSessionId: 'native-1',
    modelId: 'gpt-5', reasoningEffort: 'high', nativeSessionVisibility: 'user',
    providerRunId: 'turn-1', source: 'personal', parentSessionId: null, roomContextRegistryKey: null,
    activationCauseMessageId: null, rootCauseMessageId: null, activationSequence: null, activationHopCount: null,
  })
  const barrier = new RunRecoveryBarrier()
  return { journal, record, barrier }
}

describe('RunRecoveryCoordinator', () => {
  it('records Continue intent before dispatch and retains the barrier until provider terminal', async () => {
    const { journal, barrier } = fixture()
    const recover = vi.fn(async (record, beforeContinueDispatch: () => void) => {
      expect(record.continueDispatchState).toBe('none')
      expect(journal.get('s1', 'r1')?.continueDispatchState).toBe('none')
      beforeContinueDispatch()
      expect(journal.get('s1', 'r1')?.continueDispatchState).toBe('intent')
      return { result: 'continued' as const }
    })
    const coordinator = new RunRecoveryCoordinator({ journal, barrier, recover, commitTerminal: vi.fn() })
    await coordinator.recoverAll()
    expect(recover).toHaveBeenCalledOnce()
    expect(journal.get('s1', 'r1')).toMatchObject({ phase: 'running', continueDispatchState: 'accepted' })
    expect(barrier.isRecovering('s1')).toBe(true)
    coordinator.completeFromProvider('s1', 'r1')
    expect(barrier.isRecovering('s1')).toBe(false)
  })

  it('commits one explicit interruption for a non-resumable adapter', async () => {
    const { journal, barrier } = fixture()
    const commitTerminal = vi.fn(async () => {})
    const coordinator = new RunRecoveryCoordinator({
      journal, barrier, commitTerminal,
      recover: async () => ({ result: 'interrupted_by_upgrade', reason: 'resume_unsupported' }),
    })
    await coordinator.recoverAll()
    expect(commitTerminal).toHaveBeenCalledOnce()
    expect(journal.loadRecoverable().records).toEqual([])
    expect(barrier.isRecovering('s1')).toBe(false)
  })

  it('does not send a second Continue when a prior dispatch outcome is uncertain', async () => {
    const { journal, barrier } = fixture()
    journal.update('s1', 'r1', { continueDispatchState: 'intent' })
    const recover = vi.fn(async (record) => {
      expect(record.continueDispatchState).toBe('intent')
      return { result: 'recovery_failed' as const, reason: 'continue_dispatch_outcome_unknown' as const }
    })
    const commitTerminal = vi.fn(async () => {})
    await new RunRecoveryCoordinator({ journal, barrier, recover, commitTerminal }).recoverAll()
    expect(recover).toHaveBeenCalledOnce()
    expect(commitTerminal).toHaveBeenCalledOnce()
  })

  it('replays a terminal commit after a crash without invoking the provider again', async () => {
    const { journal, barrier } = fixture()
    const failedCommit = vi.fn(async () => { throw new Error('canonical store unavailable') })
    await expect(new RunRecoveryCoordinator({
      journal,
      barrier,
      recover: async () => ({ result: 'interrupted_by_upgrade', reason: 'resume_unsupported' }),
      commitTerminal: failedCommit,
    }).recoverAll()).rejects.toThrow('canonical store unavailable')
    expect(journal.loadPendingReconciliation().records[0]).toMatchObject({
      phase: 'interrupted_by_upgrade',
      recoveryReason: 'resume_unsupported',
    })

    const recover = vi.fn()
    const successfulCommit = vi.fn(async () => {})
    await new RunRecoveryCoordinator({ journal, barrier: new RunRecoveryBarrier(), recover, commitTerminal: successfulCommit }).recoverAll()
    expect(recover).not.toHaveBeenCalled()
    expect(successfulCommit).toHaveBeenCalledOnce()
    expect(journal.loadPendingReconciliation().records).toEqual([])
  })

  it('removes a journal left after canonical terminal commit without sending Continue', async () => {
    const { journal, barrier, record } = fixture()
    const recover = vi.fn()
    const commitTerminal = vi.fn()
    await new RunRecoveryCoordinator({
      journal,
      barrier,
      recover,
      commitTerminal,
      isCanonicalTerminal: (candidate) => candidate.runId === record.runId,
    }).recoverAll()
    expect(recover).not.toHaveBeenCalled()
    expect(commitTerminal).not.toHaveBeenCalled()
    expect(journal.loadPendingReconciliation().records).toEqual([])
    expect(barrier.isRecovering(record.sessionId)).toBe(false)
  })

  it('collapses stale same-session records and dispatches at most one Continue', async () => {
    const { journal, barrier } = fixture()
    journal.begin({
      daemonInstallationId: 'install-a', sessionId: 's1', runId: 'r2', clientMessageId: 'm2',
      agentType: 'codex', sessionMode: 'standard', workDir: '/tmp/p', agentSessionId: 'native-1',
      modelId: null, reasoningEffort: null, nativeSessionVisibility: 'user', providerRunId: 'turn-2',
      source: 'personal', parentSessionId: null, roomContextRegistryKey: null,
      activationCauseMessageId: null, rootCauseMessageId: null, activationSequence: null,
      activationHopCount: null,
    })
    let calls = 0
    const coordinator = new RunRecoveryCoordinator({
      journal,
      barrier,
      recover: async () => {
        calls += 1
        return { result: 'continued' }
      },
      commitTerminal: async () => {},
    })
    await coordinator.recoverAll()
    expect(calls).toBe(1)
    expect(journal.get('s1', 'r1')).toBeNull()
    expect(journal.get('s1', 'r2')).toMatchObject({
      phase: 'running',
      continueDispatchState: 'accepted',
    })
    expect(barrier.isRecovering('s1')).toBe(true)
  })
})
