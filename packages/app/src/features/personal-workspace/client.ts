// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/remote-folders.test.ts
import { authApi } from '../../config/api'
export type WorkspaceEntry = { path: string; name?: string; isDir?: boolean; date?: string; title?: string; summary?: string; revision?: string }
export type WorkspaceResponse = { workspace?: string; diary?: string | null; path?: string; content?: string; entries?: WorkspaceEntry[]; nextOffset?: number | null; revision?: string; snapshot?: string; diarySync?: number; diaryEdit?: number }
export type PrimaryMachine = { machine: { id: string; name: string; online: boolean } | null; revision: number; unavailable?: boolean }
export const primaryMachineClient = {
  get: () => authApi<PrimaryMachine>('/personal-workspace/primary-machine'),
  set: (machineId: string, expectedRevision: number) => authApi<PrimaryMachine>('/personal-workspace/primary-machine', { method: 'PUT', body: JSON.stringify({ machineId, expectedRevision, confirmed: true }) }, { timeoutMs: 25000 }),
}
export const personalWorkspaceClient = (params: { action: 'info' | 'list' | 'read' | 'diary' | 'diary_write'; kind?: 'memory' | 'diary'; path?: string; offset?: number; content?: string; expectedRevision?: string; expectedPrimaryRevision?: number }) =>
  authApi<WorkspaceResponse>('/personal-workspace/primary', { method: 'POST', body: JSON.stringify(params) }, { timeoutMs: 25000 })
export function personalErrorKey(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes('machine_offline')) return 'personal_machine_offline'
  if (text.includes('path_forbidden')) return 'personal_path_forbidden'
  if (text.includes('invalid_request')) return 'personal_invalid_request'
  if (text.includes('file_changed')) return 'personal_diary_conflict'
  if (text.includes('primary_not_configured')) return 'personal_primary_not_configured'
  if (text.includes('primary_conflict')) return 'personal_primary_conflict'
  if (text.includes('primary_unavailable')) return 'personal_primary_unavailable'
  if (text.includes('directory_not_configured')) return 'personal_directory_not_configured'
  if (text.includes('upgrade_required') || text.includes('404') || (error && typeof error === 'object' && 'status' in error && error.status === 404)) return 'personal_upgrade_required'
  if (text.includes('file_too_large')) return 'personal_file_too_large'
  if (text.includes('text_only')) return 'personal_text_only'
  return 'personal_unavailable'
}
