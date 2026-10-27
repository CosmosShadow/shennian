// @covers packages/app/src/features/schedules/scheduleClient.native.ts
import { afterEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('../config/api', () => ({ authApi: api }))
import { scheduleClient } from '../features/schedules/scheduleClient.native'
afterEach(() => vi.resetAllMocks())
it('does not report Worker creation as successful when an old Server ignores the execution mode', async () => {
  const input = { operationId: 'stable', prompt: 'diary', timeDescription: '每天23:00', timezone: 'UTC', executionMode: 'worker' as const }
  api.mockResolvedValue({ task: { id: 'legacy-task' } })
  await expect(scheduleClient.create('machine', input)).rejects.toThrow('schedule_server_upgrade_required')
  api.mockResolvedValue({ task: { id: 'worker-task', executionMode: 'worker' } })
  await expect(scheduleClient.create('machine', input)).resolves.toMatchObject({ task: { executionMode: 'worker' } })
  expect(api.mock.calls[0]).toEqual(api.mock.calls[1])
})
