// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/conversation-schedules.test.ts
import { createHash } from 'node:crypto'
import { executeWorkerCommand } from '../commands/worker.js'
import type { ReqFrame, ScheduleAction } from '@shennian/wire'
import type { CliRelayClient } from '../relay/client.js'
import type { ChatQueueManager } from '../session/queue.js'
import type { RoomSessionRegistry } from '../room/session-registry.js'
import { listSessionRecords } from '../session/store.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
async function request(serverUrl: string, machineToken: string, route: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/schedules${route}`, {
    method: 'POST', headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  })
  const data = await res.json() as { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'schedules_unavailable')
  return data
}
export async function executeServerSchedule(input: { serverUrl: string; machineToken: string; sessionId: string; action: ScheduleAction; args: Record<string, unknown> }) {
  const { context: _context, action: _action, ...safe } = input.args
  return request(input.serverUrl, input.machineToken, '', { ...safe, sessionId: input.sessionId, action: input.action, timezone: safe.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone })
}
export async function deliverServerSchedule(input: { serverUrl: string; machineToken: string; req: ReqFrame; client: CliRelayClient; queue: ChatQueueManager; registry: RoomSessionRegistry }) {
  const value = await request(input.serverUrl, input.machineToken, '/delivery', { ...input.req.params, workerDelivery: true }) as {
    executionMode?: 'main' | 'worker'; sessionId: string; prompt: string; bindingId?: string; roomId?: string; messageId: string
  }
  if (typeof value.sessionId !== 'string' || typeof value.prompt !== 'string' || value.messageId !== input.req.params.deliveryId) throw new Error('schedule_delivery_invalid')
  const record = listSessionRecords().find(s => s.sessionId === value.sessionId)
  if (!record || new NativeSourceDeletionStore().hasSession(value.sessionId)) throw new Error('schedule_session_unavailable')
  const binding = input.registry.getByNianSessionId(value.sessionId)?.binding
  if ((binding?.bindingId ?? null) !== (value.bindingId ?? null)) throw new Error('schedule_binding_mismatch')
  if (value.executionMode !== undefined && value.executionMode !== 'main' && value.executionMode !== 'worker') throw new Error('schedule_delivery_invalid')
  if (value.executionMode === 'worker') {
    if (record.sessionScope !== 'steward' || value.bindingId || value.roomId) throw new Error('schedule_execution_invalid')
    const result = await executeWorkerCommand('start', {
      stewardSessionId: value.sessionId,
      requestId: `schedule-${createHash('sha256').update(value.messageId).digest('hex')}`,
      message: value.prompt, title: value.prompt.slice(0, 80),
      notificationMode: 'direct', scheduleId: String(input.req.params.id),
    })
    if (!result.ok) throw new Error('schedule_worker_start_failed')
    input.client.sendRes({ type: 'res', id: input.req.id, ok: true })
    return
  }
  const ok = await input.queue.enqueueScheduled({ ...input.req, method: 'chat.enqueue', params: {
    ...record, ...getPersonalSyncIdentity(getDaemonInstallationId()),
    sessionId: value.sessionId, text: value.prompt, queueMessageId: value.messageId, clientMessageId: value.messageId,
    scheduledTask: { id: String(input.req.params.id), bindingId: value.bindingId ?? undefined, roomId: value.roomId ?? undefined },
  } })
  // handleEnqueue replies only after durable ownership, using the original request id.
  if (!ok) throw new Error('schedule_enqueue_failed')
}
