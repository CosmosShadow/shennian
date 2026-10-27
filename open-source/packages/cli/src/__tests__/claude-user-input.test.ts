// @covers src/agents/claude.ts
import { expect, it } from 'vitest'
import { ClaudeAdapter } from '../agents/claude.js'
import type { AgentEvent } from '../agents/adapter.js'

it('resolves the original Claude input tool only with the bound user answer', async () => {
  const adapter = new ClaudeAdapter()
  adapter.configure({ sessionId: 'test-input-session' })
  const internal = adapter as unknown as { runId: string; requestClaudeUserInput(input: unknown): Promise<unknown> }
  internal.runId = 'test-turn'
  const events: AgentEvent[] = []
  adapter.on('agentEvent', event => events.push(event))
  const result = internal.requestClaudeUserInput({ questions: [{ id: 'choice', question: 'Choose', options: [{ label: 'A' }] }] })
  const permission = events.find(e => e.permission)!.permission!
  expect(permission.questions?.[0]?.id).toBe('choice')
  await expect(adapter.respondToPermission(permission.id, 'input:{"choice":"unlisted"}')).rejects.toThrow('invalid')
  await adapter.respondToPermission(permission.id, 'input:{"choice":"A"}')
  await expect(result).resolves.toEqual({ behavior: 'allow', updatedInput: { answers: { choice: { answers: ['A'] } } } })
  await expect(adapter.respondToPermission(permission.id, 'input:{"choice":"A"}')).rejects.toThrow('expired')
})
