// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-native-session.test.ts

import { isRoomRuntimeAdapter, roomRuntimeAgentType, type RoomRuntimeAdapter } from '@shennian/wire'
import { createHash } from 'node:crypto'
import { prisma } from '../lib/prisma.js'

type Database = typeof prisma

export class RoomNativeSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomNativeSessionError'
  }
}

export async function resolveRoomNativeSession(input: {
  userId: string
  machineId: string
  runtimeAdapter: RoomRuntimeAdapter
  sourceSessionKey: string
  database?: Database
}): Promise<{ nianSessionId: string; created: boolean }> {
  validateInput(input)
  const database = input.database ?? prisma
  const agentType = roomRuntimeAgentType(input.runtimeAdapter)
  if (!agentType)
    throw new RoomNativeSessionError('invalid_runtime_adapter', 'Unsupported Room runtime adapter.')

  try {
    return await database.$transaction(async (tx) => {
      const machine = await tx.machine.findFirst({
        where: { id: input.machineId, userId: input.userId },
        select: { id: true, daemonInstallationId: true },
      })
      if (!machine) {
        throw new RoomNativeSessionError(
          'room_session_machine_forbidden',
          'The authenticated machine does not belong to this user.',
        )
      }
      if (!machine.daemonInstallationId) {
        throw new RoomNativeSessionError(
          'upgrade_required',
          'The machine must establish its daemon installation identity first.',
        )
      }

      const sourceKey = {
        machineId: input.machineId,
        agentType,
        sourceSessionKey: input.sourceSessionKey,
      }
      const deleted = await tx.nativeSourceDeletion.findUnique({
        where: {
          daemonInstallationId_agentType_sourceSessionKeyHash: {
            daemonInstallationId: machine.daemonInstallationId,
            agentType,
            sourceSessionKeyHash: createHash('sha256').update(input.sourceSessionKey).digest('hex'),
          },
        },
        select: { id: true },
      })
      if (deleted) {
        throw new RoomNativeSessionError(
          'room_native_session_deleted',
          'This native Agent conversation was deleted and cannot be reconnected automatically.',
        )
      }

      const existingSource = await tx.roomNativeSourceSession.findUnique({
        where: { machineId_agentType_sourceSessionKey: sourceKey },
        select: {
          sessionId: true,
          session: { select: { userId: true, deletedAt: true } },
        },
      })
      if (existingSource) {
        if (existingSource.session.userId !== input.userId || existingSource.session.deletedAt) {
          throw new RoomNativeSessionError(
            'room_native_session_unavailable',
            'The exact Shennian conversation is unavailable.',
          )
        }
        return { nianSessionId: existingSource.sessionId, created: false }
      }

      const existingSession = await tx.nianSession.findFirst({
        where: {
          machineId: input.machineId,
          userId: input.userId,
          agentType,
          agentSessionId: input.sourceSessionKey,
          deletedAt: null,
        },
        select: { id: true },
      })
      if (existingSession) {
        await tx.roomNativeSourceSession.create({
          data: {
            sessionId: existingSession.id,
            ...sourceKey,
            sourceMode: 'room_hook',
            lastImportedAt: new Date(),
          },
        })
        return { nianSessionId: existingSession.id, created: false }
      }

      const session = await tx.nianSession.create({
        data: {
          machineId: input.machineId,
          userId: input.userId,
          agentType,
          agentSessionId: input.sourceSessionKey,
          title: '',
          status: 'active',
          workDir: '',
          lastActivityAt: new Date(),
          deletedAt: null,
        },
        select: { id: true },
      })
      await tx.roomNativeSourceSession.create({
        data: {
          sessionId: session.id,
          ...sourceKey,
          sourceMode: 'room_hook',
          lastImportedAt: new Date(),
        },
      })
      return { nianSessionId: session.id, created: true }
    })
  } catch (error) {
    if (error instanceof RoomNativeSessionError) throw error
    if (isUniqueConflict(error)) {
      const source = await database.roomNativeSourceSession.findUnique({
        where: {
          machineId_agentType_sourceSessionKey: {
            machineId: input.machineId,
            agentType,
            sourceSessionKey: input.sourceSessionKey,
          },
        },
        select: {
          sessionId: true,
          session: { select: { userId: true, deletedAt: true } },
        },
      })
      if (source?.session.userId === input.userId && !source.session.deletedAt) {
        return { nianSessionId: source.sessionId, created: false }
      }
    }
    throw error
  }
}

function validateInput(input: {
  userId: string
  machineId: string
  runtimeAdapter: string
  sourceSessionKey: string
}): void {
  if (
    !input.userId ||
    input.userId.length > 512 ||
    !input.machineId ||
    input.machineId.length > 512
  ) {
    throw new RoomNativeSessionError('invalid_room_native_session', 'Invalid machine identity.')
  }
  if (!isRoomRuntimeAdapter(input.runtimeAdapter)) {
    throw new RoomNativeSessionError('invalid_room_native_session', 'Unsupported Agent runtime.')
  }
  if (
    !input.sourceSessionKey ||
    input.sourceSessionKey.length > 1024 ||
    /[\0\r\n]/.test(input.sourceSessionKey)
  ) {
    throw new RoomNativeSessionError(
      'invalid_room_native_session',
      'Invalid native Session identity.',
    )
  }
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}
