// @covers open-source/packages/server/src/services/session-room-mirror.ts

import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION,
  type SessionRoomImportMutation } from '@shennian/wire'

const db = vi.hoisted(() => ({ $transaction: vi.fn(), session: vi.fn(),
  migration: vi.fn(), room: vi.fn(), receiptCount: vi.fn(),
  visibleCount: vi.fn(), latestVisible: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: {
  $transaction: db.$transaction,
  nianSession: { findUnique: db.session },
  sessionRoomMigration: { findUnique: db.migration },
  room: { findUnique: db.room },
  sessionRoomMutationReceipt: { count: db.receiptCount },
  roomMessage: { count: db.visibleCount, findFirst: db.latestVisible },
} }))

import { auditSessionRoomMirror, deleteSessionWorkRoomInTransaction,
  importSessionRoomMutations, nextSessionRoomAuditHash,
  sessionRoomMessageId } from '../services/session-room-mirror.js'

const session = { id: 'sess_1', userId: 'owner-1', machineId: 'machine-1',
  daemonInstallationId: 'daemon-1', dataEpoch: SESSION_SYNC_DATA_EPOCH,
  deletedAt: null, bodyStorageMode: 'machine_local', title: 'Work',
  agentType: 'codex', agentIdentityId: null, agentIdentity: null,
  creationKey: null, conversationRoomId: null, roomBinding: null }
const ZERO_HASH = '0'.repeat(64)
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex')

function mutation(revision: number, kind: 'append' | 'upsert' | 'tombstone',
  previousContentHash: string, payload?: string): SessionRoomImportMutation {
  const message = kind === 'tombstone' ? undefined : {
    id: 'msg-1', sessionId: session.id, role: 'user' as const,
    ts: Date.parse('2026-09-27T00:00:00Z'), payload: payload!,
  }
  const contentHash = sha256(JSON.stringify({ mutation: kind, message: message ?? null,
    deliveryState: null }))
  return { protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: 'daemon-1', schemaVersion: 1,
    mutationId: sha256(`${session.id}\0msg-1\0${kind}\0${previousContentHash}\0${contentHash}`),
    sessionId: session.id, revision, mutation: kind, messageId: 'msg-1',
    sequence: 1, ...(message ? { message } : {}),
    committedAt: '2026-09-27T00:00:00Z', contentHash }
}

function transaction() {
  const messages = new Map<string, Record<string, unknown>>()
  let migration: Record<string, unknown> | null = null
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: session.id }]),
    nianSession: { findUnique: vi.fn().mockResolvedValue(session),
      update: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) },
    user: { findUnique: vi.fn().mockResolvedValue({ name: 'Owner' }) },
    room: { findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}) },
    roomMembership: { upsert: vi.fn().mockImplementation(({ create }: {
      create: { principalType: string }
    }) => Promise.resolve({ id: create.principalType === 'human' ? 'human-1' : 'agent-1',
      status: 'active' })),
      findUnique: vi.fn().mockImplementation(({ where }: {
        where: { roomId_principalKey: { principalKey: string } }
      }) => Promise.resolve({ id: where.roomId_principalKey.principalKey.startsWith('human:')
        ? 'human-1' : 'agent-1', displayAlias: 'Owner' })) },
    roomReadState: { upsert: vi.fn().mockResolvedValue({}) },
    roomMessage: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(messages.get(where.id) ?? null)),
      create: vi.fn().mockImplementation(({ data }: { data: { id: string } }) => {
        messages.set(data.id, data)
        return Promise.resolve(data)
      }),
      update: vi.fn().mockImplementation(({ where, data }: {
        where: { id: string }; data: Record<string, unknown>
      }) => {
        messages.set(where.id, { ...messages.get(where.id), ...data })
        return Promise.resolve(messages.get(where.id))
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    sessionRoomMigration: { findUnique: vi.fn().mockImplementation(() => Promise.resolve(migration)),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        migration = { copiedRevision: 0, copiedSequence: 0n, state: 'shadow', ...data }
        return Promise.resolve(migration)
      }),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        migration = { ...migration, ...data }
        return Promise.resolve(migration)
      }) },
    sessionRoomMutationReceipt: { create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]) },
  }
  return { tx, messages }
}

describe('inert Session Room mirror candidate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps append/upsert/tombstone to one RoomMessage with exact sequence and audit hash', async () => {
    const { tx, messages } = transaction()
    db.$transaction.mockImplementation((fn) => fn(tx))
    const first = mutation(1, 'append', 'none', 'Hello')
    const second = mutation(2, 'upsert', first.contentHash, 'Hello again')
    const third = mutation(3, 'tombstone', second.contentHash)
    const result = await importSessionRoomMutations({
      sessionId: session.id, machineId: session.machineId,
      ownerUserId: session.userId, daemonInstallationId: 'daemon-1',
      fromRevision: 0, mutations: [first, second, third],
    })
    expect(result).toEqual({ roomId: session.id, copiedRevision: 3,
      copiedSequence: '1', idempotent: false,
      rollingHash: [first, second, third].reduce(nextSessionRoomAuditHash, ZERO_HASH) })
    expect(tx.room.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: session.id, conversationKind: 'work', visibility: 'private', joinPolicy: 'closed',
    }) })
    expect(tx.roomMembership.upsert).toHaveBeenCalledTimes(2)
    expect(tx.roomMessage.create).toHaveBeenCalledTimes(1)
    expect(messages.get(sessionRoomMessageId(session.id, 'msg-1'))).toMatchObject({
      roomId: session.id, sequence: 1n, sessionSourceId: session.id,
      sessionMessageId: 'msg-1', sessionRevision: 3, text: null,
    })
    expect(tx.sessionRoomMutationReceipt.create).toHaveBeenCalledTimes(3)
  })

  it('prepares an empty Session without inventing a message', async () => {
    const { tx } = transaction()
    db.$transaction.mockImplementation((fn) => fn(tx))
    const result = await importSessionRoomMutations({
      sessionId: session.id, machineId: session.machineId,
      ownerUserId: session.userId, daemonInstallationId: 'daemon-1',
      fromRevision: 0, mutations: [],
    })
    expect(result).toMatchObject({ roomId: session.id, copiedRevision: 0,
      copiedSequence: '0', rollingHash: ZERO_HASH })
    const retry = await importSessionRoomMutations({
      sessionId: session.id, machineId: session.machineId,
      ownerUserId: session.userId, daemonInstallationId: 'daemon-1',
      fromRevision: 0, mutations: [],
    })
    expect(retry.idempotent).toBe(true)
    expect(tx.roomMessage.create).not.toHaveBeenCalled()
  })

  it('rejects another machine and a changed mutation hash', async () => {
    const { tx } = transaction()
    db.$transaction.mockImplementation((fn) => fn(tx))
    const first = mutation(1, 'append', 'none', 'Hello')
    await expect(importSessionRoomMutations({ sessionId: session.id,
      machineId: 'other-machine', ownerUserId: session.userId,
      daemonInstallationId: 'daemon-1', fromRevision: 0, mutations: [first] }))
      .rejects.toMatchObject({ code: 'identity_conflict' })
    await expect(importSessionRoomMutations({ sessionId: session.id,
      machineId: session.machineId, ownerUserId: session.userId,
      daemonInstallationId: 'daemon-1', fromRevision: 0,
      mutations: [{ ...first, contentHash: 'a'.repeat(64) }] }))
      .rejects.toMatchObject({ code: 'invalid' })
  })

  it('acknowledges an identical dropped-receipt retry without another Room write', async () => {
    const { tx } = transaction()
    db.$transaction.mockImplementation((fn) => fn(tx))
    const first = mutation(1, 'append', 'none', 'Hello')
    const input = { sessionId: session.id, machineId: session.machineId,
      ownerUserId: session.userId, daemonInstallationId: 'daemon-1',
      fromRevision: 0, mutations: [first] }
    const initial = await importSessionRoomMutations(input)
    tx.sessionRoomMutationReceipt.findMany.mockResolvedValue([{ revision: 1,
      mutationId: first.mutationId, contentHash: first.contentHash }])
    const retry = await importSessionRoomMutations(input)
    expect(retry).toEqual({ ...initial, idempotent: true })
    expect(tx.roomMessage.create).toHaveBeenCalledTimes(1)
    expect(tx.sessionRoomMutationReceipt.create).toHaveBeenCalledTimes(1)
  })

  it('requires revision, hash, sequence and visible-message parity before cutover', async () => {
    db.session.mockResolvedValue({ ...session, conversationRoomId: session.id,
      bodyRevision: 3 })
    db.migration.mockResolvedValue({ sessionId: session.id, roomId: session.id,
      state: 'shadow', daemonInstallationId: 'daemon-1', copiedRevision: 3,
      copiedSequence: 2n, rollingHash: 'a'.repeat(64) })
    db.room.mockResolvedValue({ id: session.id, conversationKind: 'work',
      nextSequence: 2n })
    db.receiptCount.mockResolvedValue(3)
    db.visibleCount.mockResolvedValue(2)
    db.latestVisible.mockResolvedValue({ sessionMessageId: 'last-2' })
    const input = { sessionId: session.id, machineId: session.machineId,
      ownerUserId: session.userId, daemonInstallationId: 'daemon-1',
      expectedRevision: 3, expectedRollingHash: 'a'.repeat(64),
      expectedVisibleMessageCount: 2, expectedLastVisibleMessageId: 'last-2' }
    await expect(auditSessionRoomMirror(input)).resolves.toMatchObject({
      ready: true, blockers: [], copiedRevision: 3, copiedSequence: '2',
    })
    await expect(auditSessionRoomMirror({ ...input,
      expectedRollingHash: 'b'.repeat(64) })).resolves.toMatchObject({
      ready: false, blockers: ['hash_parity'],
    })
  })

  it('deletes a work Room only when its final execution Session is deleted', async () => {
    const { tx } = transaction()
    tx.room.findUnique.mockResolvedValue({ id: session.id, conversationKind: 'work' })
    tx.nianSession.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    await deleteSessionWorkRoomInTransaction(tx as never, session.id, session.id)
    expect(tx.room.delete).not.toHaveBeenCalled()
    await deleteSessionWorkRoomInTransaction(tx as never, session.id, session.id)
    expect(tx.roomMessage.deleteMany).toHaveBeenCalledWith({ where: {
      roomId: session.id,
    } })
    expect(tx.room.delete).toHaveBeenCalledWith({ where: { id: session.id } })
  })
})
