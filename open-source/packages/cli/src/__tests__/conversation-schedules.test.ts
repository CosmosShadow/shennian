// @covers open-source/packages/cli/src/schedules/personal-context.ts
// @covers open-source/packages/cli/src/schedules/server-client.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../session/store.js', () => ({ listSessionRecords: () => [{ sessionId: 'session-a', cwd: '/project', agentType: 'codex', sessionScope: 'steward' }] }))
const worker = vi.hoisted(() => vi.fn())
vi.mock('../commands/worker.js', () => ({ executeWorkerCommand: worker }))
vi.mock('../personal-sync/epoch.js', () => ({ getPersonalSyncIdentity: () => ({}) }))
vi.mock('../personal-sync/identity.js', () => ({ getDaemonInstallationId: () => 'installation' }))
vi.mock('../native-fusion/native-source-deletions.js', () => ({ NativeSourceDeletionStore: class { hasSession() { return false } } }))
import { issuePersonalScheduleContext, resolvePersonalScheduleContext } from '../schedules/personal-context.js'
import { executeServerSchedule, deliverServerSchedule } from '../schedules/server-client.js'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('personal schedule authorization', () => {
  it('binds opaque grants to one session and expires them', () => {
    vi.useFakeTimers()
    const token = issuePersonalScheduleContext('grant-session-a')
    expect(resolvePersonalScheduleContext(token)).toBe('grant-session-a')
    expect(() => resolvePersonalScheduleContext('grant-session-a')).toThrow()
    expect(issuePersonalScheduleContext('grant-session-b')).not.toBe(token)
    vi.advanceTimersByTime(29 * 60000)
    expect(issuePersonalScheduleContext('grant-session-a')).toBe(token)
    vi.advanceTimersByTime(2 * 60000)
    expect(resolvePersonalScheduleContext(token)).toBe('grant-session-a')
    vi.advanceTimersByTime(30 * 60000)
    expect(() => resolvePersonalScheduleContext(token)).toThrow('schedule_context_expired')
  })
  it('uses trusted session and operation instead of model supplied fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    await executeServerSchedule({ serverUrl: 'https://example.test', machineToken: 'test-token', sessionId: 'session-a', action: 'create', args: { context: 'private-grant', sessionId: 'other', action: 'delete', prompt: 'report', timezone: 'UTC' } })
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ sessionId: 'session-a', action: 'create', prompt: 'report', timezone: 'UTC' })
  })
})
describe('server private message delivery', () => {
  const request = { type: 'req', id: 'server-request', method: 'schedule.deliver', params: { id: 'task-a', deliveryId: 'delivery-a', prompt: 'untrusted text' } }
  const delivery = { sessionId: 'session-a', prompt: 'trusted work', messageId: 'delivery-a', bindingId: 'binding-a', roomId: 'room-a' }
  function input(queue = vi.fn().mockResolvedValue(true), bindingId = 'binding-a') {
    return { serverUrl: 'https://example.test', machineToken: 'test-token', req: request, queue: { enqueueScheduled: queue }, registry: { getByNianSessionId: () => ({ binding: { bindingId } }) } } as unknown as Parameters<typeof deliverServerSchedule>[0]
  }
  it('fetches the authoritative prompt and enqueues privately with the original ACK id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(delivery))))
    const enqueue = vi.fn().mockResolvedValue(true)
    await deliverServerSchedule(input(enqueue))
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'server-request', method: 'chat.enqueue', params: expect.objectContaining({ text: 'trusted work', sessionId: 'session-a', queueMessageId: 'delivery-a', scheduledTask: { id: 'task-a', bindingId: 'binding-a', roomId: 'room-a' } }) }))
  })
  it('rejects revoked delivery, mismatched identity and changed bindings before enqueue', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const enqueue = vi.fn()
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'schedule_delivery_expired' }), { status: 409 }))
    await expect(deliverServerSchedule(input(enqueue))).rejects.toThrow('schedule_delivery_expired')
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...delivery, messageId: 'other' })))
    await expect(deliverServerSchedule(input(enqueue))).rejects.toThrow('schedule_delivery_invalid')
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(delivery)))
    await expect(deliverServerSchedule(input(enqueue, 'replacement'))).rejects.toThrow('schedule_binding_mismatch')
    expect(enqueue).not.toHaveBeenCalled()
  })
})

// Direct Worker routing must never enter the main Agent queue.
it('starts a Worker from authoritative delivery with a stable key and ACKs only accepted work', async () => {
  worker.mockResolvedValue({ ok: true, workerId: 'worker-a' })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ executionMode: 'worker', sessionId: 'session-a', prompt: 'write diary', messageId: 'delivery-a' }))))
  const enqueue = vi.fn(), sendRes = vi.fn()
  const input = { serverUrl: 'https://example.test', machineToken: 'synthetic', req: { type: 'req', id: 'req-a', method: 'schedule.deliver', params: { id: 'task-a', deliveryId: 'delivery-a' } }, client: { sendRes }, queue: { enqueueScheduled: enqueue }, registry: { getByNianSessionId: () => ({}) } } as never
  await deliverServerSchedule(input)
  const first = worker.mock.calls.at(-1)
  await deliverServerSchedule(input)
  expect(worker.mock.calls.at(-1)).toEqual(first)
  expect(first).toEqual(['start', expect.objectContaining({ stewardSessionId: 'session-a', notificationMode: 'direct', scheduleId: 'task-a', message: 'write diary', requestId: expect.stringMatching(/^schedule-[a-f0-9]{64}$/) })])
  expect(sendRes).toHaveBeenCalledWith({ type: 'res', id: 'req-a', ok: true })
  expect(enqueue).not.toHaveBeenCalled()
  worker.mockResolvedValue({ ok: false, error: 'unavailable' }); sendRes.mockClear()
  await expect(deliverServerSchedule(input)).rejects.toThrow('schedule_worker_start_failed')
  expect(sendRes).not.toHaveBeenCalled()
})
