// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-room-binding.test.ts

import {
  isAvailableAgentType,
  type AgentType,
  type ReqFrame,
  type RoomActivationMode,
} from '@shennian/wire'
import type { ManagedRoomBinder } from '../../room/managed-room-binding.js'
import type { SessionManagerRuntime } from '../types.js'

const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,191}$/
const BIND_PARAMS = new Set([
  'roomId',
  'agentIdentityId',
  'nianSessionId',
  'assignmentIntentId',
  'agentType',
  'activationMode',
])
const RESTART_PARAMS = new Set([
  'roomId',
  'bindingId',
  'agentIdentityId',
  'previousNianSessionId',
  'nianSessionId',
  'assignmentIntentId',
  'agentType',
])

export async function handleManagedRoomBind(
  runtime: SessionManagerRuntime,
  binder: ManagedRoomBinder | null,
  req: ReqFrame,
) {
  const result = await bindManagedRoom(runtime, binder, req.params)
  runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: result })
}

export async function bindManagedRoom(
  runtime: SessionManagerRuntime,
  binder: ManagedRoomBinder | null,
  params: Record<string, unknown>,
) {
  if (!binder) throw new Error('Managed Room binding is unavailable.')
  if (Object.keys(params).some((key) => !BIND_PARAMS.has(key))) {
    throw new Error('Managed Room binding contains unsupported parameters.')
  }
  const roomId = requireId(params.roomId, 'roomId')
  const agentIdentityId = requireId(params.agentIdentityId, 'agentIdentityId')
  const nianSessionId = requireId(params.nianSessionId, 'nianSessionId')
  const assignmentIntentId = requireId(params.assignmentIntentId, 'assignmentIntentId')
  const agentType = requireManagedAgentType(params.agentType)
  const activationMode = requireActivationMode(params.activationMode)
  await discardPreBindingSession(runtime, nianSessionId)
  return binder.bind({
    roomId,
    agentIdentityId,
    nianSessionId,
    assignmentIntentId,
    sourceSessionKey: managedSourceSessionKey(nianSessionId),
    agentType,
    activationMode,
  })
}

export async function handleManagedRoomRestart(
  runtime: SessionManagerRuntime,
  binder: ManagedRoomBinder | null,
  req: ReqFrame,
) {
  if (!binder) throw new Error('Managed Room binding is unavailable.')
  if (Object.keys(req.params).some((key) => !RESTART_PARAMS.has(key))) {
    throw new Error('Managed Room restart contains unsupported parameters.')
  }
  const roomId = requireId(req.params.roomId, 'roomId')
  const bindingId = requireId(req.params.bindingId, 'bindingId')
  const agentIdentityId = requireId(req.params.agentIdentityId, 'agentIdentityId')
  const previousNianSessionId = requireId(req.params.previousNianSessionId, 'previousNianSessionId')
  const nianSessionId = requireId(req.params.nianSessionId, 'nianSessionId')
  const assignmentIntentId = requireId(req.params.assignmentIntentId, 'assignmentIntentId')
  const agentType = requireManagedAgentType(req.params.agentType)
  // Machine, working-directory and runtime changes intentionally start a new
  // managed conversation. Stop the old Provider work and discard its pending
  // queue before the authoritative Binding swap instead of waiting for stale
  // work to finish under the previous runtime context.
  await runtime.managerRuntime?.retireManagerAndWorkers(previousNianSessionId)
  await discardPreBindingSession(runtime, previousNianSessionId)
  runtime.chatQueue?.purgeSession(previousNianSessionId)
  await discardPreBindingSession(runtime, nianSessionId)
  const result = await binder.restart({
    roomId,
    bindingId,
    agentIdentityId,
    previousNianSessionId,
    nianSessionId,
    assignmentIntentId,
    sourceSessionKey: managedSourceSessionKey(nianSessionId),
    agentType,
  })
  runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: result })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`Invalid ${field}.`)
  }
  return value
}

function requireManagedAgentType(value: unknown): AgentType {
  if (
    typeof value !== 'string' ||
    !isAvailableAgentType(value) ||
    value === 'manager' ||
    value === 'pi' ||
    value === 'openclaw'
  ) {
    throw new Error('managed_agent_runtime_unsupported')
  }
  return value
}

function requireActivationMode(value: unknown): RoomActivationMode {
  if (value === undefined) return 'auto_follow'
  if (value === 'auto_follow' || value === 'mention_only' || value === 'paused') return value
  throw new Error('Invalid activationMode.')
}

function managedSourceSessionKey(nianSessionId: string): string {
  return `managed:${nianSessionId}`
}

export async function discardPreBindingSession(
  runtime: SessionManagerRuntime,
  nianSessionId: string,
): Promise<void> {
  runtime.runJournal?.markSessionAborted(nianSessionId)
  runtime.recoveryBarrier?.end(nianSessionId)
  const session = runtime.sessions.get(nianSessionId)
  if (!session) return
  runtime.sessions.delete(nianSessionId)
  if (session.managedRoomContextToken) {
    runtime.revokeManagedRoomContextToken?.(session.managedRoomContextToken)
    session.managedRoomContextToken = null
  }
  if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
  session.adapter.removeAllListeners()
  await session.adapter.stop()
}
