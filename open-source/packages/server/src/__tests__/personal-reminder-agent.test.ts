// @covers open-source/packages/server/src/services/personal-modules/reminder-agent.ts
// @covers open-source/packages/server/src/routes/personal-reminder-agent.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  session: vi.fn(),
  save: vi.fn(),
  state: vi.fn(),
  list: vi.fn(),
  model: vi.fn(),
}))
vi.mock('../services/conversation-schedules.js', () => ({ scheduleSession: f.session }))
vi.mock('../services/personal-modules/store.js', () => ({
  saveReminder: f.save,
  reminderState: f.state,
  records: { findMany: f.list },
}))
vi.mock('../services/personal-modules/model.js', () => ({ completeModuleJson: f.model }))
vi.mock('../middleware/auth.js', () => ({
  requireUserOrMachineAuth: async (req: {
    userId: string
    machineId?: string
    headers: Record<string, string>
  }) => {
    req.userId = 'owner'
    req.machineId = req.headers['x-test-machine']
  },
}))
import Fastify from 'fastify'
import { executeReminderAgent, previewReminder } from '../services/personal-modules/reminder-agent'
import { personalReminderAgentRoutes } from '../routes/personal-reminder-agent'
beforeEach(() => {
  vi.clearAllMocks()
  f.session.mockResolvedValue({
    sessionScope: 'steward',
    roomBinding: null,
    machine: { remoteAccessDisabledAt: null },
  })
  f.save.mockResolvedValue({ key: 'stable', revision: 1, state: 'active' })
})
describe('Agent phone calendar operations', () => {
  it('checks trusted owner/machine/session and rejects non-steward and disabled contexts before touching reminders', async () => {
    for (const session of [
      { sessionScope: 'personal', machine: {} },
      { sessionScope: 'steward', roomBinding: {}, machine: {} },
      { sessionScope: 'steward', machine: { remoteAccessDisabledAt: new Date() } },
    ]) {
      f.session.mockResolvedValueOnce(session)
      await expect(
        executeReminderAgent('owner', 'machine', {
          sessionId: 'session',
          operation: 'create',
          id: 'stable',
        }),
      ).rejects.toThrow('invalid_reminder_context')
    }
    expect(f.session).toHaveBeenCalledWith('owner', 'session', 'machine')
    expect(f.save).not.toHaveBeenCalled()
    expect(f.list).not.toHaveBeenCalled()
  })
  it('creates through the existing idempotent store and requires revision on every mutation', async () => {
    const body = {
      sessionId: 'session',
      operation: 'create',
      id: 'stable',
      content: 'meet',
      when: '2099-01-01T09:00:00+08:00',
      timezone: 'Asia/Shanghai',
    }
    await executeReminderAgent('owner', 'machine', body)
    expect(f.save).toHaveBeenCalledWith('owner', 'stable', body)
    for (const operation of ['update', 'complete', 'delete', 'restore']) {
      await expect(
        executeReminderAgent('owner', 'machine', { ...body, operation }),
      ).rejects.toThrow('invalid_revision')
    }
    await executeReminderAgent('owner', 'machine', { ...body, operation: 'complete', revision: 4 })
    expect(f.state).toHaveBeenCalledWith('owner', 'stable', 'completed', 4)
    f.save.mockRejectedValueOnce(new Error('revision_conflict'))
    await expect(
      executeReminderAgent('owner', 'machine', { ...body, operation: 'update', revision: 3 }),
    ).rejects.toThrow('revision_conflict')
  })
  it('keeps list pagination inside the owner scope', async () => {
    f.list.mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ key: `row-${i}` })))
    const result = await executeReminderAgent('owner', 'machine', {
      sessionId: 'session',
      operation: 'list',
      before: 'cursor',
    })
    expect(f.list).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner',
          kind: 'reminder',
          state: { not: 'deleted' },
          key: { lt: 'cursor' },
        },
      }),
    )
    expect(result).toMatchObject({ nextBefore: 'row-199' })
    expect((result as { items: unknown[] }).items).toHaveLength(200)
  })
  it('parses unscheduled memos without inventing a trigger and still rejects invalid model output', async () => {
    f.model.mockResolvedValueOnce({ content: 'meeting', when: '2099-01-01T09:00:00+08:00' })
    await expect(
      previewReminder({ text: '2099年元旦上午九点开会', timezone: 'Asia/Shanghai' }),
    ).resolves.toMatchObject({ content: 'meeting', timezone: 'Asia/Shanghai' })
    f.model.mockResolvedValueOnce({ content: '充值阿里云', when: '' })
    await expect(previewReminder({ text: '充值阿里云', timezone: 'Asia/Shanghai' })).resolves.toEqual({
      content: '充值阿里云', when: '', timezone: 'Asia/Shanghai', rule: null, dueAt: null,
    })
    expect(f.model.mock.calls.at(-1)![0]).toContain('不要追问')
    f.model.mockResolvedValueOnce({ error: 'need_time' })
    await expect(previewReminder({ text: '开会', timezone: 'Asia/Shanghai' })).rejects.toThrow()
    expect(f.save).not.toHaveBeenCalled()
  })
  it('rejects non-machine callers and sanitizes server failures', async () => {
    const app = Fastify()
    await app.register(personalReminderAgentRoutes)
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/api/personal-reminders/agent', payload: {} }))
          .statusCode,
      ).toBe(403)
      f.session.mockRejectedValueOnce(new Error('private database detail'))
      const failed = await app.inject({
        method: 'POST',
        url: '/api/personal-reminders/agent',
        headers: { 'x-test-machine': 'machine' },
        payload: { sessionId: 'session', operation: 'list' },
      })
      expect(failed.statusCode).toBe(503)
      expect(failed.json()).toEqual({ error: 'reminders_unavailable' })
    } finally {
      await app.close()
    }
  })
})


it('serves both Edge-rewritten and direct reminder Agent paths with identical ownership checks', async () => {
  const app = Fastify()
  await app.register(personalReminderAgentRoutes)
  f.list.mockResolvedValue([])
  try {
    for (const url of ['/personal-reminders/agent', '/api/personal-reminders/agent']) {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(403)
      const response = await app.inject({ method: 'POST', url, headers: { 'x-test-machine': 'machine' }, payload: { sessionId: 'session', operation: 'list' } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ items: [], nextBefore: null })
    }
  } finally { await app.close() }
})
