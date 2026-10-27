// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/personal-worker-settings.test.ts
import { authApi } from '../../config/api'
export type PersonalWorkerSettings = { agentType: string | null; modelId: string | null; workDir?: string | null }
export type PersonalWorkerSummary = PersonalWorkerSettings & { defaultWorkDir?: string; agents: Array<{ type: string; models: Array<{ id: string; name: string }> }> }
export const personalWorkerClient = {
  read: (expectedPrimaryRevision: number) => authApi<PersonalWorkerSummary>('/personal-workspace/primary', { method: 'POST', body: JSON.stringify({ action: 'worker_info', expectedPrimaryRevision }) }, { timeoutMs: 25000 }),
  save: (expectedPrimaryRevision: number, settings: PersonalWorkerSettings) => authApi<PersonalWorkerSettings>('/personal-workspace/primary', { method: 'POST', body: JSON.stringify({ action: 'worker_set', expectedPrimaryRevision, settings }) }, { timeoutMs: 25000 }),
}
