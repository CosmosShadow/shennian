// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/sync-engine-persistence.test.ts

import type {
  AgentInfo,
  AgentWorkspace,
  Machine,
  NianProject,
  NianSession,
  NativeCleanupPolicy,
  RoomMessageView,
  RoomSummary,
} from '@shennian/wire'

export type LocalSessionDeletion = {
  sessionId: string
  deletedAt: string
  state: 'pending' | 'confirmed'
  /** Missing rows predate native cleanup and therefore mean `none`. */
  nativeCleanupPolicy?: NativeCleanupPolicy
}

export interface ClientIndexStore {
  // --- Sessions ---
  getSessions(): Promise<NianSession[]>
  getSession(id: string): Promise<NianSession | undefined>
  /** Raw remote target, including index tuples waiting for local body coverage. */
  getSessionSyncTargets?(): Promise<NianSession[]>
  getSessionSyncTarget?(id: string): Promise<NianSession | undefined>
  putSession(session: NianSession): Promise<void>
  putSessions(sessions: NianSession[]): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  getSessionDeletion(sessionId: string): Promise<LocalSessionDeletion | undefined>
  /** Batch deletion barriers for Desktop/other IPC stores; avoids one bridge round-trip per row. */
  getSessionDeletionBatch?(sessionIds: string[]): Promise<string[]>
  getPendingSessionDeletions(): Promise<LocalSessionDeletion[]>
  putSessionDeletion(deletion: LocalSessionDeletion): Promise<void>
  removeSessionDeletion(sessionId: string): Promise<void>
  getSessionSyncCursor(): Promise<number>
  setSessionSyncCursor(cursor: number): Promise<void>
  getSessionBackfillComplete(): Promise<boolean>
  setSessionBackfillComplete(complete: boolean): Promise<void>
  getSessionBackfillCursor(): Promise<number>
  setSessionBackfillCursor(cursor: number): Promise<void>
  getSyncCacheVersion(): Promise<string | null>
  setSyncCacheVersion(version: string): Promise<void>
  /** Clear personal projections for a data-epoch hard cut while preserving pairing and Rooms. */
  resetPersonalData?(): Promise<void>

  // --- Projects ---
  getProjects(): Promise<NianProject[]>
  putProjects(projects: NianProject[]): Promise<void>

  // --- Machines ---
  getMachines(): Promise<Machine[]>
  /** Replace the locally cached machine projection with the server-authoritative list. */
  putMachines(machines: Machine[]): Promise<void>
  updateMachineStatus(
    machineId: string,
    online: boolean,
    extra?: {
      cliVersion?: string
      region?: string
      autoUpgrade?: 'none' | 'patch'
      sessionSyncProtocolVersion?: Machine['sessionSyncProtocolVersion']
      sessionSyncDataEpoch?: Machine['sessionSyncDataEpoch']
      sessionSyncCapabilities?: Machine['sessionSyncCapabilities']
      daemonInstallationId?: string
      remoteAccessDisabledAt?: string | null
    },
  ): Promise<void>
  updateMachineAgents(machineId: string, agentList: string[], agents: AgentInfo[]): Promise<void>

  clearAll(): Promise<void>
}

export type LocalRoomMember = {
  id: string
  roomId: string
  payload: Record<string, unknown>
}

export type LocalRoomSummary = RoomSummary & {
  latestMessage?: RoomMessageView | null
  avatarMembers?: Array<Record<string, unknown>>
  roomDetail?: Record<string, unknown>
  membershipId?: string | null
}

export type LocalRoomSyncState = {
  accountId: string
  roomId: string
  windowStartSequence: string
  windowEndSequence: string
  hasOlder: boolean
  serverLastSequence: string
  needsRepair: boolean
  updatedAt: string
}

export type LocalRoomJoinRequest = {
  id: string
  roomId: string
  roomName: string
  status: 'pending'
  createdAt: string
}

export interface RoomStore {
  getRoomSummaries(accountId: string): Promise<LocalRoomSummary[]>
  replaceRoomSummaries(accountId: string, rooms: LocalRoomSummary[]): Promise<void>
  upsertRoomSummary(accountId: string, room: LocalRoomSummary): Promise<void>
  removeRoom(accountId: string, roomId: string): Promise<void>
  getRoomMessages(
    accountId: string,
    roomId: string,
    opts?: { limit?: number; before?: string; after?: string },
  ): Promise<RoomMessageView[]>
  saveRoomMessages(accountId: string, roomId: string, messages: RoomMessageView[]): Promise<void>
  /** Applies an account-scoped history floor without removing the Room inventory entry. */
  applyRoomHistoryFloor(accountId: string, roomId: string, historyFromSequence: string): Promise<void>
  pruneRoomMessagesBefore(accountId: string, roomId: string, cutoffIso: string): Promise<void>
  getRoomMembers(accountId: string, roomId: string): Promise<LocalRoomMember[]>
  replaceRoomMembers(accountId: string, roomId: string, members: LocalRoomMember[]): Promise<void>
  getRoomSyncState(accountId: string, roomId: string): Promise<LocalRoomSyncState | null>
  putRoomSyncState(state: LocalRoomSyncState): Promise<void>
  getRoomJoinRequests(accountId: string): Promise<LocalRoomJoinRequest[]>
  replaceRoomJoinRequests(accountId: string, requests: LocalRoomJoinRequest[]): Promise<void>
  clearRoomAccount(accountId: string): Promise<void>
}

export interface AgentStore {
  getAgents(accountId: string): Promise<AgentWorkspace[]>
  getAgent(accountId: string, agentId: string): Promise<AgentWorkspace | null>
  replaceAgents(accountId: string, agents: AgentWorkspace[]): Promise<void>
  upsertAgent(accountId: string, agent: AgentWorkspace): Promise<void>
  removeAgent(accountId: string, agentId: string): Promise<void>
  /** Persist a removal barrier before network refresh so an offline restart cannot revive stale Agents. */
  markMachineAgentsUnavailable?(accountId: string, machineId: string): Promise<void>
  clearAgentAccount(accountId: string): Promise<void>
}

export interface ClientDataStore extends ClientIndexStore, RoomStore, AgentStore {}
