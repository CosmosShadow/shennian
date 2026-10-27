// @arch open-source/docs/server-runtime.md
// @test src/__tests__/steward-projects.test.ts
import { filterAvailableAgentTypes } from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { ownedMachine } from './local-apps/gateway.js'
import { createProjectForUser, getUserProject, updateProjectLaunchDefaults } from './projects.js'
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null
export async function createStewardProject(userId: string, raw: unknown) {
  const b = raw as Record<string, unknown>
  if (!b || Object.keys(b).some(k => !['machineId', 'workDir', 'name'].includes(k)) || !text(b.machineId, 191) || !text(b.workDir, 2000)) throw new Error('project_input_invalid')
  if (b.name !== undefined && !text(b.name, 120)) throw new Error('project_input_invalid')
  const dir = String(b.workDir).trim()
  if (!(/^(\/|[A-Za-z]:[\\/])/.test(dir)) || /[\u0000-\u001f]/.test(dir)) throw new Error('project_input_invalid')
  await ownedMachine(userId, String(b.machineId))
  const project = await createProjectForUser({ userId, machineId: String(b.machineId), workDir: dir })
  if (b.name !== undefined) await prisma.sessionProject.update({ where: { id: project.id }, data: { displayName: String(b.name).trim() } })
  return { ...project, ...(b.name !== undefined ? { displayName: String(b.name).trim() } : {}) }
}
export async function updateStewardProject(userId: string, projectId: string, raw: unknown) {
  const b = raw as Record<string, unknown>
  if (!b || !Object.keys(b).length || Object.keys(b).some(k => !['name', 'agentType', 'modelId'].includes(k)) || (b.name !== undefined && !text(b.name, 120)) || (b.modelId !== undefined && b.modelId !== null && !text(b.modelId, 191))) throw new Error('project_input_invalid')
  if (b.modelId !== undefined && b.agentType === undefined) throw new Error('project_input_invalid')
  const project = await getUserProject(userId, projectId)
  await ownedMachine(userId, project.machineId)
  let result = project
  if (b.agentType !== undefined) {
    const agentType = typeof b.agentType === 'string' ? filterAvailableAgentTypes([b.agentType])[0] : undefined
    if (!agentType || agentType === 'pi' || agentType === 'manager') throw new Error('project_input_invalid')
    await updateProjectLaunchDefaults({ userId, projectId, agentType, modelId: b.modelId ? String(b.modelId).trim() : null })
    result = await getUserProject(userId, projectId)
  }
  if (b.name !== undefined) result = await prisma.sessionProject.update({ where: { id: projectId }, data: { displayName: String(b.name).trim() } })
  return { projectId: result.id, name: result.displayName, machineId: result.machineId, workDir: result.workDir, defaultAgentType: result.defaultAgentType, defaultModelId: result.defaultModelId }
}
