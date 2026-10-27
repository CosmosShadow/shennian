// @covers open-source/packages/server/src/services/room-native-session.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { database } = vi.hoisted(() => {
  const database = {
    machine: { findFirst: vi.fn() },
    nativeSourceDeletion: { findUnique: vi.fn() },
    roomNativeSourceSession: { findUnique: vi.fn(), create: vi.fn() },
    nianSession: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  }
  return { database }
})

vi.mock('../lib/prisma.js', () => ({ prisma: database }))

import {
  resolveRoomNativeSession,
  RoomNativeSessionError,
} from '../services/room-native-session.js'

describe('Room native Session resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    database.$transaction.mockImplementation(async (callback: (tx: typeof database) => unknown) =>
      callback(database),
    )
    database.machine.findFirst.mockResolvedValue({
      id: 'machine_1',
      daemonInstallationId: 'daemon_installation_1',
    })
    database.nativeSourceDeletion.findUnique.mockResolvedValue(null)
    database.roomNativeSourceSession.findUnique.mockResolvedValue(null)
    database.nianSession.findFirst.mockResolvedValue(null)
    database.nianSession.create.mockResolvedValue({ id: 'nian_1' })
    database.roomNativeSourceSession.create.mockResolvedValue({ id: 'source_1' })
  })

  it.each([
    ['codex', 'codex'],
    ['claude_code', 'claude'],
    ['workbuddy', 'workbuddy'],
  ] as const)('creates an exact %s mapping using agent type %s', async (runtimeAdapter, agentType) => {
    await expect(resolveRoomNativeSession({
      userId: 'user_1',
      machineId: 'machine_1',
      runtimeAdapter,
      sourceSessionKey: `${runtimeAdapter}-session`,
    })).resolves.toEqual({ nianSessionId: 'nian_1', created: true })

    expect(database.nianSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        machineId: 'machine_1',
        userId: 'user_1',
        agentType,
        agentSessionId: `${runtimeAdapter}-session`,
      }),
      select: { id: true },
    })
    expect(database.roomNativeSourceSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: 'nian_1',
        machineId: 'machine_1',
        agentType,
        sourceSessionKey: `${runtimeAdapter}-session`,
        sourceMode: 'room_hook',
      }),
    })
  })

  it('reuses the exact existing native source without creating a duplicate', async () => {
    database.roomNativeSourceSession.findUnique.mockResolvedValue({
      sessionId: 'nian_existing',
      session: { userId: 'user_1', deletedAt: null },
    })

    await expect(resolveRoomNativeSession({
      userId: 'user_1',
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-session',
    })).resolves.toEqual({ nianSessionId: 'nian_existing', created: false })
    expect(database.nianSession.create).not.toHaveBeenCalled()
  })

  it('does not resurrect a native source deleted by the user', async () => {
    database.nativeSourceDeletion.findUnique.mockResolvedValue({ id: 'deletion_1' })

    await expect(resolveRoomNativeSession({
      userId: 'user_1',
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-session',
    })).rejects.toEqual(expect.objectContaining<Partial<RoomNativeSessionError>>({
      code: 'room_native_session_deleted',
    }))
    expect(database.nativeSourceDeletion.findUnique).toHaveBeenCalledWith({
      where: {
        daemonInstallationId_agentType_sourceSessionKeyHash: {
          daemonInstallationId: 'daemon_installation_1',
          agentType: 'codex',
          sourceSessionKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      select: { id: true },
    })
    expect(database.nianSession.create).not.toHaveBeenCalled()
  })

  it('fails closed before touching Session data when installation identity is missing', async () => {
    database.machine.findFirst.mockResolvedValue({ id: 'machine_1', daemonInstallationId: null })

    await expect(resolveRoomNativeSession({
      userId: 'user_1',
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-session',
    })).rejects.toEqual(expect.objectContaining<Partial<RoomNativeSessionError>>({
      code: 'upgrade_required',
    }))
    expect(database.nativeSourceDeletion.findUnique).not.toHaveBeenCalled()
    expect(database.nianSession.create).not.toHaveBeenCalled()
  })

  it('rejects a machine outside the authenticated user', async () => {
    database.machine.findFirst.mockResolvedValue(null)
    await expect(resolveRoomNativeSession({
      userId: 'user_1',
      machineId: 'machine_foreign',
      runtimeAdapter: 'workbuddy',
      sourceSessionKey: 'workbuddy-session',
    })).rejects.toEqual(expect.objectContaining<Partial<RoomNativeSessionError>>({
      code: 'room_session_machine_forbidden',
    }))
  })

  it('converges on the exact source when another resolver wins the unique-key race', async () => {
    database.$transaction.mockRejectedValue({ code: 'P2002' })
    database.roomNativeSourceSession.findUnique.mockResolvedValue({
      sessionId: 'nian_winner',
      session: { userId: 'user_1', deletedAt: null },
    })
    await expect(resolveRoomNativeSession({
      userId: 'user_1',
      machineId: 'machine_1',
      runtimeAdapter: 'claude_code',
      sourceSessionKey: 'same-session',
    })).resolves.toEqual({ nianSessionId: 'nian_winner', created: false })
  })
})
