// @covers src/agents/shennian.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
const fake = vi.hoisted(() => ({ open: vi.fn(), prompt: vi.fn(), refresh: vi.fn(), abort: vi.fn(), dispose: vi.fn(), persist: vi.fn(), listener: undefined as undefined | ((event: unknown) => void) }))
vi.mock('../personal-agent/sdk-session.js', () => ({ openPersonalAgent: fake.open }))
vi.mock('../personal-agent/model-settings.js', () => ({ personalModelSummary: () => ({ model: 'unit-model' }) }))
import { ShennianAdapter } from '../agents/shennian.js'
let adapter: ShennianAdapter
beforeEach(() => {
  vi.resetAllMocks()
  fake.open.mockResolvedValue({ session: { sessionId: 'exact-pi-id', prompt: fake.prompt, abort: fake.abort, dispose: fake.dispose, subscribe: (fn: (event: unknown) => void) => { fake.listener = fn; return () => { fake.listener = undefined } } }, refreshModel: fake.refresh, persist: fake.persist })
  adapter = new ShennianAdapter()
})
afterEach(async () => { await adapter.stop() })
describe('bundled personal SDK adapter', () => {
  it('uses an ephemeral no-tool validation session without registering it as a real conversation', async () => {
    const opened = await fake.open()
    const cleanup = vi.fn()
    fake.open.mockResolvedValue({ ...opened, cleanup })
    const native = vi.fn()
    adapter.on('nativeSession', native)
    await adapter.start('agent-validation-unit', '/unit/work', null, { persistNativeSession: false })
    await expect(adapter.send('hello', 'unavailable-model')).rejects.toThrow('builtin_agent_model_unavailable')
    expect(fake.prompt).not.toHaveBeenCalled()
    await adapter.send('hello', 'unit-model')
    expect(fake.open.mock.calls.at(-1)?.[5]).toBe('validation')
    expect(native).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(fake.persist).toHaveBeenCalled())
    await adapter.stop()
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('supports only explicitly confirmed native-full managed sessions and isolates them from personal context', async () => {
    const policy = { executionMode: 'native-full', requestedPolicy: { executionMode: 'native-full' }, adapterPolicy: { workDir: '/unit/agent' } } as any
    adapter.configure({ managedAgentPolicy: policy, env: { SHENNIAN_MANAGED_ROOM_CONTEXT: 'unit-context', SHENNIAN_MACHINE_TOKEN: 'must-not-inherit' } })
    await adapter.start('unit-agent', '/ignored')
    await expect(adapter.send('task', 'different-model')).rejects.toThrow('builtin_agent_model_unavailable')
    expect(fake.open).not.toHaveBeenCalled()
    await adapter.send('task', 'unit-model', undefined, undefined, 'Agent instructions', { source: 'room_activation' })
    const call = fake.open.mock.calls[0]!
    expect(call[1]).toBe('/unit/agent'); expect(call[4]).toContain('Agent instructions'); expect(call[5]).toBe('managed-native-full')
    const env = call[3]()
    expect(env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBe('unit-context'); expect(env.SHENNIAN_MACHINE_TOKEN).toBeUndefined()
    await vi.waitFor(() => expect(fake.persist).toHaveBeenCalled())
    expect(() => adapter.configure({ managedAgentPolicy: null })).toThrow('policy_change_requires_stop')
  })
  it('fails closed for restricted/public execution rather than exposing host tools to visitors', async () => {
    expect(() => adapter.configure({ managedAgentPolicy: { executionMode: 'restricted', requestedPolicy: { executionMode: 'restricted' } } as any })).toThrow('managed_runtime_unsupported')
    await adapter.start('unit-public', '/unit/work')
    await expect(adapter.send('visitor', undefined, undefined, undefined, null, { source: 'published_agent' })).rejects.toThrow('public_runtime_unsupported')
    expect(fake.open).not.toHaveBeenCalled()
  })

  it('registers exact ownership before dispatch, streams tools, and finishes only after the SDK settles', async () => {
    let finish!: () => void
    fake.prompt.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const events: AgentEvent[] = []
    adapter.on('nativeSession', (type, id) => { expect(type).toBe('shennian'); expect(id).toBe('exact-pi-id'); expect(fake.prompt).not.toHaveBeenCalled() })
    adapter.on('agentEvent', e => events.push(e))
    await adapter.start('sess_test', '/tmp/work'); await adapter.send('hello')
    fake.listener?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'answer' } })
    fake.listener?.({ type: 'tool_execution_start', toolName: 'read', toolCallId: 't', args: { path: 'a' } })
    fake.listener?.({ type: 'agent_end' })
    expect(events.map(e => e.state)).toEqual(['start', 'delta', 'tool-call'])
    expect((await adapter.getStatus()).active).toBe(true)
    finish(); await vi.waitFor(() => expect(events.at(-1)?.state).toBe('final'))
    expect(events.filter(e => ['final', 'aborted', 'error'].includes(e.state))).toHaveLength(1)
    expect(fake.persist).toHaveBeenCalled()
  })
  it('does not prompt when durable native ownership fails', async () => {
    adapter.on('nativeSession', () => { throw new Error('ownership-write-failed') })
    await adapter.start('sess_test', '/tmp/work')
    await expect(adapter.send('hello')).rejects.toThrow('ownership-write-failed')
    expect(fake.prompt).not.toHaveBeenCalled(); expect(fake.dispose).toHaveBeenCalled()
  })
  it('reuses context and refreshes model settings for the next turn', async () => {
    await adapter.start('sess_test', '/tmp/work', 'restored-id')
    await adapter.send('one'); await vi.waitFor(() => expect(fake.persist).toHaveBeenCalledTimes(1))
    await adapter.send('two'); await vi.waitFor(() => expect(fake.persist).toHaveBeenCalledTimes(2))
    expect(fake.open).toHaveBeenCalledTimes(1); expect(fake.open.mock.calls[0]?.[2]).toBe('restored-id'); expect(fake.refresh).toHaveBeenCalledTimes(2)
  })
  it('fails closed for managed or external authority and never reports provider errors verbatim', async () => {
    expect(() => adapter.configure({ managedRoomContextToken: 'not-allowed' })).toThrow()
    fake.prompt.mockRejectedValue(new Error('provider-secret-key'))
    const events: AgentEvent[] = []; adapter.on('agentEvent', e => events.push(e))
    await adapter.start('sess_test', '/tmp/work'); await adapter.send('hello')
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe('error'))
    expect(JSON.stringify(events)).not.toContain('provider-secret-key')
  })
  it('cancels initialization before any provider or tool dispatch', async () => {
    let release!: () => void
    const opened = await fake.open()
    fake.open.mockReturnValue(new Promise(resolve => { release = () => resolve(opened) }))
    await adapter.start('sess_test', '/tmp/work')
    const send = adapter.send('hello')
    await adapter.stop(); release()
    await expect(send).rejects.toThrow('personal_agent_cancelled')
    expect(fake.prompt).not.toHaveBeenCalled(); expect(fake.dispose).toHaveBeenCalled()
  })
  it('aborts active work and emits exactly one terminal event', async () => {
    let finish!: () => void
    fake.prompt.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    fake.abort.mockImplementation(async () => { finish() })
    const events: AgentEvent[] = []; adapter.on('agentEvent', e => events.push(e))
    await adapter.start('sess_test', '/tmp/work'); await adapter.send('hello'); await adapter.stop()
    expect(events.filter(e => ['final', 'error', 'aborted'].includes(e.state)).map(e => e.state)).toEqual(['aborted'])
  })
})

it('classifies quota failure from SDK events without exposing raw provider details', async () => {
  const events: AgentEvent[] = []
  adapter.on('agentEvent', e => events.push(e))
  fake.prompt.mockImplementation(async () => {
    fake.listener?.({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '429 nian_quota_exceeded secret-provider-details' } })
  })
  await adapter.start('sess_quota', '/unit/work'); await adapter.send('write diary')
  await vi.waitFor(() => expect(events.at(-1)?.state).toBe('error'))
  expect(events.at(-1)?.message).toContain('模型额度不足')
  expect(JSON.stringify(events)).not.toContain('secret-provider-details')
})

it('explains SDK request timeouts without claiming prior tools were rolled back or retrying them', async () => {
  const events: AgentEvent[] = []
  adapter.on('agentEvent', e => events.push(e))
  fake.prompt.mockImplementation(async () => {
    fake.listener?.({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Request timed out. private-provider-detail' } })
  })
  await adapter.start('sess_timeout', '/unit/work'); await adapter.send('create reminder')
  await vi.waitFor(() => expect(events.at(-1)?.state).toBe('error'))
  expect(events.at(-1)?.message).toContain('模型请求超时')
  expect(events.at(-1)?.message).toContain('不会自动撤销')
  expect(JSON.stringify(events)).not.toContain('private-provider-detail')
  expect(fake.prompt).toHaveBeenCalledTimes(1)
})
