// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/run-recovery-coordinator.test.ts

import type { AgentRecoveryResult } from '../../agents/adapter.js'
import type { ActiveRunJournal } from './journal.js'
import type { RunRecoveryBarrier } from './barrier.js'
import { isRecoverableJournalPhase, type RunJournalRecord } from './schema.js'

export type RecoveryTerminal = Extract<
  AgentRecoveryResult,
  { result: 'interrupted_by_upgrade' | 'recovery_failed' }
>
type RecoveryFailedReason = Extract<
  RecoveryTerminal,
  { result: 'recovery_failed' }
>['reason']

const RECOVERY_FAILED_REASONS = new Set<RecoveryFailedReason>([
  'continue_dispatch_outcome_unknown',
  'provider_session_missing',
  'provider_identity_mismatch',
  'authentication_required',
  'permission_context_unavailable',
  'provider_error',
])

function isRecoveryFailedReason(value: unknown): value is RecoveryFailedReason {
  return typeof value === 'string' && RECOVERY_FAILED_REASONS.has(value as RecoveryFailedReason)
}

export class RunRecoveryCoordinator {
  private pendingBySession = new Map<string, Set<string>>()

  constructor(private readonly deps: {
    journal: ActiveRunJournal
    barrier: RunRecoveryBarrier
    recover(record: RunJournalRecord, beforeContinueDispatch: () => void): Promise<AgentRecoveryResult>
    commitTerminal(record: RunJournalRecord, result: RecoveryTerminal): Promise<void>
    /** True only when the local canonical transaction for this run already committed. */
    isCanonicalTerminal?: (record: RunJournalRecord) => boolean
    onOutcome?: (outcome: {
      adapterType: string
      source: RunJournalRecord['source']
      result: AgentRecoveryResult['result']
      attempts: number
      durationMs: number
      reason?: string
    }) => void
    maxAttempts?: number
  }) {}

  async recoverAll(): Promise<void> {
    const records = this.deps.journal.loadPendingReconciliation().records
    const bySession = new Map<string, RunJournalRecord[]>()
    for (const record of records) {
      this.deps.barrier.begin(record.sessionId)
      const pending = this.pendingBySession.get(record.sessionId) ?? new Set<string>()
      pending.add(record.runId)
      this.pendingBySession.set(record.sessionId, pending)
      const entries = bySession.get(record.sessionId) ?? []
      entries.push(record)
      bySession.set(record.sessionId, entries)
    }
    const primary = [...bySession.values()].filter(
      (entries) => entries.some((entry) => entry.source !== 'manager_worker'),
    )
    const workers = [...bySession.values()].filter(
      (entries) => entries.every((entry) => entry.source === 'manager_worker'),
    )
    const recoverGroups = (groups: RunJournalRecord[][]) => Promise.all(groups.map(async (entries) => {
      const recoverable = entries.filter((entry) => isRecoverableJournalPhase(entry.phase))
      const newestRecoverable = recoverable.at(-1)

      // Dispatch is serialized per Session, so a later recoverable record is
      // durable proof that every earlier record from that Session already
      // crossed its terminal boundary. Older versions failed to unlink
      // external-owner Codex records at that boundary. Never turn those stale
      // records into a burst of synthetic Continue turns after an upgrade.
      for (const stale of recoverable.slice(0, -1)) {
        this.completeFromProvider(stale.sessionId, stale.runId)
      }

      for (const record of entries) {
        if (isRecoverableJournalPhase(record.phase) && record !== newestRecoverable) continue
        await this.recoverOne(record)
      }
    }))
    // A managed Manager rebuilds the current policy authority used by its
    // private workers. Recover parents first so workers never inherit stale or
    // absent capability state after daemon restart.
    await recoverGroups(primary)
    await recoverGroups(workers)
  }

  completeFromProvider(sessionId: string, runId: string): void {
    this.deps.journal.remove(sessionId, runId)
    const pending = this.pendingBySession.get(sessionId)
    pending?.delete(runId)
    if (!pending || pending.size === 0) {
      this.pendingBySession.delete(sessionId)
      this.deps.barrier.end(sessionId)
    }
  }

  private async recoverOne(record: RunJournalRecord): Promise<void> {
    // A crash can happen after the canonical terminal transaction but before
    // the journal unlink. Never manufacture a Continue turn in that window.
    if (this.deps.isCanonicalTerminal?.(record)) {
      this.completeFromProvider(record.sessionId, record.runId)
      return
    }
    if (record.phase === 'aborted') {
      this.completeFromProvider(record.sessionId, record.runId)
      return
    }
    if (record.phase === 'interrupted_by_upgrade' || record.phase === 'recovery_failed') {
      const terminal: RecoveryTerminal = record.phase === 'interrupted_by_upgrade'
        ? {
            result: 'interrupted_by_upgrade',
            reason: record.recoveryReason === 'missing_agent_session'
              ? 'missing_agent_session'
              : 'resume_unsupported',
          }
        : {
            result: 'recovery_failed',
            reason: isRecoveryFailedReason(record.recoveryReason)
              ? record.recoveryReason
              : 'provider_error',
          }
      await this.deps.commitTerminal(record, terminal)
      this.completeFromProvider(record.sessionId, record.runId)
      return
    }
    const attempt = record.recoveryAttempts + 1
    const startedAt = Date.now()
    let recovering = this.deps.journal.update(record.sessionId, record.runId, {
      phase: 'recovering',
      recoveryAttempts: attempt,
    }) ?? record
    let result: AgentRecoveryResult
    try {
      result = await this.deps.recover(recovering, () => {
        // Persist intent at the narrowest possible point: after inspection and
        // immediately before the provider call that can create a Continue turn.
        recovering = this.deps.journal.update(record.sessionId, record.runId, {
          continueDispatchState: 'intent',
        }) ?? recovering
      })
    } catch (error) {
      const persisted = this.deps.journal.get(record.sessionId, record.runId)
      if (persisted?.phase === 'interrupted_by_upgrade' || persisted?.phase === 'recovery_failed') {
        // The provider outcome was already persisted. A canonical commit
        // failure must be replayed on the next boot, never reclassified as a
        // different provider recovery failure.
        throw error
      }
      const maxAttempts = this.deps.maxAttempts ?? 3
      if (attempt < maxAttempts) {
        this.deps.journal.update(record.sessionId, record.runId, { phase: 'running' })
        const retryRecord = this.deps.journal.get(record.sessionId, record.runId)
        if (retryRecord) return this.recoverOne(retryRecord)
      }
      this.deps.onOutcome?.({
        adapterType: record.agentType,
        source: record.source,
        result: 'recovery_failed',
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        reason: 'provider_error',
      })
      await this.finishTerminal(record, {
        result: 'recovery_failed',
        reason: 'provider_error',
        message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      })
      return
    }
    this.deps.onOutcome?.({
      adapterType: record.agentType,
      source: record.source,
      result: result.result,
      attempts: attempt,
      durationMs: Date.now() - startedAt,
      ...('reason' in result ? { reason: result.reason } : {}),
    })
    if (result.result === 'continued') {
      this.deps.journal.update(record.sessionId, record.runId, {
        continueDispatchState: 'accepted',
        phase: 'running',
      })
      return
    }
    if (result.result === 'reattached' || result.result === 'resumed') {
      this.deps.journal.update(record.sessionId, record.runId, { phase: 'running' })
      return
    }
    if (result.result === 'terminal_reconciled') {
      this.completeFromProvider(record.sessionId, record.runId)
      return
    }
    await this.finishTerminal(record, result)
  }

  private async finishTerminal(record: RunJournalRecord, result: RecoveryTerminal): Promise<void> {
    this.deps.journal.update(record.sessionId, record.runId, {
      phase: result.result,
      recoveryReason: result.reason,
    })
    await this.deps.commitTerminal(record, result)
    this.completeFromProvider(record.sessionId, record.runId)
  }
}
