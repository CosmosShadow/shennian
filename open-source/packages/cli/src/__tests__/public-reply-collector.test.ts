// @covers open-source/packages/cli/src/agents/public-reply-collector.ts

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter, AgentEvent } from '../agents/adapter.js'
import { collectPublicAgentReply } from '../agents/public-reply-collector.js'

function fakeAdapter() {
  const emitter = new EventEmitter()
  const stop = vi.fn(async () => {})
  const adapter = Object.assign(emitter, { stop }) as unknown as AgentAdapter
  const emit = (event: Partial<AgentEvent>) => emitter.emit('agentEvent', {
    runId: 'run-1', seq: 1, state: 'delta', ...event,
  })
  return { adapter, emit, stop }
}

describe('public Agent reply collector', () => {
  it('forwards only visible Agent text, excluding thinking and other runs', async () => {
    const { adapter, emit } = fakeAdapter()
    const result = await collectPublicAgentReply({ adapter, send: async () => {
      emit({ text: 'private thought', thinking: true })
      emit({ text: 'Hello ' })
      emit({ runId: 'old-run', text: 'wrong' })
      emit({ text: 'visitor' })
      emit({ state: 'final' })
    } })
    expect(result).toBe('Hello visitor')
  })

  it('rejects a turn with no visible reply or an external owner handoff', async () => {
    const first = fakeAdapter()
    await expect(collectPublicAgentReply({ adapter: first.adapter, send: async () => {
      first.emit({ text: 'secret', thinking: true })
      first.emit({ state: 'final' })
    } })).rejects.toMatchObject({ code: 'empty_reply' })
    const second = fakeAdapter()
    await expect(collectPublicAgentReply({ adapter: second.adapter, send: async () => ({
      deliveryMode: 'external_owner_queue', queuedSubmissionId: 'id-1',
    }) })).rejects.toMatchObject({ code: 'external_owner' })
  })

  it('does not accept a final event before the send result confirms direct delivery', async () => {
    const { adapter, emit } = fakeAdapter()
    await expect(collectPublicAgentReply({ adapter, send: async () => {
      emit({ text: 'premature' })
      emit({ state: 'final' })
      return { deliveryMode: 'external_owner_queue', queuedSubmissionId: 'queued-1' }
    } })).rejects.toMatchObject({ code: 'external_owner' })
  })

  it('rejects oversized output before submitting it', async () => {
    const { adapter, emit } = fakeAdapter()
    await expect(collectPublicAgentReply({ adapter, send: async () => {
      emit({ text: 'a'.repeat(20_001) })
    } })).rejects.toMatchObject({ code: 'output_too_long' })
  })

  it('reports an explicit provider quota error without exposing its raw text', async () => {
    const { adapter, emit } = fakeAdapter()
    await expect(collectPublicAgentReply({ adapter, send: async () => {
      emit({ state: 'error', message: 'Insufficient quota for this account' })
    } })).rejects.toMatchObject({ code: 'provider_limit', message: 'provider_limit' })
    const second = fakeAdapter()
    await expect(collectPublicAgentReply({ adapter: second.adapter, send: async () => {
      throw new Error('billing hard limit reached')
    } })).rejects.toMatchObject({ code: 'provider_limit', message: 'provider_limit' })
  })

  it('ignores Adapter-owned tool events but rejects interactive approval', async () => {
    const first = fakeAdapter()
    const reply = await collectPublicAgentReply({ adapter: first.adapter, send: async () => {
      first.emit({ state: 'tool-call', name: 'read' })
      first.emit({ text: 'Visible reply after the Adapter handled the tool' })
      first.emit({ state: 'final' })
    } })
    expect(reply).toBe('Visible reply after the Adapter handled the tool')
    expect(first.stop).not.toHaveBeenCalled()

    const second = fakeAdapter()
    await expect(collectPublicAgentReply({ adapter: second.adapter, send: async () => {
      second.emit({ state: 'approval-pending', name: 'bash' })
    } })).rejects.toMatchObject({ code: 'unauthorized_tool_attempt' })
    expect(second.stop).toHaveBeenCalledOnce()
  })

  it('stops an active turn when its host lease is cancelled', async () => {
    const { adapter, stop } = fakeAdapter()
    const controller = new AbortController()
    const result = collectPublicAgentReply({ adapter, signal: controller.signal,
      send: async () => undefined })
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'aborted' })
    expect(stop).toHaveBeenCalledOnce()
  })
})
