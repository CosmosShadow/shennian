import { builtinPersonalAgentEnabled } from '../personal-model-feature.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-workspace.test.ts
import { prisma } from '../../lib/prisma.js'
import { ownedMachine } from '../local-apps/gateway.js'
import { sendServerReqToMachine } from '../../relay/server-requests.js'
export const primaryMachineKey = (userId: string) => ({ userId_kind_key: { userId, kind: 'personal-agent', key: 'primary-machine' } })
export async function primaryMachine(userId: string) {
  let row = await prisma.personalModuleRecord.findUnique({ where: primaryMachineKey(userId) })
  if (!row) {
    // Persist the first default so adding another computer or going offline never switches it.
    const machines = await prisma.machine.findMany({ where: { userId, paired: true, remoteAccessDisabledAt: null }, select: { id: true }, take: 2 })
    if (machines.length !== 1) return { machine: null, revision: 0 }
    try {
      row = await prisma.personalModuleRecord.create({ data: { userId, kind: 'personal-agent', key: 'primary-machine', payload: { machineId: machines[0]!.id } } })
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      // A simultaneous default or explicit choice won; always use the stored result.
      row = await prisma.personalModuleRecord.findUnique({ where: primaryMachineKey(userId) })
      if (!row) throw new Error('personal_primary_conflict')
    }
  }
  const machineId = (row.payload as { machineId?: unknown })?.machineId
  if (typeof machineId !== 'string') throw new Error('personal_primary_unavailable')
  try { return { machine: await ownedMachine(userId, machineId), revision: row.revision } }
  catch { return { machine: null, revision: row.revision, unavailable: true } }
}
export async function setPrimaryMachine(userId: string, raw: unknown) {
  const b = raw as Record<string, unknown>
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['machineId', 'expectedRevision', 'confirmed'].includes(k)) || typeof b.machineId !== 'string' || b.confirmed !== true || !Number.isSafeInteger(b.expectedRevision) || Number(b.expectedRevision) < 0) throw new Error('personal_invalid_request')
  const current = await primaryMachine(userId)
  if (current.revision !== b.expectedRevision) throw new Error('personal_primary_conflict')
  const machine = await ownedMachine(userId, b.machineId)
  if (!machine.online) throw new Error('personal_machine_offline')
  const info = await sendServerReqToMachine(machine.id, { type: 'req', method: 'personal.workspace', params: { action: 'info' } }, 20000)
  if (!info.ok || !(info.payload as { readOnly?: boolean })?.readOnly) throw new Error('personal_client_upgrade_required')
  if (current.machine?.id === machine.id) return current
  if (!current.revision) {
    try { await prisma.personalModuleRecord.create({ data: { userId, kind: 'personal-agent', key: 'primary-machine', payload: { machineId: machine.id } } }) }
    catch (error) { if ((error as { code?: string }).code === 'P2002') throw new Error('personal_primary_conflict'); throw error }
  } else {
    const updated = await prisma.personalModuleRecord.updateMany({ where: { userId, kind: 'personal-agent', key: 'primary-machine', revision: current.revision }, data: { payload: { machineId: machine.id }, revision: { increment: 1 } } })
    if (!updated.count) throw new Error('personal_primary_conflict')
  }
  return { machine, revision: current.revision + 1 }
}
export async function readPrimaryWorkspace(userId: string, raw: unknown) {
  const b = raw as Record<string, unknown>
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['action', 'kind', 'path', 'offset', 'expectedPrimaryRevision', 'settings', 'content', 'expectedRevision'].includes(k)) || !['info', 'list', 'read', 'diary', 'model_info', 'model_set', 'worker_info', 'worker_set', 'diary_write'].includes(String(b.action))) throw new Error('personal_invalid_request')
  if (b.action === 'diary_write' && (b.kind !== 'diary' || typeof b.path !== 'string' || !/^\d{4}\/\d{4}-\d{2}-\d{2}\.md$/.test(b.path) || typeof b.content !== 'string' || Buffer.byteLength(b.content) > 512 * 1024 || typeof b.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(b.expectedRevision))) throw new Error('personal_invalid_request')
  if ((b.action === 'model_info' || b.action === 'model_set') && !builtinPersonalAgentEnabled()) throw new Error('personal_model_unavailable')
  const primary = await primaryMachine(userId)
  if (b.expectedPrimaryRevision !== primary.revision) throw new Error('personal_primary_conflict')
  if (!primary.machine) throw new Error(primary.revision ? 'personal_primary_unavailable' : 'personal_primary_not_configured')
  if (!primary.machine.online) throw new Error('personal_machine_offline')
  const result = await sendServerReqToMachine(primary.machine.id, { type: 'req', method: 'personal.workspace', params: Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'expectedPrimaryRevision')) }, 20000)
  if (!result.ok) throw new Error(/^personal_[a-z_]+$/.test(result.error ?? '') ? result.error : 'personal_client_upgrade_required')
  const latest = await primaryMachine(userId)
  if (latest.revision !== primary.revision || latest.machine?.id !== primary.machine.id) throw new Error('personal_primary_conflict')
  const payload = result.payload as Record<string, unknown>
  if (b.action === 'worker_info' || b.action === 'worker_set') {
    if (!payload || !(payload.agentType === null || typeof payload.agentType === 'string') || !(payload.modelId === null || typeof payload.modelId === 'string')) throw new Error('personal_client_upgrade_required')
    const agents = b.action === 'worker_info' && Array.isArray(payload.agents) ? payload.agents.slice(0, 100).map(raw => {
      const agent = raw as { type?: unknown; models?: unknown }
      if (typeof agent?.type !== 'string' || !Array.isArray(agent.models)) throw new Error('personal_client_upgrade_required')
      return { type: agent.type, models: agent.models.slice(0, 500).map(rawModel => {
        const model = rawModel as { id?: unknown; name?: unknown }
        if (typeof model?.id !== 'string') throw new Error('personal_client_upgrade_required')
        return { id: model.id, name: typeof model.name === 'string' ? model.name : model.id }
      }) }
    }) : undefined
    if (b.action === 'worker_info' && !agents) throw new Error('personal_client_upgrade_required')
    return { agentType: payload.agentType, modelId: payload.modelId, ...(typeof payload.workDir === 'string' || payload.workDir === null ? { workDir: payload.workDir } : {}), ...(typeof payload.defaultWorkDir === 'string' ? { defaultWorkDir: payload.defaultWorkDir } : {}), ...(agents ? { agents } : {}), primaryRevision: primary.revision }
  }
  if (b.action === 'model_info' || b.action === 'model_set') {
    if (!payload || !['official', 'custom'].includes(String(payload.mode)) || typeof payload.model !== 'string') throw new Error('personal_client_upgrade_required')
    return { mode: payload.mode, model: payload.model, baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl : '', hasApiKey: payload.hasApiKey === true, contextWindow: payload.contextWindow, primaryRevision: primary.revision }
  }
  return { ...payload, primaryMachine: primary.machine, primaryRevision: primary.revision }
}
