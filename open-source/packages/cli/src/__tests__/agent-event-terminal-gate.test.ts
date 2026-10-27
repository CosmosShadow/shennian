// @arch open-source/docs/cli-runtime.md
// @covers src/agents/event-terminal-gate.ts

import { describe, expect, it } from 'vitest'
import type { AgentType } from '@shennian/wire'
import type { AgentEvent } from '../agents/adapter.js'
import { AgentEventTerminalGate } from '../agents/event-terminal-gate.js'

const CONTRACT_RUNTIMES = [
  'claude',
  'codex',
  'workbuddy',
  'cursor',
  'opencode',
  'pi-coding-agent',
  'custom:contract',
  'acp:contract',
] as const satisfies readonly AgentType[]

function event(runId: string, seq: number, state: string, extra: Partial<AgentEvent> = {}): AgentEvent {
  return { runId, seq, state, ...extra }
}

function visible(events: AgentEvent[]): AgentEvent[] {
  const gate = new AgentEventTerminalGate()
  return events.filter((item) => gate.accept(item))
}

describe.each(CONTRACT_RUNTIMES)('%s shared terminal contract', (runtime) => {
  it('keeps retry and recovered progress non-terminal before one success', () => {
    const events = visible([
      event(`${runtime}-retry`, 0, 'start'),
      event(`${runtime}-retry`, 1, 'heartbeat', { runPhase: 'thinking' }),
      event(`${runtime}-retry`, 2, 'delta', { text: 'recovered' }),
      event(`${runtime}-retry`, 3, 'final'),
    ])
    expect(events.map((item) => item.state)).toEqual(['start', 'heartbeat', 'delta', 'final'])
  })

  it.each(['error', 'aborted'] as const)('accepts one %s terminal and suppresses every late event', (terminal) => {
    const events = visible([
      event(`${runtime}-${terminal}`, 0, 'start'),
      event(`${runtime}-${terminal}`, 1, terminal, { message: terminal }),
      event(`${runtime}-${terminal}`, 2, terminal, { message: 'duplicate' }),
      event(`${runtime}-${terminal}`, 3, 'delta', { text: 'late text' }),
      event(`${runtime}-${terminal}`, 4, 'tool-result', { result: 'late tool' }),
      event(`${runtime}-${terminal}`, 5, 'final'),
    ])
    expect(events.map((item) => item.state)).toEqual(['start', terminal])
  })

  it('isolates consecutive runs so a queued follow-up can drain normally', () => {
    const events = visible([
      event(`${runtime}-first`, 0, 'start'),
      event(`${runtime}-first`, 1, 'final'),
      event(`${runtime}-second`, 0, 'start'),
      event(`${runtime}-second`, 1, 'delta', { text: 'complete transcript' }),
      event(`${runtime}-second`, 2, 'final'),
    ])
    expect(events.map((item) => [item.runId, item.state])).toEqual([
      [`${runtime}-first`, 'start'],
      [`${runtime}-first`, 'final'],
      [`${runtime}-second`, 'start'],
      [`${runtime}-second`, 'delta'],
      [`${runtime}-second`, 'final'],
    ])
  })
})

it('bounds remembered terminal run ids for a long-lived adapter binding', () => {
  const gate = new AgentEventTerminalGate(2)
  expect(gate.accept(event('run-1', 0, 'final'))).toBe(true)
  expect(gate.accept(event('run-2', 0, 'final'))).toBe(true)
  expect(gate.accept(event('run-3', 0, 'final'))).toBe(true)
  expect(gate.accept(event('run-1', 1, 'start'))).toBe(true)
})
