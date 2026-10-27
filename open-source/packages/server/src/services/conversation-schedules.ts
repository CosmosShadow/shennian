// @arch open-source/docs/server-runtime.md
// @test src/__tests__/conversation-schedules.test.ts
import { createHash } from 'node:crypto'
import type { ConversationSchedule as View, ScheduleAction, ScheduleRule } from '@shennian/wire'
import type { ConversationSchedule } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { nextScheduleTime, parseScheduleTime } from './schedule-time.js'

export function scheduleView(t: ConversationSchedule): View {
  return {
    id: t.id, sessionId: t.sessionId, bindingId: t.bindingId ?? undefined,
    roomId: t.roomId ?? undefined, agentIdentityId: t.agentIdentityId ?? undefined,
    scope: t.scope === 'steward' ? 'steward' : 'room', machineId: t.machineId ?? undefined,
    executionMode: (t.rule as ScheduleRule).executionMode ?? 'main',
    prompt: t.prompt, timeDescription: (t.rule as ScheduleRule).kind === 'once' ? new Date((t.rule as { at: number }).at).toISOString() : t.timeDescription, timezone: t.timezone, rule: t.rule as ScheduleRule,
    state: t.state as View['state'], version: t.version, nextDueAt: t.nextDueAt?.getTime() ?? null,
    createdAt: t.createdAt.getTime(), updatedAt: t.updatedAt.getTime(),
    ...(t.lastState && t.deliveryAt ? { last: { at: t.deliveryAt.getTime(), state: t.lastState as NonNullable<View['last']>['state'], reason: t.lastReason ?? undefined, messageId: t.deliveryId ?? undefined } } : {}),
  }
}
export async function scheduleSession(userId: string, sessionId: string, machineId?: string) {
  const session = await prisma.nianSession.findFirst({ where: { id: sessionId, userId, deletedAt: null, ...(machineId ? { machineId } : {}) }, include: { machine: true, roomBinding: { include: { room: true } } } })
  if (!session || session.machine.userId !== userId) throw new Error('schedule_session_unavailable')
  return session
}
export async function listSchedules(userId: string, scope: { sessionId?: string; roomId?: string; stewardMachineId?: string; allSteward?: boolean }) {
  if (!scope.sessionId && !scope.roomId && !scope.stewardMachineId && !scope.allSteward) throw new Error('schedule_scope_required')
  // A new local draft may not have a server Session yet. The owner filter below
  // remains authoritative and returns no tasks for absent or foreign sessions.
  if (scope.roomId && !await prisma.roomMembership.findFirst({ where: { roomId: scope.roomId, ownerUserId: userId, principalType: 'human', status: 'active' } })) throw new Error('schedule_room_forbidden')
  return (await prisma.conversationSchedule.findMany({ where: { userId, state: { not: 'deleted' },
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}), ...(scope.roomId ? { roomId: scope.roomId } : {}),
    // Steward tasks are bound to the machine, not a particular Session (the Session gets
    // recreated whenever the user switches machine/tool/model/strength); the settings
    // page asks for every machine (allSteward) while an AI turn only sees its own machine.
    ...(scope.stewardMachineId ? { scope: 'steward', machineId: scope.stewardMachineId } : {}),
    ...(scope.allSteward ? { scope: 'steward' } : {}),
  }, orderBy: { createdAt: 'asc' } })).map(scheduleView)
}
export async function executeSchedule(userId: string, sessionId: string, action: ScheduleAction, args: Record<string, unknown>, machineId?: string, trustedOperationKey?: string) {
  const session = await scheduleSession(userId, sessionId, machineId)
  const steward = session.sessionScope === 'steward'
  if (action === 'list') return listSchedules(userId, steward ? { stewardMachineId: session.machineId } : { sessionId })
  const binding = session.roomBinding
  if (!steward && action !== 'delete' && action !== 'pause' && session.agentIdentityId && (!binding || binding.status !== 'active' || binding.room.status !== 'active')) throw new Error('schedule_binding_unavailable')
  const now = Date.now()
  // Steward tasks key idempotency off the machine (the stable identity) instead of the
  // Session, which does not survive a machine/tool/model/strength switch.
  const identityKey = steward ? session.machineId : sessionId
  if (action === 'create') {
    if (steward) {
      // No managed-Room binding exists for a steward conversation; the machine itself is the binding.
    } else if (!session.agentIdentityId || !binding || binding.status !== 'active' || binding.room.status !== 'active') {
      throw new Error('schedule_managed_room_required')
    }
    const key = trustedOperationKey ?? createHash('sha256').update(JSON.stringify([userId, identityKey, required(args.operationId, 191)])).digest('hex')
    const prior = await prisma.conversationSchedule.findUnique({ where: { operationKey: key } })
    if (prior) return scheduleView(prior)
    const prompt = required(args.prompt, 16000)
    const timeDescription = required(args.timeDescription, 500)
    const timezone = required(args.timezone, 100)
    const rule = { ...parseScheduleTime(timeDescription, timezone, now), ...executionMetadata(args.executionMode, steward) }
    const next = nextScheduleTime(rule, timezone, now)
    if (next === null) throw new Error('schedule_time_invalid')
    if (await prisma.conversationSchedule.count({ where: steward ? { scope: 'steward', machineId: session.machineId, state: 'active' } : { sessionId, state: 'active' } }) >= 100) throw new Error('schedule_limit_reached')
    try {
      return scheduleView(await prisma.conversationSchedule.create({ data: {
        userId, sessionId, operationKey: key,
        scope: steward ? 'steward' : 'room', machineId: steward ? session.machineId : null,
        bindingId: steward ? null : binding!.id, roomId: steward ? null : binding!.roomId,
        agentIdentityId: steward ? null : session.agentIdentityId, prompt, timeDescription: rule.kind === 'once' ? new Date(rule.at).toISOString() : timeDescription, timezone,
        rule: rule as unknown as Prisma.InputJsonValue, nextDueAt: new Date(next),
      } }))
    } catch (error) {
      const duplicate = await prisma.conversationSchedule.findUnique({ where: { operationKey: key } })
      if (duplicate) return scheduleView(duplicate)
      throw error
    }
  }
  const task = await prisma.conversationSchedule.findFirst({ where: { id: required(args.id, 191), userId, state: { not: 'deleted' },
    ...(steward ? { scope: 'steward', machineId: session.machineId } : { sessionId } ) } })
  if (!task) throw new Error('schedule_not_found')
  if (!steward && action !== 'delete' && action !== 'pause' && task.bindingId !== (binding?.id ?? null)) throw new Error('schedule_binding_unavailable')
  return applyScheduleMutation(task, action, args, now)
}
/**
 * Steward settings management is not issued from any particular Session (it has none while
 * the user is just browsing settings, and the originating Session may since be deleted); it
 * is authorized by machine ownership alone, matching every other steward machine is Owner-only.
 */
export async function executeStewardSettingsSchedule(userId: string, machineId: string, action: Exclude<ScheduleAction, 'create'>, args: Record<string, unknown>) {
  const machine = await prisma.machine.findFirst({ where: { id: machineId, userId } })
  if (!machine) throw new Error('schedule_session_unavailable')
  if (action === 'list') return listSchedules(userId, { stewardMachineId: machineId })
  const task = await prisma.conversationSchedule.findFirst({ where: { id: required(args.id, 191), userId, scope: 'steward', machineId, state: { not: 'deleted' } } })
  if (!task) throw new Error('schedule_not_found')
  return applyScheduleMutation(task, action, args, Date.now())
}
async function applyScheduleMutation(task: ConversationSchedule, action: ScheduleAction, args: Record<string, unknown>, now: number) {
  if (args.version !== task.version) throw new Error('schedule_version_conflict')
  let state = task.state
  let rule = task.rule as ScheduleRule
  let timeDescription = task.timeDescription
  let timezone = task.timezone
  let prompt = task.prompt
  if (action === 'delete') state = 'deleted'
  else if (action === 'pause') state = 'paused'
  else if (action === 'resume') state = 'active'
  else if (action === 'update') {
    if (args.prompt !== undefined) prompt = required(args.prompt, 16000)
    if (args.timeDescription !== undefined || args.timezone !== undefined) {
      timeDescription = required(args.timeDescription ?? timeDescription, 500)
      timezone = required(args.timezone ?? timezone, 100)
      rule = { ...parseScheduleTime(timeDescription, timezone, now), ...executionMetadata(rule.executionMode, task.scope === 'steward') }
      if (state === 'ended') state = 'active'
    }
  } else throw new Error('schedule_action_invalid')
  if (action === 'update' && args.executionMode !== undefined) rule = { ...rule, ...executionMetadata(args.executionMode, task.scope === 'steward') }
  if (rule.kind === 'once') timeDescription = new Date(rule.at).toISOString()
  const next = state === 'active' ? nextScheduleTime(rule, timezone, now) : null
  if (state === 'active' && next === null) state = 'ended'
  const result = await prisma.conversationSchedule.updateMany({ where: { id: task.id, version: task.version, state: task.state }, data: {
    state, prompt, timeDescription, timezone, rule: rule as unknown as Prisma.InputJsonValue,
    nextDueAt: next === null ? null : new Date(next), version: { increment: 1 },
    deliveryId: null,
  } })
  if (result.count !== 1) throw new Error('schedule_version_conflict')
  return scheduleView((await prisma.conversationSchedule.findUniqueOrThrow({ where: { id: task.id } })))
}
function executionMetadata(value: unknown, steward: boolean): { executionMode?: 'main' | 'worker' } {
  if (value === undefined) return {}
  if ((value !== 'main' && value !== 'worker') || (!steward && value !== 'main')) throw new Error('schedule_execution_invalid')
  return { executionMode: value }
}
function required(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('schedule_input_invalid')
  return value.trim()
}
const deliverySessionInclude = { machine: true, roomBinding: { include: { room: true } } } as const
/**
 * A 'room' task's original sessionId is permanent and is the delivery target as-is. A
 * 'steward' task's sessionId is only where it was created; the user may since have
 * switched machine/tool/model/strength (a new Session each time), so delivery must
 * target whichever steward Session on the bound machine is currently active. If none
 * exists yet, the trigger is skipped (not auto-created): creating one requires a live
 * round trip to the daemon that the delivery job does not perform.
 */
export async function resolveDeliveryTarget(task: ConversationSchedule) {
  if (task.scope !== 'steward') {
    return prisma.nianSession.findFirst({ where: { id: task.sessionId }, include: deliverySessionInclude })
  }
  if (!task.machineId) return null
  const where = { userId: task.userId, machineId: task.machineId, sessionScope: 'steward', deletedAt: null }
  // Prefer the Client-owned continuous conversation even if a legacy provider
  // session has a more recent index update. Old clients retain their old target.
  const builtin = await prisma.nianSession.findFirst({
    where: { ...where, agentType: 'shennian' },
    orderBy: { lastActivityAt: 'desc' }, include: deliverySessionInclude,
  })
  if (builtin) return builtin
  return prisma.nianSession.findFirst({
    where,
    orderBy: { lastActivityAt: 'desc' }, include: deliverySessionInclude,
  })
}

/** Owner UI creation binds to a trusted builtin session, never a caller-supplied session. */
export async function createMachineSchedule(userId: string, machineId: string, args: Record<string, unknown>, trustedOperationKey?: string) {
  const machine = await prisma.machine.findFirst({ where: { id: machineId, userId } })
  if (!machine || !machine.paired || machine.remoteAccessDisabledAt) throw new Error('schedule_session_unavailable')
  const session = await prisma.nianSession.findFirst({
    where: { userId, machineId, sessionScope: 'steward', agentType: 'shennian', deletedAt: null },
    orderBy: { lastActivityAt: 'desc' },
  })
  if (!session) throw new Error('schedule_builtin_session_required')
  return executeSchedule(userId, session.id, 'create', args, machineId, trustedOperationKey)
}
