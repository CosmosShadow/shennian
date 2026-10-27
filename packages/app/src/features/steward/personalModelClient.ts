// @arch docs/features/builtin-personal-agent.md
// @test src/__tests__/steward-model.test.ts
import { authApi } from '../../config/api'
export type PersonalModelSummary = { mode: 'official' | 'custom'; model: string; baseUrl: string; hasApiKey: boolean; contextWindow: number }
export type PersonalModelInput = { mode: 'official' | 'custom'; model?: string; baseUrl?: string; apiKey?: string; contextWindow?: number }
/** Never put this mutation in an offline queue or account storage: the body may contain a key. */
export type PersonalModelQuota = { used: number; resetsAt: string; outputWeight: number } & (
  { unlimited?: false; limit: number; remaining: number } | { unlimited: true; limit: null; remaining: null }
)
export const personalModelClient = {
  quota: () => authApi<PersonalModelQuota>('/personal-model/quota'),
  read: (expectedPrimaryRevision: number) => authApi<PersonalModelSummary>('/personal-workspace/primary', { method: 'POST', body: JSON.stringify({ action: 'model_info', expectedPrimaryRevision }) }, { timeoutMs: 25000 }),
  save: (expectedPrimaryRevision: number, settings: PersonalModelInput) => authApi<PersonalModelSummary>('/personal-workspace/primary', { method: 'POST', body: JSON.stringify({ action: 'model_set', expectedPrimaryRevision, settings }) }, { timeoutMs: 25000 }),
}
