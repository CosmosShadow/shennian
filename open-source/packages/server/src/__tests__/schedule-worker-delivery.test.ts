// @covers open-source/packages/server/src/routes/conversation-schedules.ts
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ task: vi.fn(), target: vi.fn() }))
vi.mock('../middleware/auth.js', () => ({ requireAuth: async () => {}, requireUserOrMachineAuth: async (req: any) => { req.userId = 'owner'; req.machineId = 'machine' } }))
vi.mock('../lib/prisma.js', () => ({ prisma: { conversationSchedule: { findFirst: state.task } } }))
vi.mock('../services/conversation-schedules.js', () => ({ resolveDeliveryTarget: state.target, createMachineSchedule: vi.fn(), executeSchedule: vi.fn(), executeStewardSettingsSchedule: vi.fn(), listSchedules: vi.fn() }))
vi.mock('../services/default-diary-schedule.js', () => ({ ensureDefaultDiarySchedule: vi.fn() }))
import { conversationScheduleRoutes } from '../routes/conversation-schedules.js'
const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.resetAllMocks() })
async function delivery(workerDelivery?: boolean) {
  const app = Fastify(); apps.push(app)
  await app.register(conversationScheduleRoutes)
  state.task.mockResolvedValue({ id: 'diary', scope: 'steward', rule: { executionMode: 'worker' }, deliveryAt: new Date(), deliveryId: 'delivery', prompt: 'write diary' })
  state.target.mockResolvedValue({ id: 'main', machineId: 'machine', machine: { userId: 'owner' } })
  return app.inject({ method: 'POST', url: '/schedules/delivery', payload: { id: 'diary', deliveryId: 'delivery', ...(workerDelivery === undefined ? {} : { workerDelivery }) } })
}
describe('Worker delivery capability negotiation', () => {
  it('rejects old Clients instead of sending Worker work into their main Agent queue', async () => {
    const response = await delivery()
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'schedule_client_upgrade_required' })
  })
  it('returns the trusted Worker mode and prompt to a capable Client', async () => {
    const response = await delivery(true)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ executionMode: 'worker', sessionId: 'main', prompt: 'write diary', messageId: 'delivery' })
  })
})
