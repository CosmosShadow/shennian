// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test packages/app/src/__tests__/session-account-client.test.ts
import type { NianSession } from '@shennian/wire'
import type { SessionAccountClient } from './sessionAccountClient.types'

type Operation = 'session.index.get' | 'session.create' | 'session.update'
type Result = { ok: true; value: unknown } | {
  ok: false
  error: { code: string; message: string; retryable: boolean; action?: 'retry' | 'sign_in' }
}
type DesktopRoot = typeof globalThis & {
  shennianDesktop?: { account?: {
    execute(command: { requestId: string; operation: Operation; input: Record<string, unknown> }): Promise<Result>
  } }
}

let sequence = 0

export class DesktopSessionAccountError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false,
    readonly action?: 'retry' | 'sign_in') {
    super(message)
    this.name = 'DesktopSessionAccountError'
  }
}

export const sessionAccountClient: SessionAccountClient = {
  async getSession(sessionId) {
    return requireSession(await execute('session.index.get', { sessionId }), sessionId)
  },
  async createSession({ machineId, agentType, workDir, modelId }) {
    return requireSession(await execute('session.create', {
      machineId, agentType, workDir,
      ...(modelId === undefined ? {} : { settings: { modelId } }),
    }))
  },
  async updateSession(sessionId, changes) {
    await execute('session.update', { sessionId, changes })
  },
}

async function execute(operation: Operation, input: Record<string, unknown>): Promise<unknown> {
  const bridge = (globalThis as DesktopRoot).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopSessionAccountError('BRIDGE_UNAVAILABLE', 'Desktop Session account bridge is unavailable.')
  }
  const result = await bridge.execute({
    requestId: `session-account-${Date.now()}-${++sequence}`, operation, input,
  })
  if (result.ok) return result.value
  throw new DesktopSessionAccountError(result.error.code, result.error.message,
    result.error.retryable, result.error.action)
}

function requireSession(value: unknown, expectedId?: string): NianSession {
  const session = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { session?: unknown }).session : undefined
  if (!session || typeof session !== 'object' || Array.isArray(session)) throw invalidOutput()
  const record = session as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id || typeof record.machineId !== 'string'
    || typeof record.agentType !== 'string' || typeof record.workDir !== 'string'
    || (expectedId !== undefined && record.id !== expectedId)) throw invalidOutput()
  return session as NianSession
}

function invalidOutput(): DesktopSessionAccountError {
  return new DesktopSessionAccountError('INVALID_OUTPUT', 'Desktop Session response is invalid.')
}
