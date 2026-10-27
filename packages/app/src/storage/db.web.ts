// @arch docs/features/desktop-local-first-client.md
// @test src/__tests__/desktop-storage-bridge.test.ts

import type { ClientDataStore } from '@shennian/shared'
import type { PersonalSessionBodyStore } from './personal-session-body-store.native'

type DesktopDataBridge = {
  query(request: DesktopDataRequest): Promise<DesktopDataResult>
  subscribe(
    listener: (event: { accountId: string; sessionId: string; state: unknown }) => void,
  ): () => void
}
type DesktopDataRequest = { requestId: string; method: string; args: unknown[] }
type DesktopDataResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

const DESKTOP_DATA_QUERIES = new Set([
  'getSessions', 'getSession', 'getSessionSyncTargets', 'getSessionSyncTarget',
  'getSessionDeletion', 'getSessionDeletionBatch', 'getPendingSessionDeletions',
  'getSessionSyncCursor', 'getSessionBackfillComplete', 'getSessionBackfillCursor',
  'getSyncCacheVersion', 'getProjects', 'getMachines', 'getRoomSummaries',
  'getRoomMessages', 'getRoomMembers', 'getRoomSyncState', 'getRoomJoinRequests',
  'getAgents', 'getAgent', 'personal.getState', 'personal.getStates',
  'personal.getMessages', 'personal.getMessagesByUserTurns',
])
let requestSequence = 0
function bridge(): DesktopDataBridge {
  const value = (
    globalThis as typeof globalThis & { shennianDesktop?: { data?: DesktopDataBridge } }
  ).shennianDesktop?.data
  if (!value || typeof value.query !== 'function') {
    throw new Error(
      'Desktop local-data bridge is unavailable; browser Web must not start account-level storage',
    )
  }
  return value
}

async function invoke<T>(method: string, ...args: unknown[]): Promise<T> {
  const requestId = `renderer-${Date.now()}-${++requestSequence}`
  const target = bridge()
  const request = { requestId, method, args }
  if (!DESKTOP_DATA_QUERIES.has(method)) throw new Error('Desktop storage only supports queries')
  const result = await target.query(request)
  if (!result.ok) {
    throw Object.assign(new Error(result.error.message), { code: result.error.code })
  }
  return result.value as T
}

type DesktopDataStore = Pick<ClientDataStore,
  'getSessions' | 'getSession' | 'getSessionSyncTargets' | 'getSessionSyncTarget' |
  'getSessionDeletion' | 'getSessionDeletionBatch' | 'getPendingSessionDeletions' |
  'getSessionSyncCursor' | 'getSessionBackfillComplete' | 'getSessionBackfillCursor' |
  'getSyncCacheVersion' | 'getProjects' | 'getMachines' | 'getRoomSummaries' |
  'getRoomMessages' | 'getRoomMembers' | 'getRoomSyncState' | 'getRoomJoinRequests' |
  'getAgents' | 'getAgent'>

export const db: DesktopDataStore = {
  getSessions: () => invoke('getSessions'),
  getSession: (id) => invoke('getSession', id),
  getSessionSyncTargets: () => invoke('getSessionSyncTargets'),
  getSessionSyncTarget: (id) => invoke('getSessionSyncTarget', id),
  getSessionDeletion: (id) => invoke('getSessionDeletion', id),
  getSessionDeletionBatch: (ids) => invoke('getSessionDeletionBatch', ids),
  getPendingSessionDeletions: () => invoke('getPendingSessionDeletions'),
  getSessionSyncCursor: () => invoke('getSessionSyncCursor'),
  getSessionBackfillComplete: () => invoke('getSessionBackfillComplete'),
  getSessionBackfillCursor: () => invoke('getSessionBackfillCursor'),
  getSyncCacheVersion: () => invoke('getSyncCacheVersion'),
  getProjects: () => invoke('getProjects'),
  getMachines: () => invoke('getMachines'),
  getRoomSummaries: (accountId) => invoke('getRoomSummaries', accountId),
  getRoomMessages: (accountId, roomId, options) => invoke('getRoomMessages', accountId, roomId, options ?? {}),
  getRoomMembers: (accountId, roomId) => invoke('getRoomMembers', accountId, roomId),
  getRoomSyncState: (accountId, roomId) => invoke('getRoomSyncState', accountId, roomId),
  getRoomJoinRequests: (accountId) => invoke('getRoomJoinRequests', accountId),
  getAgents: (accountId) => invoke('getAgents', accountId),
  getAgent: (accountId, agentId) => invoke('getAgent', accountId, agentId),
}

export const personalSessionBodyStore: Pick<PersonalSessionBodyStore,
  'getState' | 'getStates' | 'getMessages' | 'getMessagesByUserTurns' | 'subscribe'> = {
  getState: (accountId, sessionId) => invoke('personal.getState', accountId, sessionId),
  getStates: (accountId) => invoke('personal.getStates', accountId),
  getMessages: (accountId, sessionId, options) =>
    invoke('personal.getMessages', accountId, sessionId, options ?? {}),
  getMessagesByUserTurns: (accountId, sessionId, options) =>
    invoke('personal.getMessagesByUserTurns', accountId, sessionId, options),
  subscribe(accountId, sessionId, listener) {
    return bridge().subscribe((event) => {
      if (event.accountId === accountId && event.sessionId === sessionId) listener(event.state as never)
    })
  },
}
