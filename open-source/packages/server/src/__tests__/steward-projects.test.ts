// @covers src/services/steward-projects.ts
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ owned: vi.fn(), create: vi.fn(), get: vi.fn(), defaults: vi.fn(), update: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: { sessionProject: { update: mocks.update } } }))
vi.mock('../services/local-apps/gateway.js', () => ({ ownedMachine: mocks.owned }))
vi.mock('../services/projects.js', () => ({ createProjectForUser: mocks.create, getUserProject: mocks.get, updateProjectLaunchDefaults: mocks.defaults }))
import { createStewardProject, updateStewardProject } from '../services/steward-projects.js'
beforeEach(() => { vi.clearAllMocks(); const p = { id: 'p', machineId: 'm', workDir: '/project', displayName: 'Old', defaultAgentType: 'codex', defaultModelId: null }; mocks.create.mockResolvedValue(p); mocks.get.mockResolvedValue(p); mocks.update.mockResolvedValue({ ...p, displayName: 'New' }); mocks.owned.mockResolvedValue({ id: 'm' }) })
it('reuses the canonical project creation service and requires an owned machine', async () => {
  expect(await createStewardProject('u', { machineId: 'm', workDir: '/project', name: 'New' })).toMatchObject({ id: 'p', displayName: 'New' })
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ userId: 'u', machineId: 'm', workDir: '/project' })
  mocks.owned.mockRejectedValue(new Error('machine_owner_required'))
  await expect(createStewardProject('u', { machineId: 'other', workDir: '/project' })).rejects.toThrow('machine_owner_required')
  expect(mocks.create).toHaveBeenCalledTimes(1)
})
it('rejects relative paths, unknown fields, invalid names and standalone model changes', async () => {
  for (const body of [{ machineId: 'm', workDir: '../bad' }, { machineId: 'm', workDir: '/project', name: '' }, { machineId: 'm', workDir: '/project', userId: 'other' }]) await expect(createStewardProject('u', body)).rejects.toThrow('project_input_invalid')
  await expect(updateStewardProject('u', 'p', { modelId: 'x' })).rejects.toThrow('project_input_invalid')
  await expect(updateStewardProject('u', 'p', { agentType: 'manager' })).rejects.toThrow('project_input_invalid')
})
it('changes metadata only, never moves or deletes project files', async () => {
  expect(await updateStewardProject('u', 'p', { name: 'New', agentType: 'codex', modelId: null })).toMatchObject({ projectId: 'p', name: 'New', workDir: '/project' })
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'p' }, data: { displayName: 'New' } })
})
