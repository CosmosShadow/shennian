// @covers open-source/packages/cli/src/agents/adapter.ts
// @covers open-source/packages/cli/src/agents/claude.ts
// @covers open-source/packages/cli/src/agents/codex.ts
// @covers open-source/packages/cli/src/agents/workbuddy.ts
// @covers open-source/packages/cli/src/agents/cursor.ts
// @covers open-source/packages/cli/src/agents/opencode.ts
// @covers open-source/packages/cli/src/agents/pi-coding-agent.ts
// @covers open-source/packages/cli/src/agents/gemini.ts

import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter, AgentRecoveryInput } from '../agents/adapter.js'
import { ClaudeAdapter } from '../agents/claude.js'
import { CodexAdapter } from '../agents/codex.js'
import { WorkBuddyAdapter } from '../agents/workbuddy.js'
import { CursorAdapter } from '../agents/cursor.js'
import { OpenCodeAdapter } from '../agents/opencode.js'
import { PiCodingAgentAdapter } from '../agents/pi-coding-agent.js'
import { GeminiAdapter } from '../agents/gemini.js'

const adapters: Array<[string, () => AgentAdapter]> = [
  ['Claude Code', () => new ClaudeAdapter()],
  ['Codex', () => new CodexAdapter()],
  ['WorkBuddy', () => new WorkBuddyAdapter()],
  ['Cursor', () => new CursorAdapter()],
  ['OpenCode', () => new OpenCodeAdapter()],
  ['Pi', () => new PiCodingAgentAdapter()],
  ['Gemini compatibility', () => new GeminiAdapter()],
]

function input(patch: Partial<AgentRecoveryInput> = {}): AgentRecoveryInput {
  return {
    sessionId: 'shennian-session', shennianRunId: 'run', workDir: '/exact/workspace',
    agentSessionId: 'exact-native-session', modelId: 'model', reasoningEffort: 'high',
    providerRunId: 'provider-turn', lastObservedEventSeq: 7, continueDispatchState: 'none',
    sendContext: { source: 'upgrade_recovery', recovery: 'upgrade' },
    ...patch,
  }
}

describe.each(adapters)('%s built-in upgrade recovery conformance', (_name, create) => {
  it('declares honest session-only recovery and dispatches exactly one internal Continue', async () => {
    const adapter = create()
    const send = vi.fn(async () => {})
    Object.defineProperty(adapter, 'send', { value: send })
    const before = vi.fn()
    await expect(adapter.recoverInterruptedRun(input({ beforeContinueDispatch: before })))
      .resolves.toEqual({ result: 'continued' })
    expect(before).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      'Continue.', 'model', 'high', undefined, undefined,
      { source: 'upgrade_recovery', recovery: 'upgrade' },
    )
    expect(adapter.recoveryCapabilities).toEqual({
      inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true,
    })
  })

  it('never duplicates an uncertain Continue and never invents a missing native session', async () => {
    const adapter = create()
    const send = vi.fn(async () => {})
    Object.defineProperty(adapter, 'send', { value: send })
    await expect(adapter.recoverInterruptedRun(input({ continueDispatchState: 'intent' })))
      .resolves.toEqual({
        result: 'recovery_failed', reason: 'continue_dispatch_outcome_unknown',
      })
    await expect(adapter.recoverInterruptedRun(input({ agentSessionId: null })))
      .resolves.toEqual({ result: 'interrupted_by_upgrade', reason: 'missing_agent_session' })
    expect(send).not.toHaveBeenCalled()
  })
})
