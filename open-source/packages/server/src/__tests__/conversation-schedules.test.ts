// @covers open-source/packages/server/src/services/conversation-schedules.ts
// @covers open-source/packages/server/src/services/schedule-time.ts
// @covers open-source/packages/server/src/jobs/conversation-schedules.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { db, send } = vi.hoisted(() => ({ db: {
  nianSession: { findFirst: vi.fn() }, roomMembership: { findFirst: vi.fn() }, machine: { findFirst: vi.fn() },
  conversationSchedule: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}, send: vi.fn() }))
const { primary } = vi.hoisted(() => ({ primary: vi.fn() }))
vi.mock('../services/personal-workspace/primary-machine.js', () => ({ primaryMachine: primary }))
vi.mock('../lib/prisma.js', () => ({ prisma: db }))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: send }))
import { parseScheduleTime, nextScheduleTime } from '../services/schedule-time.js'
import { createMachineSchedule, executeSchedule, executeStewardSettingsSchedule, listSchedules, scheduleView, resolveDeliveryTarget } from '../services/conversation-schedules.js'
import { runConversationSchedules } from '../jobs/conversation-schedules.js'
const now = Date.now() + 60000
const at = new Date(now)
function task() { return {
  id: 'task1', userId: 'owner', sessionId: 's1', bindingId: 'b1', roomId: 'r1', agentIdentityId: 'a1',
  prompt: 'report yesterday', timeDescription: '每隔24小时', timezone: 'Asia/Shanghai',
  rule: { kind: 'interval', anchor: now, everyMs: 86400000 }, state: 'active', version: 1,
  nextDueAt: at, createdAt: at, updatedAt: at, deliveryAt: null, lastState: null,
  session: { id: 's1', userId: 'owner', machineId: 'm1', agentIdentityId: 'a1', machine: { userId: 'owner', online: true, paired: true }, roomBinding: { id: 'b1', roomId: 'r1', status: 'active', room: { status: 'active' } } },
} }
function stewardSession(id = 'steward-1') {
  return { id, userId: 'owner', machineId: 'm1', agentIdentityId: null, sessionScope: 'steward', roomBinding: null, machine: { userId: 'owner', online: true, paired: true } }
}
function stewardTask() { return {
  id: 'task2', userId: 'owner', sessionId: 'steward-1', bindingId: null, roomId: null, agentIdentityId: null,
  scope: 'steward', machineId: 'm1',
  prompt: 'drink water', timeDescription: '每天09:00', timezone: 'Asia/Shanghai',
  rule: { kind: 'calendar', hour: 9, minute: 0 }, state: 'active', version: 1,
  nextDueAt: at, createdAt: at, updatedAt: at, deliveryAt: null, lastState: null,
} }
beforeEach(() => {
  vi.resetAllMocks()
  db.nianSession.findFirst.mockResolvedValue(task().session)
  db.conversationSchedule.count.mockResolvedValue(0)
  db.conversationSchedule.updateMany.mockResolvedValue({ count: 1 })
  send.mockResolvedValue({ ok: true })
})
describe('schedule times', () => {
  it('distinguishes daily calendar time from elapsed intervals', () => {
    const base = Date.parse('2026-09-14T00:00:00Z')
    const rule = parseScheduleTime('每天早上9点', 'Asia/Shanghai', base)
    expect(nextScheduleTime(rule, 'Asia/Shanghai', base)).toBe(Date.parse('2026-09-14T01:00:00Z'))
    const interval = parseScheduleTime('每隔24小时', 'Asia/Shanghai', base)
    expect(nextScheduleTime(interval, 'Asia/Shanghai', base + 86400000 + 1000)).toBe(base + 2 * 86400000)
  })
  it('resolves relative times and rejects past, ambiguous and invalid timezones', () => {
    const base = Date.parse('2026-09-14T00:00:00Z')
    expect(parseScheduleTime('30分钟后', 'Asia/Shanghai', base)).toEqual({ kind: 'once', at: base + 1800000 })
    expect(() => parseScheduleTime('2027-02-30T09:00:00Z', 'UTC', base)).toThrow('schedule_date_invalid')
    expect(() => parseScheduleTime('晚一点', 'Asia/Shanghai', base)).toThrow()
    expect(() => parseScheduleTime('2025-01-01T00:00:00Z', 'UTC', base)).toThrow()
    expect(() => parseScheduleTime('每天09:00', 'not-a-zone', base)).toThrow()
  })
  it('skips missing dates and DST gaps; repeats an overlap only once', () => {
    const base = Date.parse('2026-04-01T00:00:00Z')
    const monthly = parseScheduleTime('每月31日09:00', 'UTC', base)
    expect(nextScheduleTime(monthly, 'UTC', base)).toBe(Date.parse('2026-05-31T09:00:00Z'))
    expect(nextScheduleTime({ kind: 'calendar', hour: 2, minute: 30 }, 'America/New_York', Date.parse('2026-03-08T05:00:00Z'))).toBe(Date.parse('2026-03-09T06:30:00Z'))
    expect(nextScheduleTime({ kind: 'calendar', hour: 1, minute: 30 }, 'America/New_York', Date.parse('2026-11-01T05:30:00Z'))).toBe(Date.parse('2026-11-02T06:30:00Z'))
  })
})
describe('server ownership and lifecycle', () => {
  it('rejects new personal schedules while preserving the managed Room create path', async () => {
    db.nianSession.findFirst.mockResolvedValueOnce({ ...task().session, agentIdentityId: null, roomBinding: null })
    await expect(executeSchedule('owner', 's1', 'create', { operationId: 'private', prompt: 'report', timeDescription: '每天09:00', timezone: 'UTC' }))
      .rejects.toThrow('schedule_managed_room_required')
    expect(db.conversationSchedule.findUnique).not.toHaveBeenCalled()
    expect(db.conversationSchedule.create).not.toHaveBeenCalled()

    db.conversationSchedule.create.mockImplementation(async ({ data }) => ({ ...task(), ...data }))
    await expect(executeSchedule('owner', 's1', 'create', { operationId: 'managed', prompt: 'report', timeDescription: '每天09:00', timezone: 'UTC' }))
      .resolves.toMatchObject({ bindingId: 'b1', roomId: 'r1' })
  })
  it('stores relative one-off descriptions as their resolved instant', async () => {
    db.conversationSchedule.create.mockImplementation(async ({ data }) => ({ ...task(), ...data }))
    const result = await executeSchedule('owner', 's1', 'create', { operationId: 'absolute-once', prompt: 'drink water', timeDescription: '10分钟后', timezone: 'Asia/Shanghai' })
    const saved = db.conversationSchedule.create.mock.calls[0]![0].data
    expect(saved.rule.kind).toBe('once')
    expect(saved.timeDescription).toBe(new Date(saved.rule.at).toISOString())
    expect(result).toMatchObject({ timeDescription: saved.timeDescription })
  })
  it('normalizes legacy one-off descriptions without moving their instant', () => {
    const old = { ...task(), timeDescription: '10分钟后', rule: { kind: 'once', at: now } }
    expect(scheduleView(old as never)).toMatchObject({ timeDescription: new Date(now).toISOString(), rule: old.rule })
  })

  it('shows an empty owner-scoped list before a new draft has synced', async () => {
    db.nianSession.findFirst.mockResolvedValue(null)
    db.conversationSchedule.findMany.mockResolvedValue([])
    await expect(listSchedules('owner', { sessionId: 'unsynced-draft' })).resolves.toEqual([])
    expect(db.conversationSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner', sessionId: 'unsynced-draft', state: { not: 'deleted' } } }))
  })
  it('filters lists by owner and explicit scope; ignores injected query keys', async () => {
    db.roomMembership.findFirst.mockResolvedValue({ id: 'member' })
    db.conversationSchedule.findMany.mockResolvedValue([])
    await listSchedules('owner', { roomId: 'r1', userId: 'other' } as never)
    expect(db.conversationSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'owner', roomId: 'r1' }) }))
  })
  it('rejects inaccessible sessions and stale update versions', async () => {
    db.nianSession.findFirst.mockResolvedValueOnce(null)
    await expect(executeSchedule('other', 's1', 'list', {})).rejects.toThrow('schedule_session_unavailable')
    db.conversationSchedule.findFirst.mockResolvedValue(task())
    await expect(executeSchedule('owner', 's1', 'delete', { id: 'task1', version: 0 })).rejects.toThrow('schedule_version_conflict')
    expect(db.conversationSchedule.updateMany).not.toHaveBeenCalled()
  })
  it('returns the same persisted task for repeated creates', async () => {
    db.conversationSchedule.findUnique.mockResolvedValue(task())
    expect(await executeSchedule('owner', 's1', 'create', { operationId: 'same' })).toMatchObject({ id: 'task1' })
    expect(db.conversationSchedule.create).not.toHaveBeenCalled()
  })
  it('uses optimistic version checks and cancels only future delivery on deletion', async () => {
    db.conversationSchedule.findFirst.mockResolvedValue(task())
    db.conversationSchedule.findUniqueOrThrow.mockResolvedValue({ ...task(), state: 'deleted', nextDueAt: null })
    await executeSchedule('owner', 's1', 'delete', { id: 'task1', version: 1 })
    expect(db.conversationSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task1', version: 1, state: 'active' }, data: expect.objectContaining({ state: 'deleted', nextDueAt: null, deliveryId: null }) }))
  })
})
describe('steward schedules (machine-bound, no managed Room)', () => {
  it('creates without a Room binding, keyed to the machine instead of the Session', async () => {
    db.nianSession.findFirst.mockResolvedValue(stewardSession())
    db.conversationSchedule.create.mockImplementation(async ({ data }) => ({ ...stewardTask(), ...data }))
    const result = await executeSchedule('owner', 'steward-1', 'create', { operationId: 'water', prompt: 'drink water', timeDescription: '每天09:00', timezone: 'Asia/Shanghai' })
    expect(result).toMatchObject({ scope: 'steward', machineId: 'm1', bindingId: undefined, roomId: undefined })
    const saved = db.conversationSchedule.create.mock.calls[0]![0].data
    expect(saved).toMatchObject({ scope: 'steward', machineId: 'm1', bindingId: null, roomId: null, agentIdentityId: null })
  })
  it('lists and mutates by machine, so a new Session on the same machine still sees the task', async () => {
    db.nianSession.findFirst.mockResolvedValue(stewardSession('steward-2'))
    db.conversationSchedule.findMany.mockResolvedValue([])
    await executeSchedule('owner', 'steward-2', 'list', {})
    expect(db.conversationSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ scope: 'steward', machineId: 'm1' }) }))
    db.conversationSchedule.findFirst.mockResolvedValue(stewardTask())
    db.conversationSchedule.findUniqueOrThrow.mockResolvedValue({ ...stewardTask(), state: 'paused' })
    await executeSchedule('owner', 'steward-2', 'pause', { id: 'task2', version: 1 })
    expect(db.conversationSchedule.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ scope: 'steward', machineId: 'm1' }) }))
  })
  it('delivers to whichever steward Session on the bound machine is currently active, not the stale creating one', async () => {
    db.nianSession.findFirst.mockResolvedValue(stewardSession('steward-3'))
    db.conversationSchedule.findMany.mockResolvedValue([stewardTask()])
    await runConversationSchedules(now)
    expect(send).toHaveBeenCalledWith('m1', expect.objectContaining({ method: 'schedule.deliver' }), 15000)
  })
  it('skips (without ending) a steward task when no steward Session exists yet on the machine', async () => {
    db.nianSession.findFirst.mockResolvedValue(null)
    db.conversationSchedule.findMany.mockResolvedValue([stewardTask()])
    await runConversationSchedules(now)
    expect(send).not.toHaveBeenCalled()
    expect(db.conversationSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'active', lastState: 'skipped', lastReason: 'offline' }) }))
  })
  it('manages the settings-page view by machine ownership alone, with no live Session required', async () => {
    db.machine.findFirst.mockResolvedValue({ id: 'm1', userId: 'owner' })
    db.conversationSchedule.findMany.mockResolvedValue([])
    await executeStewardSettingsSchedule('owner', 'm1', 'list', {})
    expect(db.conversationSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ scope: 'steward', machineId: 'm1' }) }))
    await expect(executeStewardSettingsSchedule('owner', 'm1', 'create' as never, {})).rejects.toThrow()
    db.machine.findFirst.mockResolvedValue(null)
    await expect(executeStewardSettingsSchedule('intruder', 'm1', 'list', {})).rejects.toThrow('schedule_session_unavailable')
    db.machine.findFirst.mockResolvedValue({ id: 'm1', userId: 'owner' })
    db.conversationSchedule.findFirst.mockResolvedValue(stewardTask())
    db.conversationSchedule.findUniqueOrThrow.mockResolvedValue({ ...stewardTask(), state: 'paused' })
    await executeStewardSettingsSchedule('owner', 'm1', 'pause', { id: 'task2', version: 1 })
    expect(db.conversationSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'paused' }) }))
  })
})
describe('server timed private delivery', () => {
  it('claims before sending only the private delivery reference', async () => {
    db.conversationSchedule.findMany.mockResolvedValue([task()])
    await runConversationSchedules(now)
    expect(db.conversationSchedule.updateMany.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!)
    expect(send).toHaveBeenCalledWith('m1', { type: 'req', method: 'schedule.deliver', params: { id: 'task1', deliveryId: `schedule:task1:1:${now}` } }, 15000)
  })
  it('does not send after another worker claims the occurrence', async () => {
    db.conversationSchedule.findMany.mockResolvedValue([task()])
    db.conversationSchedule.updateMany.mockResolvedValue({ count: 0 })
    await runConversationSchedules(now)
    expect(send).not.toHaveBeenCalled()
  })
  it('skips offline and missed occurrences without ending recurring schedules', async () => {
    const offline = task(); offline.session.machine.online = false
    db.conversationSchedule.findMany.mockResolvedValue([offline])
    await runConversationSchedules(now)
    expect(send).not.toHaveBeenCalled()
    expect(db.conversationSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'active', lastState: 'skipped', nextDueAt: new Date(now + 86400000) }) }))
    db.conversationSchedule.findMany.mockResolvedValue([task()])
    await runConversationSchedules(now + 10000)
    expect(send).not.toHaveBeenCalled()
  })
  it('terminates detached targets and does not retry an uncertain ACK', async () => {
    const detached = task(); detached.session.roomBinding.status = 'detached'
    db.conversationSchedule.findMany.mockResolvedValue([detached])
    await runConversationSchedules(now)
    expect(send).not.toHaveBeenCalled()
    expect(db.conversationSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'ended', nextDueAt: null }) }))
    db.conversationSchedule.findMany.mockResolvedValue([task()]); send.mockRejectedValue(new Error('timeout'))
    await runConversationSchedules(now)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

// @covers open-source/packages/server/src/worker.ts
it('starts the cross-instance private transport before any worker jobs', async () => {
  const calls: string[] = []
  vi.doMock('../env.js', () => ({}))
  vi.doMock('../lib/redis.js', () => ({ redis: { disconnect: vi.fn() } }))
  vi.doMock('../relay/pubsub.js', () => ({ pubsub: { init: async () => { calls.push('pubsub') }, destroy: vi.fn() } }))
  vi.doMock('../relay/server-requests.js', () => ({ initServerRequestRouting: async () => { calls.push('reply-routing') }, destroyServerRequestRouting: vi.fn() }))
  vi.doMock('../worker-runtime.js', () => ({ startWorkerRuntime: async () => { calls.push('jobs'); return { jobNames: ['conversation-schedules'], stop: vi.fn() } } }))
  vi.doMock('../worker-health.js', () => ({ startWorkerHealthServer: async () => ({ port: 3001, close: vi.fn() }) }))
  const once = vi.spyOn(process, 'once').mockReturnValue(process)
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    await import('../worker.js')
    expect(calls).toEqual(['pubsub', 'reply-routing', 'jobs'])
  } finally {
    once.mockRestore(); info.mockRestore()
  }
})

describe('builtin personal schedule target', () => {
  it('prefers the builtin continuous session on the exact owner machine', async () => {
    db.nianSession.findFirst.mockResolvedValueOnce(stewardSession('builtin'))
    expect((await resolveDeliveryTarget(stewardTask() as never))?.id).toBe('builtin')
    expect(db.nianSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner', machineId: 'm1', sessionScope: 'steward', deletedAt: null, agentType: 'shennian' },
    }))
    expect(db.nianSession.findFirst).toHaveBeenCalledTimes(1)
  })
  it('preserves legacy targets when the machine has no builtin session', async () => {
    db.nianSession.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(stewardSession('legacy'))
    expect((await resolveDeliveryTarget(stewardTask() as never))?.id).toBe('legacy')
    expect(db.nianSession.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { userId: 'owner', machineId: 'm1', sessionScope: 'steward', deletedAt: null },
    }))
  })
})

describe('owner UI scheduled task creation', () => {
  const args = { operationId: 'create-ui', prompt: 'Update diary', timeDescription: '每天23:00', timezone: 'Asia/Shanghai', sessionId: 'forged' }
  it('rejects another owner, disabled machines and missing builtin sessions', async () => {
    db.machine.findFirst.mockResolvedValue(null)
    await expect(createMachineSchedule('intruder', 'm1', args)).rejects.toThrow('schedule_session_unavailable')
    expect(db.machine.findFirst).toHaveBeenCalledWith({ where: { id: 'm1', userId: 'intruder' } })
    db.machine.findFirst.mockResolvedValue({ paired: true, remoteAccessDisabledAt: new Date() })
    await expect(createMachineSchedule('owner', 'm1', args)).rejects.toThrow('schedule_session_unavailable')
    db.machine.findFirst.mockResolvedValue({ paired: true })
    db.nianSession.findFirst.mockResolvedValue(null)
    await expect(createMachineSchedule('owner', 'm1', args)).rejects.toThrow('schedule_builtin_session_required')
    expect(db.conversationSchedule.create).not.toHaveBeenCalled()
  })
  it('uses only the selected machine builtin session and persists a machine-bound task', async () => {
    db.machine.findFirst.mockResolvedValue({ paired: true })
    db.nianSession.findFirst.mockResolvedValue(stewardSession('builtin'))
    db.conversationSchedule.create.mockResolvedValue(stewardTask())
    await createMachineSchedule('owner', 'm1', args)
    expect(db.nianSession.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: 'owner', machineId: 'm1', sessionScope: 'steward', agentType: 'shennian', deletedAt: null } }))
    expect(db.nianSession.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: 'builtin', userId: 'owner', machineId: 'm1', deletedAt: null } }))
    expect(db.conversationSchedule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scope: 'steward', machineId: 'm1', sessionId: 'builtin', prompt: 'Update diary', bindingId: null }) }))
  })
})

import { ensureDefaultDiarySchedule } from '../services/default-diary-schedule.js'
describe('default diary schedule', () => {
  it.each(['active', 'paused', 'deleted'])('preserves an existing %s default without reseeding or moving it', async state => {
    db.conversationSchedule.findUnique.mockResolvedValue({ ...stewardTask(), state })
    expect(await ensureDefaultDiarySchedule('owner', 'Asia/Shanghai')).toMatchObject({ state, machineId: 'm1' })
    expect(primary).not.toHaveBeenCalled()
    expect(db.conversationSchedule.create).not.toHaveBeenCalled()
  })
  it('creates a real 23:00 task on the trusted primary machine with a stable operation key', async () => {
    primary.mockResolvedValue({ machine: { id: 'm1' } })
    db.machine.findFirst.mockResolvedValue({ paired: true })
    db.nianSession.findFirst.mockResolvedValue(stewardSession('builtin'))
    db.conversationSchedule.create.mockResolvedValue(stewardTask())
    await ensureDefaultDiarySchedule('owner', 'Asia/Shanghai')
    const lookup = db.conversationSchedule.findUnique.mock.calls[0]![0]
    expect(db.conversationSchedule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      machineId: 'm1', scope: 'steward', operationKey: lookup.where.operationKey,
      timezone: 'Asia/Shanghai', rule: { kind: 'calendar', hour: 23, minute: 0, executionMode: 'worker' },
      prompt: expect.stringContaining('YYYY/YYYY-MM-DD.md'),
    }) }))
  })
  it('does not claim a default was created without a primary computer', async () => {
    primary.mockResolvedValue({ machine: null })
    await expect(ensureDefaultDiarySchedule('owner', 'Asia/Shanghai')).rejects.toThrow('personal_primary_not_configured')
    expect(db.conversationSchedule.create).not.toHaveBeenCalled()
  })
})


describe('explicit schedule execution mode', () => {
  it('persists Worker routing and retains it when only time changes', async () => {
    db.nianSession.findFirst.mockResolvedValue(stewardSession())
    db.conversationSchedule.create.mockImplementation(async ({ data }) => ({ ...stewardTask(), ...data }))
    const created = await executeSchedule('owner', 'steward-1', 'create', { operationId: 'worker-diary', prompt: 'write diary', timeDescription: '每天23:00', timezone: 'Asia/Shanghai', executionMode: 'worker' })
    expect(created.executionMode).toBe('worker')
    const existing = { ...stewardTask(), rule: { kind: 'calendar', hour: 23, minute: 0, executionMode: 'worker' } }
    db.conversationSchedule.findFirst.mockResolvedValue(existing)
    db.conversationSchedule.findUniqueOrThrow.mockResolvedValue(existing)
    await executeSchedule('owner', 'steward-1', 'update', { id: existing.id, version: 1, timeDescription: '每天22:00' })
    expect(db.conversationSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rule: { kind: 'calendar', hour: 22, minute: 0, executionMode: 'worker' } }) }))
  })
  it('rejects Worker routing for Room tasks and rejects unknown modes', async () => {
    const args = { operationId: 'mode', prompt: 'report', timeDescription: '每天23:00', timezone: 'UTC' }
    await expect(executeSchedule('owner', 's1', 'create', { ...args, executionMode: 'worker' })).rejects.toThrow('schedule_execution_invalid')
    db.nianSession.findFirst.mockResolvedValue(stewardSession())
    await expect(executeSchedule('owner', 'steward-1', 'create', { ...args, executionMode: 'automatic' })).rejects.toThrow('schedule_execution_invalid')
    expect(db.conversationSchedule.create).not.toHaveBeenCalled()
    expect(scheduleView(stewardTask() as never).executionMode).toBe('main')
  })
})
