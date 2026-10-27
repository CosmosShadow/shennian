// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @test ../../__tests__/desktop-renderer-boundary.test.ts

import type { NianSession } from '@shennian/wire'
import type { LinkedRoomBindingView } from '../rooms/types'

type Operation = 'session.index.get' | 'room.binding.getBySession'
type Result =
  | { ok: true; value: unknown }
  | {
      ok: false
      error: {
        code: string
        message: string
        retryable: boolean
        action?: 'retry' | 'sign_in'
      }
    }

type AccountBridge = {
  execute(command: {
    requestId: string
    operation: Operation
    input: Record<string, unknown>
  }): Promise<Result>
}

type DesktopWindow = typeof globalThis & {
  shennianDesktop?: { account?: AccountBridge }
}

let requestSequence = 0

export class DesktopChatDataError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopChatDataError'
  }
}

export const desktopChatDataPort = {
  async getSession(sessionId: string): Promise<NianSession> {
    const value = requireObject(await execute('session.index.get', {
      sessionId: requireId(sessionId),
    }))
    return readSession(value.session, sessionId)
  },

  async getRoomBinding(sessionId: string): Promise<LinkedRoomBindingView | null> {
    const value = requireObject(await execute('room.binding.getBySession', {
      sessionId: requireId(sessionId),
    }))
    if (value.binding === null) return null
    return readRoomBinding(value.binding)
  },
}

async function execute(operation: Operation, input: Record<string, unknown>): Promise<unknown> {
  const bridge = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopChatDataError(
      'BRIDGE_UNAVAILABLE',
      'Desktop Chat account bridge is unavailable.',
    )
  }
  const result = await bridge.execute({
    requestId: `desktop-chat-${Date.now()}-${++requestSequence}`,
    operation,
    input,
  })
  if (result.ok) return result.value
  throw new DesktopChatDataError(
    result.error.code,
    result.error.message,
    result.error.retryable,
    result.error.action,
  )
}

function requireId(value: string): string {
  if (!value || value.length > 191 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new DesktopChatDataError('INVALID_INPUT', 'Desktop Chat identifier is invalid.')
  }
  return value
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOutput()
  return value as Record<string, unknown>
}

function readSession(value: unknown, expectedId: string): NianSession {
  const session = requireObject(value)
  if (
    session.id !== expectedId ||
    typeof session.machineId !== 'string' ||
    !session.machineId ||
    typeof session.agentType !== 'string' ||
    typeof session.workDir !== 'string'
  ) {
    throw invalidOutput()
  }
  return session as NianSession
}

function readRoomBinding(value: unknown): LinkedRoomBindingView {
  const binding = requireObject(value)
  const room = requireObject(binding.room)
  if (
    typeof binding.id !== 'string' ||
    !binding.id ||
    !['pending_approval', 'active', 'paused', 'detached'].includes(String(binding.status)) ||
    !['auto_follow', 'mention_only', 'paused'].includes(String(binding.activationMode)) ||
    typeof binding.agentDisplayName !== 'string' ||
    typeof room.id !== 'string' ||
    !room.id ||
    typeof room.name !== 'string' ||
    !['active', 'archived', 'deleted'].includes(String(room.status))
  ) {
    throw invalidOutput()
  }
  return binding as LinkedRoomBindingView
}

function invalidOutput(): DesktopChatDataError {
  return new DesktopChatDataError('INVALID_OUTPUT', 'Desktop Chat projection is invalid.')
}
