// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/sync-engine.test.ts

import type {
  AgentInfo,
  ChatQueueSnapshot,
  Machine,
  NianProject,
  NianSession,
  UpgradeEventPayload,
} from '@shennian/wire'
import type { ClientIndexStore } from './storage'

export type ApiClient = <T>(path: string, opts?: RequestInit) => Promise<T>

export type ChangeNotifier = {
  onSessionsChange(sessions: NianSession[]): void
  onSessionUpdate(session: NianSession): void
  onSessionBatchUpdate?(sessions: NianSession[]): void
  /** A raw index target changed, including one still hidden behind body coverage. */
  onSessionIndexTargetChange?(sessionId?: string): void
  onSessionDelete(sessionId: string, deletionRevision?: number): void
  onMachinesChange(machines: Machine[]): void
  /** Persist dependent Agent/Room projections before an unavailable machine can be replayed from cache. */
  onMachineRemoved?(machineId: string): void
  /** Called only after the server has authoritatively returned the machine inventory. */
  onMachinesRemoteResolved?(): void
  onProjectsChange(projects: NianProject[]): void
  onMachineStatus(
    machineId: string,
    online: boolean,
    region?: string,
    cliVersion?: string,
    autoUpgrade?: 'none' | 'patch',
    sync?: Pick<Machine, 'sessionSyncProtocolVersion' | 'sessionSyncDataEpoch' | 'sessionSyncCapabilities' | 'daemonInstallationId' | 'updaterProtocolVersion'>,
  ): void
  onMachineAgentList(machineId: string, agentList: string[]): void
  onMachineAgents(machineId: string, agentList: string[], agents: AgentInfo[]): void
  onUpgradeEvent(payload: UpgradeEventPayload & { machineId: string }): void
  onSessionQueueUpdate?(sessionId: string, queue: ChatQueueSnapshot): void
  /** Called when a server sync round (boot or reconnect) starts/ends. */
  onSyncStart?(): void
  onSyncEnd?(): void
}

export type SyncEngineOptions = {
  store: ClientIndexStore
  api: ApiClient
  onChange: ChangeNotifier
  cacheVersion?: string | null
  /** Clear App-owned personal caches outside ClientIndexStore before committing the epoch marker. */
  onPersonalDataReset?: () => Promise<void> | void
}

export const DEFAULT_SESSIONS_PAGE_SIZE = 50

export function toMs(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function apiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

export function isCompleteSessionProjection(
  patch: (Partial<NianSession> & Pick<NianSession, 'id'>) | null | undefined,
): patch is NianSession {
  if (!patch) return false
  const requiredStrings: Array<keyof NianSession> = [
    'id',
    'machineId',
    'userId',
    'agentType',
    'title',
    'status',
    'workDir',
    'lastActivityAt',
    'createdAt',
    'updatedAt',
  ]
  if (!requiredStrings.every((key) => typeof patch[key] === 'string')) return false
  if (!Object.prototype.hasOwnProperty.call(patch, 'agentSessionId')) return false

  const preview = patch.lastMessagePreview ?? null
  if (preview === null) {
    return patch.lastMessagePreviewMessageId == null && patch.lastMessagePreviewAt == null
  }
  return (
    typeof patch.lastMessagePreviewMessageId === 'string' &&
    patch.lastMessagePreviewMessageId.length > 0 &&
    toMs(patch.lastMessagePreviewAt) > 0
  )
}

export function hasCoherentPreviewTuple(patch: Partial<NianSession>): boolean {
  const tupleKeys = ['lastMessagePreview', 'lastMessagePreviewMessageId', 'lastMessagePreviewAt']
  const touched = tupleKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))
  if (!touched) return true
  if (!tupleKeys.every((key) => Object.prototype.hasOwnProperty.call(patch, key))) return false
  const preview = patch.lastMessagePreview ?? null
  if (preview === null) {
    return patch.lastMessagePreviewMessageId == null && patch.lastMessagePreviewAt == null
  }
  return Boolean(
    patch.lastMessagePreviewMessageId &&
    toMs(patch.lastMessagePreviewAt) > 0,
  )
}
