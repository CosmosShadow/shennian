// @covers src/steward/project-event.ts
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ records: [] as Array<Record<string, unknown>> }))
vi.mock('../config/index.js', () => ({ loadConfig: () => ({ serverUrl: 'https://shennian.net', machineToken: 'synthetic' }) }))
vi.mock('../session/store.js', () => ({ listSessionRecords: () => m.records }))
vi.mock('../personal-sync/epoch.js', () => ({ getPersonalSyncIdentity: () => ({ dataEpoch: 2 }) }))
import { deliverProjectTaskEvent } from '../steward/project-event.js'
import { isTrustedManagerEvent } from '../session/manager-event-authority.js'
beforeEach(() => { m.records = [{ sessionId: 'steward', sessionScope: 'steward', agentType: 'shennian', workDir: '/workspace' }] })
afterEach(() => vi.unstubAllGlobals())
it('refetches the canonical Server event and transfers it into the trusted durable personal queue', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionId: 'steward', taskId: 'task', eventId: 'event', summary: 'Result evidence', state: 'final' })))
  vi.stubGlobal('fetch', fetcher)
  const enqueue = vi.fn(async (_req: unknown) => true)
  await deliverProjectTaskEvent({ id: 'req', params: { watchId: 'watch', eventId: 'event' } } as never, { handleEnqueue: enqueue } as never)
  const req = enqueue.mock.calls[0]![0]
  expect(isTrustedManagerEvent(req as never)).toBe(true)
  expect(req).toMatchObject({ id: 'req', method: 'chat.enqueue', params: { sessionId: 'steward', agentType: 'shennian', sessionMode: 'standard', clientMessageId: 'event', managerEventId: 'event' } })
  expect(fetcher).toHaveBeenCalledWith('https://shennian.net/api/project-cli/events/delivery', expect.objectContaining({ method: 'POST' }))
})
it('does not accept forged event payloads or retarget a missing steward', async () => {
  const enqueue = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ eventId: 'other', summary: 'x' }))))
  await expect(deliverProjectTaskEvent({ params: { eventId: 'event' } } as never, { handleEnqueue: enqueue } as never)).rejects.toThrow('project_event_invalid')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ eventId: 'event', sessionId: 'someone-else', taskId: 'task', summary: 'x' }))))
  await expect(deliverProjectTaskEvent({ params: { eventId: 'event' } } as never, { handleEnqueue: enqueue } as never)).rejects.toThrow('project_event_target_unavailable')
  expect(enqueue).not.toHaveBeenCalled()
})
