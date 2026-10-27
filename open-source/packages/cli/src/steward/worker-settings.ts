// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/steward-delegation.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isAvailableAgentType, type AgentType } from '@shennian/wire'
import { getShennianDir } from '../config/index.js'
export type StewardWorkerSettings = { agentType: AgentType | null; modelId: string | null; workDir?: string | null }
const file = () => path.join(getShennianDir(), 'personal-worker.json')
export function parseWorkerSettings(raw: unknown): StewardWorkerSettings {
  const p = raw as Record<string, unknown>
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['agentType', 'modelId', 'workDir'].includes(k)) ||
    (p.agentType !== null && (typeof p.agentType !== 'string' || !isAvailableAgentType(p.agentType) || ['manager', 'pi', 'openclaw'].includes(p.agentType))) ||
    (p.modelId !== null && (typeof p.modelId !== 'string' || !p.modelId.trim() || p.modelId.length > 191)) || ((!p.agentType || p.agentType === 'shennian') && p.modelId) || (p.workDir !== undefined && p.workDir !== null && (typeof p.workDir !== 'string' || !path.isAbsolute(p.workDir) || p.workDir.length > 2000 || /[\u0000-\u001f]/.test(p.workDir)))) throw new Error('personal_worker_settings_invalid')
  return { agentType: p.agentType as AgentType | null, modelId: p.modelId as string | null, ...(p.workDir === undefined ? {} : { workDir: p.workDir as string | null }) }
}
export function readWorkerSettings(): StewardWorkerSettings {
  try { return parseWorkerSettings(JSON.parse(fs.readFileSync(file(), 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { agentType: 'shennian', modelId: null }; throw new Error('personal_worker_settings_invalid') }
}
export function saveWorkerSettings(raw: unknown): StewardWorkerSettings {
  const value = parseWorkerSettings(raw)
  fs.mkdirSync(getShennianDir(), { recursive: true, mode: 0o700 })
  const tmp = `${file()}.${randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file()) }
  finally { try { fs.unlinkSync(tmp) } catch { /* renamed */ } }
  return value
}
