// @covers open-source/packages/cli/src/agents/adapter.ts

import { describe, expect, it, vi } from 'vitest'
import {
  AgentAdapter,
  type AgentSendContext,
  type AgentRecoveryCapabilities,
  type AgentRecoveryInput,
} from '../agents/adapter.js'

class RecoveryFixtureAdapter extends AgentAdapter {
  readonly type = 'codex' as const
  readonly sent: string[] = []
  readonly contexts: unknown[] = []
  active = false
  terminal = false

  constructor(private readonly caps: AgentRecoveryCapabilities) { super() }
  override get recoveryCapabilities() { return this.caps }
  async start() {}
  async send(
    text: string,
    _model?: string,
    _effort?: string,
    _attachments?: import('@shennian/wire').ChatAttachmentMeta[],
    _system?: string | null,
    context?: AgentSendContext,
  ) {
    this.sent.push(text)
    this.contexts.push(context)
  }
  async resume() {}
  async stop() {}
  async getStatus() {
    return { active: this.active, runId: this.active ? 'provider-run' : null, runPhase: null }
  }
  override async inspectInterruptedRun(value: AgentRecoveryInput) {
    if (this.terminal) return { state: 'terminal' as const, providerRunId: value.providerRunId }
    return super.inspectInterruptedRun(value)
  }
}

function input(patch: Partial<AgentRecoveryInput> = {}): AgentRecoveryInput {
  return {
    sessionId: 'session-1',
    shennianRunId: 'run-1',
    workDir: '/tmp/project',
    agentSessionId: 'native-1',
    providerRunId: 'provider-run',
    lastObservedEventSeq: 2,
    continueDispatchState: 'none',
    ...patch,
  }
}

const resumable: AgentRecoveryCapabilities = {
  inspectTerminal: false,
  reattachRun: false,
  resumeRun: false,
  resumeSession: true,
}

describe('AgentAdapter recovery contract', () => {
  it('sends exactly one minimal Continue for session-only recovery', async () => {
    const adapter = new RecoveryFixtureAdapter(resumable)
    const beforeContinueDispatch = vi.fn()
    expect(await adapter.recoverInterruptedRun(input({
      beforeContinueDispatch,
      sendContext: { source: 'upgrade_recovery', recovery: 'upgrade' },
    }))).toEqual({ result: 'continued' })
    expect(beforeContinueDispatch).toHaveBeenCalledOnce()
    expect(adapter.sent).toEqual(['Continue.'])
    expect(adapter.contexts).toEqual([{ source: 'upgrade_recovery', recovery: 'upgrade' }])
  })

  it('reattaches an active run without sending input', async () => {
    const adapter = new RecoveryFixtureAdapter({ ...resumable, reattachRun: true })
    adapter.active = true
    expect(await adapter.recoverInterruptedRun(input())).toEqual({ result: 'reattached' })
    expect(adapter.sent).toEqual([])
  })

  it('reconciles a known terminal without creating a new turn', async () => {
    const adapter = new RecoveryFixtureAdapter({ ...resumable, inspectTerminal: true })
    adapter.terminal = true
    expect(await adapter.recoverInterruptedRun(input())).toEqual({ result: 'terminal_reconciled' })
    expect(adapter.sent).toEqual([])
  })

  it('ends a non-resumable run explicitly without replaying input', async () => {
    const adapter = new RecoveryFixtureAdapter({
      inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: false,
    })
    expect(await adapter.recoverInterruptedRun(input())).toEqual({
      result: 'interrupted_by_upgrade', reason: 'resume_unsupported',
    })
    expect(adapter.sent).toEqual([])
  })

  it('fails closed instead of duplicating an uncertain Continue', async () => {
    const adapter = new RecoveryFixtureAdapter(resumable)
    const spy = vi.spyOn(adapter, 'send')
    expect(await adapter.recoverInterruptedRun(input({ continueDispatchState: 'intent' }))).toEqual({
      result: 'recovery_failed', reason: 'continue_dispatch_outcome_unknown',
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not create a continuation without an exact native session id', async () => {
    const adapter = new RecoveryFixtureAdapter(resumable)
    expect(await adapter.recoverInterruptedRun(input({ agentSessionId: null }))).toEqual({
      result: 'interrupted_by_upgrade', reason: 'missing_agent_session',
    })
    expect(adapter.sent).toEqual([])
  })
})
