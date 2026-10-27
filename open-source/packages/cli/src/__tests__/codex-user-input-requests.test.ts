// @covers src/agents/codex-user-input-requests.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexUserInputRequests } from '../agents/codex-user-input-requests.js'
import type { AgentEvent } from '../agents/adapter.js'
afterEach(() => vi.useRealTimers())
const input = { threadId: 'thread', turnId: 'turn', itemId: 'item', questions: [{ id: 'choice', question: 'Which?', options: [{ label: 'A', description: 'first' }], isOther: false }, { id: 'name', question: 'Name?' }] }
describe('Codex user input RPC', () => {
  it('answers the original request exactly once with a complete question-to-answer mapping', () => {
    const reply = vi.fn(), events: Array<Omit<AgentEvent, 'runId' | 'seq'>> = []
    const requests = new CodexUserInputRequests(reply, e => events.push(e))
    requests.request(42, input, 'thread', 'turn', false)
    const id = events[0]!.permission!.id
    expect(events[0]?.runPhase).toBe('waiting_user_input')
    expect(reply).not.toHaveBeenCalled()
    expect(() => requests.respond(id, 'input:{"choice":"A"}', 'turn')).toThrow()
    expect(() => requests.respond(id, 'input:{"choice":"A","name":"Sam"}', 'other-turn')).toThrow('expired')
    requests.respond(id, 'input:{"choice":"A","name":"Sam"}', 'turn')
    expect(reply).toHaveBeenCalledWith(42, { answers: { choice: { answers: ['A'] }, name: { answers: ['Sam'] } } })
    expect(() => requests.respond(id, 'input:{}', 'turn')).toThrow('expired')
    expect(reply).toHaveBeenCalledTimes(1)
  })
  it('never exposes foreign requests or grants permissions for managed contexts', () => {
    const reply = vi.fn(), emit = vi.fn(), requests = new CodexUserInputRequests(reply, emit)
    requests.request(1, input, 'foreign', 'turn', false)
    requests.request(2, input, 'thread', 'turn', true)
    expect(emit).not.toHaveBeenCalled()
    expect(reply.mock.calls).toEqual([[1, { answers: {} }], [2, { answers: {} }]])
  })
  it('expires and resolves pending questions without leaving a usable stale response', () => {
    vi.useFakeTimers(); const reply = vi.fn(), emit = vi.fn(), requests = new CodexUserInputRequests(reply, emit)
    requests.request(1, input, 'thread', 'turn', false)
    const id = emit.mock.calls[0]![0].permission.id
    requests.resolved(1)
    expect(() => requests.respond(id, 'input:{}', 'turn')).toThrow('expired')
    requests.request(2, input, 'thread', 'turn', false)
    vi.advanceTimersByTime(300000)
    expect(reply).toHaveBeenCalledWith(2, { answers: {} })
    requests.clear()
  })
})
