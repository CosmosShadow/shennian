// @arch docs/features/network-rooms/local-first-persistence.md
// @arch docs/features/managed-agent-restricted-runtime.md
// @test src/__tests__/client-local-persistence.test.ts

import type { SQLiteDatabase } from 'expo-sqlite'
import { withWrite, withWriteTransaction } from './sqlite-write-queue.native'
import type { AgentWorkspace, RoomMessageView } from '@shennian/wire'
import {
  normalizeAgentWorkspacePermissionPolicy,
  projectAgentWorkspaceRuntimeUnavailable,
} from '@shennian/shared'
import type {
  AgentStore,
  LocalRoomJoinRequest,
  LocalRoomMember,
  LocalRoomSummary,
  LocalRoomSyncState,
  RoomStore,
} from '@shennian/shared'

type GetDb = () => Promise<SQLiteDatabase>

const sequenceKey = (value: string): string => value.padStart(40, '0')

function agentIdentityPayload(agent: AgentWorkspace): AgentWorkspace {
  return {
    ...normalizeAgentWorkspacePermissionPolicy(agent),
    systemPrompt: '',
    managerConfig: null,
    sessions: [],
  }
}

export function roomMemberUsesSession(member: LocalRoomMember, sessionIds: ReadonlySet<string>): boolean {
  const binding = member.payload.ownBinding as { nianSessionId?: string } | null | undefined
  return member.payload.principalType === 'agent' && Boolean(binding?.nianSessionId && sessionIds.has(binding.nianSessionId))
}

async function writeAgent(db: SQLiteDatabase, accountId: string, agent: AgentWorkspace) {
  await db.runAsync(
    'INSERT OR REPLACE INTO agent_workspaces (accountId, agentId, pinnedAt, updatedAt, payload) VALUES (?, ?, ?, ?, ?)',
    accountId,
    agent.id,
    agent.pinnedAt ?? null,
    agent.updatedAt,
    JSON.stringify(agentIdentityPayload(agent)),
  )
  await db.runAsync(
    'INSERT OR REPLACE INTO agent_private_configs (accountId, agentId, payload) VALUES (?, ?, ?)',
    accountId,
    agent.id,
    JSON.stringify({ systemPrompt: agent.systemPrompt, managerConfig: agent.managerConfig }),
  )
  await db.runAsync(
    'DELETE FROM agent_session_links WHERE accountId = ? AND agentId = ?',
    accountId,
    agent.id,
  )
  for (const session of agent.sessions) {
    await db.runAsync(
      'INSERT INTO agent_session_links (accountId, agentId, sessionId, lastActivityAt, payload) VALUES (?, ?, ?, ?, ?)',
      accountId,
      agent.id,
      session.id,
      session.lastActivityAt,
      JSON.stringify(session),
    )
  }
}

export async function initializeRoomAgentSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS room_summaries (
      accountId TEXT NOT NULL,
      roomId TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (accountId, roomId)
    );
    CREATE INDEX IF NOT EXISTS idx_room_summaries_account_updated
      ON room_summaries(accountId, updatedAt DESC);
    CREATE TABLE IF NOT EXISTS room_messages (
      accountId TEXT NOT NULL,
      roomId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      sequenceKey TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (accountId, roomId, messageId),
      UNIQUE (accountId, roomId, sequenceKey)
    );
    CREATE INDEX IF NOT EXISTS idx_room_messages_window
      ON room_messages(accountId, roomId, sequenceKey);
    CREATE TABLE IF NOT EXISTS room_members (
      accountId TEXT NOT NULL,
      roomId TEXT NOT NULL,
      membershipId TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (accountId, roomId, membershipId)
    );
    CREATE TABLE IF NOT EXISTS room_sync_state (
      accountId TEXT NOT NULL,
      roomId TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (accountId, roomId)
    );
    CREATE TABLE IF NOT EXISTS room_join_requests (
      accountId TEXT NOT NULL,
      requestId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (accountId, requestId)
    );
    CREATE TABLE IF NOT EXISTS agent_workspaces (
      accountId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      pinnedAt TEXT,
      updatedAt TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (accountId, agentId)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_workspaces_account_updated
      ON agent_workspaces(accountId, pinnedAt DESC, updatedAt DESC);
    CREATE TABLE IF NOT EXISTS agent_private_configs (
      accountId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (accountId, agentId)
    );
    CREATE TABLE IF NOT EXISTS agent_session_links (
      accountId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      lastActivityAt TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (accountId, agentId, sessionId),
      UNIQUE (accountId, sessionId)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_session_links_activity
      ON agent_session_links(accountId, agentId, lastActivityAt DESC);
  `)
}

export function createRoomAgentStore(getDb: GetDb): RoomStore & AgentStore {
  return {
    async getRoomSummaries(accountId) {
      const db = await getDb()
      const rows = await db.getAllAsync<{ payload: string }>(
        'SELECT payload FROM room_summaries WHERE accountId = ? ORDER BY updatedAt DESC',
        accountId,
      )
      return rows.map((row) => JSON.parse(row.payload) as LocalRoomSummary)
    },
    async replaceRoomSummaries(accountId, rooms) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        const existingRows = await db.getAllAsync<{ roomId: string; payload: string }>(
          'SELECT roomId, payload FROM room_summaries WHERE accountId = ?',
          accountId,
        )
        const projectedRoomRows = await db.getAllAsync<{ roomId: string }>(
          `SELECT roomId FROM room_messages WHERE accountId = ?
           UNION SELECT roomId FROM room_members WHERE accountId = ?
           UNION SELECT roomId FROM room_sync_state WHERE accountId = ?`,
          accountId,
          accountId,
          accountId,
        )
        const existingById = new Map(
          existingRows.map((row) => [row.roomId, JSON.parse(row.payload) as LocalRoomSummary]),
        )
        const authoritativeRoomIds = new Set(rooms.map((room) => room.id))
        const removedRoomIds = [
          ...new Set([
            ...existingRows.map((row) => row.roomId),
            ...projectedRoomRows.map((row) => row.roomId),
          ]),
        ].filter((roomId) => !authoritativeRoomIds.has(roomId))
        for (const roomId of removedRoomIds) {
          await db.runAsync(
            'DELETE FROM room_messages WHERE accountId = ? AND roomId = ?',
            accountId,
            roomId,
          )
          await db.runAsync(
            'DELETE FROM room_members WHERE accountId = ? AND roomId = ?',
            accountId,
            roomId,
          )
          await db.runAsync(
            'DELETE FROM room_sync_state WHERE accountId = ? AND roomId = ?',
            accountId,
            roomId,
          )
        }
        await db.runAsync('DELETE FROM room_summaries WHERE accountId = ?', accountId)
        for (const room of rooms) {
          const existing = existingById.get(room.id)
          const merged = {
            ...room,
            roomDetail: room.roomDetail ?? existing?.roomDetail,
            membershipId: room.membershipId ?? existing?.membershipId,
          }
          await db.runAsync(
            'INSERT OR REPLACE INTO room_summaries (accountId, roomId, updatedAt, payload) VALUES (?, ?, ?, ?)',
            accountId,
            merged.id,
            merged.updatedAt,
            JSON.stringify(merged),
          )
        }
      })
    },
    async upsertRoomSummary(accountId, room) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync(
          'INSERT OR REPLACE INTO room_summaries (accountId, roomId, updatedAt, payload) VALUES (?, ?, ?, ?)',
          accountId,
          room.id,
          room.updatedAt,
          JSON.stringify(room),
        )
      })
    },
    async removeRoom(accountId, roomId) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync(
          'DELETE FROM room_summaries WHERE accountId = ? AND roomId = ?',
          accountId,
          roomId,
        )
        await db.runAsync(
          'DELETE FROM room_messages WHERE accountId = ? AND roomId = ?',
          accountId,
          roomId,
        )
        await db.runAsync(
          'DELETE FROM room_members WHERE accountId = ? AND roomId = ?',
          accountId,
          roomId,
        )
        await db.runAsync(
          'DELETE FROM room_sync_state WHERE accountId = ? AND roomId = ?',
          accountId,
          roomId,
        )
      })
    },
    async getRoomMessages(accountId, roomId, opts) {
      const db = await getDb()
      let sql = 'SELECT payload FROM room_messages WHERE accountId = ? AND roomId = ?'
      const params: Array<string | number> = [accountId, roomId]
      if (opts?.before) {
        sql += ' AND sequenceKey < ?'
        params.push(sequenceKey(opts.before))
      }
      if (opts?.after) {
        sql += ' AND sequenceKey > ?'
        params.push(sequenceKey(opts.after))
      }
      sql += ' ORDER BY sequenceKey DESC'
      if (opts?.limit) {
        sql += ' LIMIT ?'
        params.push(opts.limit)
      }
      const rows = await db.getAllAsync<{ payload: string }>(sql, ...params)
      return rows.reverse().map((row) => JSON.parse(row.payload) as RoomMessageView)
    },
    async saveRoomMessages(accountId, roomId, messages) {
      if (!messages.length) return
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        for (const message of messages) {
          await db.runAsync(
            `INSERT OR REPLACE INTO room_messages
             (accountId, roomId, messageId, sequenceKey, createdAt, payload)
             VALUES (?, ?, ?, ?, ?, ?)`,
            accountId,
            roomId,
            message.id,
            sequenceKey(message.sequence),
            message.createdAt,
            JSON.stringify(message),
          )
        }
      })
    },
    async applyRoomHistoryFloor(accountId, roomId, historyFromSequence) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync(
          'DELETE FROM room_messages WHERE accountId = ? AND roomId = ? AND sequenceKey < ?',
          accountId,
          roomId,
          sequenceKey(historyFromSequence),
        )
        await db.runAsync(
          'DELETE FROM room_sync_state WHERE accountId = ? AND roomId = ?',
          accountId,
          roomId,
        )
      })
    },
    async pruneRoomMessagesBefore(accountId, roomId, cutoffIso) {
      const db = await getDb()
      await withWrite(() =>
        db.runAsync(
          'DELETE FROM room_messages WHERE accountId = ? AND roomId = ? AND createdAt < ?',
          accountId,
          roomId,
          cutoffIso,
        ),
      )
    },
    async getRoomMembers(accountId, roomId) {
      const db = await getDb()
      // The shared connection lets a plain read observe a replaceRoomMembers transaction
      // between its DELETE and INSERTs; queue behind writes to see only committed lists.
      const rows = await withWrite(() =>
        db.getAllAsync<{ payload: string }>(
          'SELECT payload FROM room_members WHERE accountId = ? AND roomId = ?',
          accountId,
          roomId,
        ),
      )
      return rows.map((row) => JSON.parse(row.payload) as LocalRoomMember)
    },
    async replaceRoomMembers(accountId, roomId, members) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync(
          'DELETE FROM room_members WHERE accountId = ? AND roomId = ?',
          accountId,
          roomId,
        )
        for (const member of members) {
          await db.runAsync(
            'INSERT INTO room_members (accountId, roomId, membershipId, payload) VALUES (?, ?, ?, ?)',
            accountId,
            roomId,
            member.id,
            JSON.stringify(member),
          )
        }
      })
    },
    async getRoomSyncState(accountId, roomId) {
      const db = await getDb()
      const row = await db.getFirstAsync<{ payload: string } | null>(
        'SELECT payload FROM room_sync_state WHERE accountId = ? AND roomId = ?',
        accountId,
        roomId,
      )
      return row ? (JSON.parse(row.payload) as LocalRoomSyncState) : null
    },
    async putRoomSyncState(state) {
      const db = await getDb()
      await withWrite(() =>
        db.runAsync(
          'INSERT OR REPLACE INTO room_sync_state (accountId, roomId, payload) VALUES (?, ?, ?)',
          state.accountId,
          state.roomId,
          JSON.stringify(state),
        ),
      )
    },
    async getRoomJoinRequests(accountId) {
      const db = await getDb()
      const rows = await db.getAllAsync<{ payload: string }>(
        'SELECT payload FROM room_join_requests WHERE accountId = ? ORDER BY createdAt DESC',
        accountId,
      )
      return rows.map((row) => JSON.parse(row.payload) as LocalRoomJoinRequest)
    },
    async replaceRoomJoinRequests(accountId, requests) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync('DELETE FROM room_join_requests WHERE accountId = ?', accountId)
        for (const request of requests) {
          await db.runAsync(
            'INSERT INTO room_join_requests (accountId, requestId, createdAt, payload) VALUES (?, ?, ?, ?)',
            accountId,
            request.id,
            request.createdAt,
            JSON.stringify(request),
          )
        }
      })
    },
    async clearRoomAccount(accountId) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        for (const table of [
          'room_summaries',
          'room_messages',
          'room_members',
          'room_sync_state',
          'room_join_requests',
        ]) {
          await db.runAsync(`DELETE FROM ${table} WHERE accountId = ?`, accountId)
        }
      })
    },
    async getAgents(accountId) {
      const db = await getDb()
      const rows = await db.getAllAsync<{ agentId: string; payload: string }>(
        `SELECT payload FROM agent_workspaces WHERE accountId = ?
         ORDER BY CASE WHEN pinnedAt IS NULL THEN 1 ELSE 0 END, pinnedAt DESC, updatedAt DESC`,
        accountId,
      )
      return Promise.all(
        rows.map(async (row) => {
          const identity = JSON.parse(row.payload) as AgentWorkspace
          const [config, sessions] = await Promise.all([
            db.getFirstAsync<{ payload: string } | null>(
              'SELECT payload FROM agent_private_configs WHERE accountId = ? AND agentId = ?',
              accountId,
              identity.id,
            ),
            db.getAllAsync<{ payload: string }>(
              'SELECT payload FROM agent_session_links WHERE accountId = ? AND agentId = ? ORDER BY lastActivityAt DESC',
              accountId,
              identity.id,
            ),
          ])
          const privateConfig = config
            ? (JSON.parse(config.payload) as Pick<AgentWorkspace, 'systemPrompt' | 'managerConfig'>)
            : { systemPrompt: '', managerConfig: null }
          return normalizeAgentWorkspacePermissionPolicy({
            ...identity,
            ...privateConfig,
            sessions: sessions.map(
              (item) => JSON.parse(item.payload) as AgentWorkspace['sessions'][number],
            ),
          })
        }),
      )
    },
    async getAgent(accountId, agentId) {
      const db = await getDb()
      const row = await db.getFirstAsync<{ payload: string } | null>(
        'SELECT payload FROM agent_workspaces WHERE accountId = ? AND agentId = ?',
        accountId,
        agentId,
      )
      if (!row) return null
      const identity = JSON.parse(row.payload) as AgentWorkspace
      const [config, sessions] = await Promise.all([
        db.getFirstAsync<{ payload: string } | null>(
          'SELECT payload FROM agent_private_configs WHERE accountId = ? AND agentId = ?',
          accountId,
          agentId,
        ),
        db.getAllAsync<{ payload: string }>(
          'SELECT payload FROM agent_session_links WHERE accountId = ? AND agentId = ? ORDER BY lastActivityAt DESC',
          accountId,
          agentId,
        ),
      ])
      const privateConfig = config
        ? (JSON.parse(config.payload) as Pick<AgentWorkspace, 'systemPrompt' | 'managerConfig'>)
        : { systemPrompt: '', managerConfig: null }
      return normalizeAgentWorkspacePermissionPolicy({
        ...identity,
        ...privateConfig,
        sessions: sessions.map(
          (item) => JSON.parse(item.payload) as AgentWorkspace['sessions'][number],
        ),
      })
    },
    async replaceAgents(accountId, agents) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync('DELETE FROM agent_workspaces WHERE accountId = ?', accountId)
        await db.runAsync('DELETE FROM agent_private_configs WHERE accountId = ?', accountId)
        await db.runAsync('DELETE FROM agent_session_links WHERE accountId = ?', accountId)
        for (const agent of agents) {
          await writeAgent(db, accountId, agent)
        }
      })
    },
    async upsertAgent(accountId, agent) {
      const db = await getDb()
      await withWriteTransaction(db, async () => writeAgent(db, accountId, agent))
    },
    async removeAgent(accountId, agentId) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync(
          'DELETE FROM agent_workspaces WHERE accountId = ? AND agentId = ?',
          accountId,
          agentId,
        )
        await db.runAsync(
          'DELETE FROM agent_private_configs WHERE accountId = ? AND agentId = ?',
          accountId,
          agentId,
        )
        await db.runAsync(
          'DELETE FROM agent_session_links WHERE accountId = ? AND agentId = ?',
          accountId,
          agentId,
        )
      })
    },
    async markMachineAgentsUnavailable(accountId, machineId) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        const agentRows = await db.getAllAsync<{ agentId: string; payload: string }>(
          'SELECT agentId, payload FROM agent_workspaces WHERE accountId = ?',
          accountId,
        )
        const affectedSessionIds = new Set<string>()
        for (const row of agentRows) {
          const current = normalizeAgentWorkspacePermissionPolicy(
            JSON.parse(row.payload) as AgentWorkspace,
          )
          const projected = projectAgentWorkspaceRuntimeUnavailable(current, machineId)
          if (current.machineId === machineId) await db.runAsync(
            'UPDATE agent_workspaces SET payload = ? WHERE accountId = ? AND agentId = ?',
            JSON.stringify(agentIdentityPayload(projected)),
            accountId,
            row.agentId,
          )
          const sessionRows = await db.getAllAsync<{ sessionId: string; payload: string }>(
            'SELECT sessionId, payload FROM agent_session_links WHERE accountId = ? AND agentId = ?',
            accountId,
            row.agentId,
          )
          for (const sessionRow of sessionRows) {
            const session = JSON.parse(sessionRow.payload) as AgentWorkspace['sessions'][number]
            if (session.machineId !== machineId) continue
            affectedSessionIds.add(session.id)
            await db.runAsync(
              'DELETE FROM agent_session_links WHERE accountId = ? AND agentId = ? AND sessionId = ?',
              accountId, row.agentId, sessionRow.sessionId,
            )
          }
        }
        if (affectedSessionIds.size === 0) return
        const memberRows = await db.getAllAsync<{
          roomId: string
          membershipId: string
          payload: string
        }>('SELECT roomId, membershipId, payload FROM room_members WHERE accountId = ?', accountId)
        for (const row of memberRows) {
          const current = JSON.parse(row.payload) as LocalRoomMember
          if (!roomMemberUsesSession(current, affectedSessionIds)) continue
          await db.runAsync(
            'DELETE FROM room_members WHERE accountId = ? AND roomId = ? AND membershipId = ?',
            accountId,
            row.roomId,
            row.membershipId,
          )
        }
      })
    },
    async clearAgentAccount(accountId) {
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync('DELETE FROM agent_workspaces WHERE accountId = ?', accountId)
        await db.runAsync('DELETE FROM agent_private_configs WHERE accountId = ?', accountId)
        await db.runAsync('DELETE FROM agent_session_links WHERE accountId = ?', accountId)
      })
    },
  }
}
