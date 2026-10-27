// @covers src/storage/db.native.ts
// @covers src/storage/room-agent-store.native.ts
// @covers src/features/rooms/useRoomConversationModel.native.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('client local-first persistence', () => {
  it('defines Room and Agent stores for the native SQLite control plane', () => {
    const shared = read('../../../../open-source/packages/shared/src/storage.ts')
    const native = read('../storage/room-agent-store.native.ts')
    for (const method of [
      'getRoomSummaries',
      'replaceRoomSummaries',
      'getRoomMessages',
      'saveRoomMessages',
      'getRoomMembers',
      'replaceRoomMembers',
      'getAgents',
      'replaceAgents',
      'getAgent',
      'upsertAgent',
    ]) {
      expect(shared).toContain(method)
      expect(native).toContain(method)
    }
  })

  it('orders Room BigInt sequences without converting them to JavaScript numbers', () => {
    const native = read('../storage/room-agent-store.native.ts')
    expect(native).toContain("value.padStart(40, '0')")
    expect(native).not.toContain('Number(message.sequence)')
  })

  it('restores cached Room content before refreshing the server', () => {
    const screen = read('../features/rooms/useRoomConversationModel.native.ts')
    expect(screen).toContain('const ROOM_MESSAGE_PAGE_SIZE = 50')
    expect(screen).toContain(
      'db.getRoomMessages(accountId, roomId, { limit: ROOM_MESSAGE_PAGE_SIZE + 1 })',
    )
    expect(screen).toContain("setState('ready')")
    expect(screen.indexOf('db.getRoomMessages(accountId')).toBeLessThan(
      screen.indexOf('fetchRoomContext(roomId)'),
    )
    expect(screen).toContain('db.saveRoomMessages(accountId, roomId, messageData.messages)')
    expect(screen).toContain('db.removeRoom(accountId, roomId)')
    expect(screen).toContain('db.getRoomSyncState(accountId, roomId)')
    expect(screen).toContain('limit: ROOM_MESSAGE_PAGE_SIZE')
  })

  it('purges revoked Room bodies and sync watermarks during authoritative list reconciliation', () => {
    const native = read('../storage/room-agent-store.native.ts')
    expect(native).toContain("'DELETE FROM room_messages WHERE accountId = ? AND roomId = ?'")
    expect(native).toContain("'DELETE FROM room_members WHERE accountId = ? AND roomId = ?'")
    expect(native).toContain("'DELETE FROM room_sync_state WHERE accountId = ? AND roomId = ?'")
  })

  it('keeps private Agent configuration separate and removes revoked projections', () => {
    const native = read('../storage/room-agent-store.native.ts')
    const detail = read('../features/agents/useAgentDetailModel.native.ts')
    expect(native).toContain("systemPrompt: ''")
    expect(native).toContain('agent_private_configs')
    expect(native).toContain('agent_session_links')
    expect(detail).toContain('isAgentAccountNotFound(error)')
    expect(detail).toContain('db.removeAgent(accountId, agentId)')
  })

  it('persists the daemon-local readiness boundary in the native session index', () => {
    const native = read('../storage/db.native.ts')
    expect(native).toContain('localReady INTEGER NOT NULL DEFAULT 0')
    expect(native).toContain('localReady: row.localReady === 1')
    expect(native).toContain('session.localReady ? 1 : 0')
  })

  it('keeps remote index targets separate from body-backed list publication', () => {
    const native = read('../storage/db.native.ts')
    const shared = read('../../../../open-source/packages/shared/src/storage.ts')
    expect(native).toContain('personal_session_published_index')
    expect(native).toContain('AND (published.sessionId IS NOT NULL OR sessions.localCreationState IS NOT NULL)')
    expect(native).toContain('WHERE sessions.bodyRevision > 0')
    expect(native).toContain('published.bodyRevision AS publishedBodyRevision')
    expect(native).toContain('published.lastVisibleEventAt AS publishedLastVisibleEventAt')
    expect(native).toContain('session.lastVisibleEventAt ?? null')
    expect(native).toContain('async getSessionSyncTargets()')
    expect(native).toContain('await publishSessionIndexIfBodyReady(db, session.id)')
    expect(shared).toContain('getSessionSyncTargets?(): Promise<NianSession[]>')
  })
})
