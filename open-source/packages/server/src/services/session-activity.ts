import type { AgentEventPayload, SessionActivitySnapshot, SessionRunPhase } from '@shennian/wire'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'

const SESSION_ACTIVITY_PREFIX = 'sessionActivity:'
const SESSION_ACTIVITY_TTL_SECONDS = 4 * 60 * 60
const SESSION_ACTIVITY_CLOSED_RUN_PREFIX = 'sessionActivityClosedRun:'
const SESSION_ACTIVITY_CLOSED_RUN_TTL_SECONDS = 4 * 60 * 60

type ActivityEventPayload = Extract<
  AgentEventPayload,
  {
    state:
      | 'init'
      | 'start'
      | 'heartbeat'
      | 'delta'
      | 'tool-call'
      | 'tool-result'
      | 'approval-pending'
      | 'final'
      | 'error'
      | 'aborted'
      | 'interrupted_by_upgrade'
      | 'recovery_failed'
  }
>

function isRunPhase(value: unknown): value is SessionRunPhase {
  return (
    value === 'thinking' ||
    value === 'tool_running' ||
    value === 'streaming_text' ||
    value === 'waiting_approval' ||
    value === 'waiting_user_input'
  )
}

function activityKey(sessionId: string): string {
  return `${SESSION_ACTIVITY_PREFIX}${sessionId}`
}

function closedRunKey(sessionId: string, runId: string): string {
  return `${SESSION_ACTIVITY_CLOSED_RUN_PREFIX}${sessionId}:${runId}`
}

function mapRunPhase(payload: ActivityEventPayload): SessionRunPhase | null {
  if (payload.state === 'heartbeat') return isRunPhase(payload.runPhase) ? payload.runPhase : null
  if (payload.state === 'tool-call' || payload.state === 'tool-result') return 'tool_running'
  if (payload.state === 'approval-pending') return 'waiting_approval'
  if (payload.state === 'delta') return payload.thinking ? 'thinking' : 'streaming_text'
  if (payload.state === 'init' || payload.state === 'start') return 'thinking'
  return null
}

function isTerminalState(payload: ActivityEventPayload): boolean {
  return payload.state === 'final' || payload.state === 'error' || payload.state === 'aborted'
    || payload.state === 'interrupted_by_upgrade' || payload.state === 'recovery_failed'
}

function serializeSnapshot(snapshot: SessionActivitySnapshot): string {
  return JSON.stringify(snapshot)
}

function parseSnapshot(raw: string | null): SessionActivitySnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SessionActivitySnapshot
    if (!parsed?.sessionId || !parsed.runId || !parsed.runPhase) return null
    if (!isRunPhase(parsed.runPhase)) return null
    return parsed
  } catch {
    return null
  }
}

export async function getSessionActivity(
  sessionId: string,
): Promise<SessionActivitySnapshot | null> {
  try {
    const raw = await redis.get(activityKey(sessionId))
    return parseSnapshot(raw)
  } catch {
    return null
  }
}

export async function getSessionActivities(
  sessionIds: string[],
): Promise<Map<string, SessionActivitySnapshot>> {
  const result = new Map<string, SessionActivitySnapshot>()
  if (sessionIds.length === 0) return result
  try {
    const values = await redis.mget(sessionIds.map((sessionId) => activityKey(sessionId)))
    for (let index = 0; index < sessionIds.length; index++) {
      const snapshot = parseSnapshot(values[index] ?? null)
      if (snapshot) {
        result.set(sessionIds[index], snapshot)
      }
    }
  } catch {
    return result
  }
  return result
}

export async function setSessionActivity(snapshot: SessionActivitySnapshot): Promise<void> {
  try {
    await redis.set(
      activityKey(snapshot.sessionId),
      serializeSnapshot(snapshot),
      'EX',
      SESSION_ACTIVITY_TTL_SECONDS,
    )
  } catch {
    // ignore Redis failures for ephemeral activity state
  }
}

export async function clearSessionActivity(sessionId: string): Promise<void> {
  try {
    await redis.del(activityKey(sessionId))
  } catch {
    // ignore Redis failures for ephemeral activity state
  }
}

export async function clearActivitiesForMachine(machineId: string): Promise<string[]> {
  try {
    const sessions = await prisma.nianSession.findMany({
      where: { machineId, deletedAt: null },
      select: { id: true },
    })
    if (sessions.length === 0) return []
    const keys = sessions.map((s) => activityKey(s.id))
    await redis.del(...keys)
    return sessions.map((s) => s.id)
  } catch {
    // best-effort cleanup
    return []
  }
}

async function markClosedRun(sessionId: string, runId: string): Promise<void> {
  try {
    await redis.set(
      closedRunKey(sessionId, runId),
      '1',
      'EX',
      SESSION_ACTIVITY_CLOSED_RUN_TTL_SECONDS,
    )
  } catch {
    // ignore Redis failures for ephemeral activity state
  }
}

async function clearClosedRun(sessionId: string, runId: string): Promise<void> {
  try {
    await redis.del(closedRunKey(sessionId, runId))
  } catch {
    // ignore Redis failures for ephemeral activity state
  }
}

async function isClosedRun(sessionId: string, runId: string): Promise<boolean> {
  try {
    return Boolean(await redis.get(closedRunKey(sessionId, runId)))
  } catch {
    return false
  }
}

function isActivityEventPayload(payload: Record<string, unknown>): payload is ActivityEventPayload {
  const state = payload.state
  return (
    state === 'init' ||
    state === 'start' ||
    state === 'heartbeat' ||
    state === 'delta' ||
    state === 'tool-call' ||
    state === 'tool-result' ||
    state === 'approval-pending' ||
    state === 'final' ||
    state === 'error' ||
    state === 'aborted' ||
    state === 'interrupted_by_upgrade' ||
    state === 'recovery_failed'
  )
}

export async function updateSessionActivityFromAgentEvent(
  payload: ActivityEventPayload | Record<string, unknown>,
): Promise<SessionActivitySnapshot | null | undefined> {
  if (!isActivityEventPayload(payload)) return null
  const sessionId = payload.sessionId
  const runId = payload.runId
  if (!sessionId || !runId) return null

  if (payload.state === 'init' || payload.state === 'start') {
    await clearClosedRun(sessionId, runId)
  } else if (await isClosedRun(sessionId, runId)) {
    return undefined
  }

  if (isTerminalState(payload)) {
    await markClosedRun(sessionId, runId)
    // Only clear activity if it belongs to the terminating run (or is already empty).
    // If a newer run has already started, don't clear its activity.
    const existing = await getSessionActivity(sessionId)
    if (existing && existing.runId !== runId) {
      return undefined
    }
    await clearSessionActivity(sessionId)
    return null
  }

  const nextRunPhase = mapRunPhase(payload)
  if (!nextRunPhase) return null

  const nowIso = new Date().toISOString()
  const existing = await getSessionActivity(sessionId)
  if (payload.state === 'heartbeat' && existing && existing.runId !== runId) return undefined
  // Re-check closed-run before writing: a concurrent final may have
  // marked the run as closed between our first check and now.
  if (await isClosedRun(sessionId, runId)) return undefined
  const isSameRun = existing?.runId === runId
  const previousToolCallCount =
    isSameRun &&
    typeof existing.toolCallCount === 'number' &&
    Number.isFinite(existing.toolCallCount)
      ? Math.max(0, Math.floor(existing.toolCallCount ?? 0))
      : 0
  const nextSnapshot: SessionActivitySnapshot = {
    sessionId,
    runId,
    runPhase: nextRunPhase,
    startedAt: isSameRun ? existing.startedAt : nowIso,
    updatedAt: nowIso,
    toolCallCount:
      payload.state === 'tool-call' ? previousToolCallCount + 1 : previousToolCallCount,
    canStop:
      typeof (payload as Record<string, unknown>).canStop === 'boolean'
        ? Boolean((payload as Record<string, unknown>).canStop)
        : isSameRun
          ? existing.canStop
          : undefined,
    owner:
      (payload as Record<string, unknown>).owner === 'external'
        ? 'external'
        : isSameRun
          ? existing.owner
          : undefined,
    ownerLabel:
      typeof (payload as Record<string, unknown>).ownerLabel === 'string'
        ? String((payload as Record<string, unknown>).ownerLabel)
        : isSameRun
          ? existing.ownerLabel
          : undefined,
    lifecycle:
      (payload as Record<string, unknown>).lifecycle === 'queued' ||
      (payload as Record<string, unknown>).lifecycle === 'running'
        ? ((payload as Record<string, unknown>).lifecycle as 'queued' | 'running')
        : isSameRun
          ? existing.lifecycle
          : undefined,
  }
  await setSessionActivity(nextSnapshot)
  return nextSnapshot
}
