// @covers src/storage/room-agent-store.native.ts

import { describe, expect, it } from 'vitest'
import { createRoomAgentStore } from '../storage/room-agent-store.native'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('native Room summary writes', () => {
  it('serializes a detail upsert behind an in-flight list replacement', async () => {
    const rows = new Map<string, { roomId: string; payload: string }>()
    const deleteStarted = deferred()
    const allowReplacementToContinue = deferred()

    const db = {
      async withTransactionAsync(task: () => Promise<void>) {
        await task()
      },
      async getAllAsync(sql: string) {
        if (sql.includes('SELECT roomId, payload')) return [...rows.values()]
        return [...rows.values()].map(({ payload }) => ({ payload }))
      },
      async runAsync(sql: string, ...params: unknown[]) {
        if (sql.startsWith('DELETE FROM room_summaries')) {
          rows.clear()
          deleteStarted.resolve()
          await allowReplacementToContinue.promise
          return
        }

        const roomId = String(params[1])
        if (sql.startsWith('INSERT INTO') && rows.has(roomId)) {
          throw new Error('UNIQUE constraint failed: room_summaries.accountId, room_summaries.roomId')
        }
        rows.set(roomId, { roomId, payload: String(params[3]) })
      },
    }

    const store = createRoomAgentStore(async () => db as never)
    const listRoom = {
      id: 'room-1',
      name: 'List snapshot',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    const detailRoom = {
      ...listRoom,
      name: 'Detail refresh',
      updatedAt: '2026-09-01T00:00:01.000Z',
    }

    const replacement = store.replaceRoomSummaries('account-1', [listRoom as never])
    await deleteStarted.promise
    const detailUpsert = store.upsertRoomSummary('account-1', detailRoom as never)
    allowReplacementToContinue.resolve()

    await expect(Promise.all([replacement, detailUpsert])).resolves.toBeDefined()
    await expect(store.getRoomSummaries('account-1')).resolves.toEqual([detailRoom])
  })

  it('accepts duplicate room ids in one authoritative list snapshot', async () => {
    const rows = new Map<string, { roomId: string; payload: string }>()
    const db = {
      async withTransactionAsync(task: () => Promise<void>) {
        await task()
      },
      async getAllAsync(sql: string) {
        if (sql.includes('SELECT roomId, payload')) return [...rows.values()]
        if (sql.includes('UNION SELECT')) return []
        return [...rows.values()].map(({ payload }) => ({ payload }))
      },
      async runAsync(sql: string, ...params: unknown[]) {
        if (sql.startsWith('DELETE FROM room_summaries')) {
          rows.clear()
          return
        }
        if (sql.startsWith('DELETE FROM')) return
        const roomId = String(params[1])
        if (sql.startsWith('INSERT INTO') && rows.has(roomId)) {
          throw new Error('UNIQUE constraint failed: room_summaries.accountId, room_summaries.roomId')
        }
        rows.set(roomId, { roomId, payload: String(params[3]) })
      },
    }

    const store = createRoomAgentStore(async () => db as never)
    const older = {
      id: 'room-1',
      name: 'Older snapshot',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    const newer = {
      ...older,
      name: 'Newer snapshot',
      updatedAt: '2026-09-01T00:00:01.000Z',
    }

    await expect(store.replaceRoomSummaries('account-1', [older, newer] as never[]))
      .resolves.toBeUndefined()
    await expect(store.getRoomSummaries('account-1')).resolves.toEqual([newer])
  })

  it('never lets a member read observe a replacement between its DELETE and INSERTs', async () => {
    const rows: string[] = []
    const deleted = deferred()
    const continueInserts = deferred()
    const db = {
      async withTransactionAsync(task: () => Promise<void>) {
        await task()
      },
      async getAllAsync() {
        return rows.map((payload) => ({ payload }))
      },
      async runAsync(sql: string, ...params: unknown[]) {
        if (sql.startsWith('DELETE FROM room_members')) {
          rows.length = 0
          deleted.resolve()
          await continueInserts.promise
          return
        }
        rows.push(String(params[3]))
      },
    }
    const store = createRoomAgentStore(async () => db as never)
    const member = (id: string) => ({ id, roomId: 'room-1', payload: { id } })
    rows.push(JSON.stringify({ id: 'm1' }), JSON.stringify({ id: 'm2' }))

    const replacement = store.replaceRoomMembers('account-1', 'room-1', [member('m1'), member('m2')])
    await deleted.promise
    const read = store.getRoomMembers('account-1', 'room-1')
    continueInserts.resolve()

    await replacement
    await expect(read).resolves.toHaveLength(2)
  })
})
