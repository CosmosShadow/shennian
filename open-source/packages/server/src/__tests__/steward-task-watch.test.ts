// @covers src/services/steward-task-watch.ts
// @covers src/jobs/steward-task-events.ts
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ activity: vi.fn(), owned: vi.fn(), session: vi.fn(), upsert: vi.fn(), first: vi.fn(), find: vi.fn(), update: vi.fn(), notification: vi.fn(), send: vi.fn() }))
vi.mock('../services/session-activity.js', () => ({ getSessionActivity: m.activity }))
vi.mock('../lib/prisma.js', () => ({ prisma: { nianSession: { findFirst: m.session }, personalModuleRecord: { upsert: m.upsert, findFirst: m.first, findMany: m.find, updateMany: m.update }, sessionTerminalNotification: { findFirst: m.notification } } }))
vi.mock('../services/local-apps/gateway.js', () => ({ ownedMachine: m.owned }))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: m.send }))
import { registerStewardTaskWatch, readStewardTaskEvent, drainStewardTaskEvents } from '../services/steward-task-watch.js'
const base = { taskId: 'task', stewardSessionId: 'steward', machineId: 'owner', cursorAt: '2026-10-23T00:00:00Z', cursorId: '' }
beforeEach(() => { vi.clearAllMocks(); m.activity.mockResolvedValue(null); m.owned.mockResolvedValue({ online: true }); m.session.mockImplementation(async ({ where }) => ({ id: where.id, machineId: where.id === 'steward' ? 'owner' : 'remote', createdAt: new Date('2026-10-23') })); m.upsert.mockResolvedValue({ id: 'watch' }); m.update.mockResolvedValue({ count: 1 }); m.find.mockResolvedValue([{ id: 'watch', userId: 'u', revision: 1, payload: base }]); m.notification.mockResolvedValue({ id: 'terminal', createdAt: new Date('2026-10-23T01:00:00Z'), notificationTitle: 'Task', notificationBody: 'Verified output', terminalState: 'final' }); m.send.mockResolvedValue({ ok: true, payload: { projectTaskEvents: true } }) })
it('registers idempotently only for an owned ordinary task and exact steward', async () => {
  expect(await registerStewardTaskWatch('u', 'owner', 'task', 'steward')).toMatchObject({ enabled: true, watchId: 'watch' })
  expect(m.owned).toHaveBeenCalledWith('u', 'remote')
  m.send.mockResolvedValueOnce({ ok: true, payload: {} })
  await expect(registerStewardTaskWatch('u', 'owner', 'task', 'steward')).rejects.toThrow('task_watch_client_upgrade_required')
  m.session.mockResolvedValue(null)
  await expect(registerStewardTaskWatch('u', 'owner', 'task', 'other')).rejects.toThrow('task_watch_forbidden')
})
it('freezes canonical terminal evidence, claims by revision and advances only after durable ACK', async () => {
  await drainStewardTaskEvents()
  expect(m.send).toHaveBeenCalledWith('owner', expect.objectContaining({ method: 'project.taskEvent', params: { watchId: 'watch', eventId: 'project-result:watch:terminal' } }), 20000)
  expect(m.update.mock.calls[0]?.[0]).toMatchObject({ where: { id: 'watch', revision: 1 }, data: { payload: { pending: { summary: 'Verified output' } } } })
  expect(m.update.mock.calls[1]?.[0]).toMatchObject({ where: { revision: 2 }, data: { payload: { cursorId: 'terminal' } } })
})
it('retains frozen pending events after ambiguous ACK, and does not retarget offline machines', async () => {
  m.send.mockRejectedValue(new Error('ACK lost')); await drainStewardTaskEvents()
  expect(m.update.mock.calls[1]?.[0]).toMatchObject({ data: { payload: { pending: { eventId: 'project-result:watch:terminal' }, cursorId: '' } } })
  m.update.mockClear(); m.send.mockClear(); m.owned.mockResolvedValue({ online: false }); await drainStewardTaskEvents()
  expect(m.send).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled()
})
it('ignores competing claims and validates callback ownership against current sessions', async () => {
  m.update.mockResolvedValue({ count: 0 }); await drainStewardTaskEvents(); expect(m.send).not.toHaveBeenCalled()
  m.first.mockResolvedValue({ payload: { ...base, pending: { eventId: 'event', summary: 'safe', state: 'final' } } })
  await expect(readStewardTaskEvent('u', 'different', { watchId: 'watch', eventId: 'event' })).rejects.toThrow('task_watch_forbidden')
  expect(await readStewardTaskEvent('u', 'owner', { watchId: 'watch', eventId: 'event' })).toMatchObject({ sessionId: 'steward', taskId: 'task', eventId: 'event' })
  m.session.mockResolvedValue(null)
  await expect(readStewardTaskEvent('u', 'owner', { watchId: 'watch', eventId: 'event' })).rejects.toThrow('task_watch_forbidden')
})

it('reports waiting-for-user states once per run and clears a retried pending envelope after ACK', async () => {
  m.notification.mockResolvedValue(null)
  m.activity.mockResolvedValue({ runId: 'run', runPhase: 'waiting_approval' })
  await drainStewardTaskEvents()
  expect(m.send).toHaveBeenCalledWith('owner', expect.objectContaining({ params: { watchId: 'watch', eventId: 'project-progress:watch:run:waiting_approval' } }), 20000)
  const payload = m.update.mock.calls[1]?.[0].data.payload
  expect(payload).toMatchObject({ lastProgressKey: 'run:waiting_approval', cursorId: '' })
  expect(payload).not.toHaveProperty('pending')
  m.find.mockResolvedValue([{ id: 'watch', userId: 'u', revision: 2, payload: { ...base, pending: { eventId: 'old', notificationId: 'n', at: '2026-10-23T03:00:00Z', title: '', summary: '', state: 'final' } } }])
  m.update.mockClear(); await drainStewardTaskEvents()
  expect(m.update.mock.calls[1]?.[0].data.payload).not.toHaveProperty('pending')
})
