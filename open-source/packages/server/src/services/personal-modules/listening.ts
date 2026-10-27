// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-modules.test.ts
import { createHash } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import { withDistributedLease } from '../distributed-lease.js'
import { get, put, records, keyWhere } from './store.js'
import { decideListeningAnalysis } from './listening-decision.js'
import { completeModuleJson } from './model.js'
import { object, reminder, text } from './domain.js'
import {
  DEFAULT_LISTENING,
  listeningPreferencesValue,
  listeningProposal,
  LISTENING_ANALYSIS_SYSTEM,
  hasListeningWakeWord,
} from './listening-policy.js'
export async function listeningPreferences(userId: string, raw?: unknown) {
  if (raw !== undefined) {
    const next = listeningPreferencesValue(raw)
    await put(userId, 'preferences', 'listening', next)
    return next
  }
  const row = await get(userId, 'preferences', 'listening')
  return row ? listeningPreferencesValue(row.payload) : { ...DEFAULT_LISTENING }
}

async function agentContext(userId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = object(raw),
    primary = await get(userId, 'personal-agent', 'primary-machine')
  const machineId = primary && object(primary.payload).machineId
  if (typeof machineId !== 'string' || typeof b.sessionId !== 'string') return null
  const session = await prisma.nianSession.findFirst({
    where: { id: b.sessionId, userId, machineId, sessionScope: 'steward', deletedAt: null },
    select: { id: true },
  })
  if (!session || !Array.isArray(b.messages)) return null
  let budget = 2400
  const messages = b.messages.slice(-6).flatMap((rawMessage) => {
    if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) return []
    const m = object(rawMessage)
    if (
      !['user', 'agent'].includes(String(m.role)) ||
      typeof m.text !== 'string' ||
      typeof m.ts !== 'number' ||
      !Number.isFinite(m.ts) ||
      Date.now() - m.ts > 1800000 ||
      m.ts > Date.now() + 30000 ||
      budget <= 0
    )
      return []
    const content = m.text.slice(0, Math.min(600, budget))
    budget -= content.length
    return [{ role: m.role, text: content, ts: m.ts }]
  })
  return { sessionId: session.id, messages, source: 'phone_cached_replica_untrusted' }
}
export async function analyzeListening(userId: string, raw: unknown) {
  const pref = await listeningPreferences(userId)
  if (pref.mode !== 'assist') return { status: 'disabled', count: 0 }
  const request = object(raw ?? {}),
    sessionKey = text(request.sessionKey)
  const session = await get(userId, 'recording-session', sessionKey)
  if (!session) throw new Error('invalid_session')
  const lease = await withDistributedLease({
    name: `personal-listening:${userId}`,
    ttlMs: 45000,
    run: async () => {
      const now = Date.now(),
        clock = await get(userId, 'analysis-clock', 'listening')
      if (clock && Number(object(clock.payload).at) > now - 10000)
        return { status: 'cooldown', count: 0 }
      const source = await records.findMany({
        where: {
          userId,
          kind: 'transcript',
          sessionKey,
          state: { not: 'deleted' },
          createdAt: { gte: new Date(now - 600000) },
        },
        orderBy: { key: 'desc' },
        take: 20,
      })
      const pending: typeof source = []
      let budget = 0
      for (const row of [...source].reverse()) {
        const p = object(row.payload),
          at = Date.parse(String(p.endAt))
        if (!Number.isFinite(at) || now - at > 600000 || at > now + 30000) continue
        const done = await get(userId, 'recording-analyzed', row.key)
        if (done && done.revision >= row.revision) continue
        if (pending.length >= 8 || budget + String(p.text).length > 6000) continue
        pending.push(row)
        budget += String(p.text).length
      }
      if (!pending.length) return { status: 'no_pending_text', count: 0 }
      await put(userId, 'analysis-clock', 'listening', { at: now })
      const wakeTimes = source
        .filter((row) => hasListeningWakeWord(String(object(row.payload).text)))
        .map((row) => Date.parse(String(object(row.payload).endAt)))
      const eligible = pending // Name spellings are classifier hints, never a hard rejection gate.
      const reminders = eligible.length
        ? await records.findMany({
            where: { userId, kind: 'reminder', state: { not: 'deleted' } },
            orderBy: { createdAt: 'desc' },
            take: 30,
          })
        : []
      const context =
        eligible.length && pref.agentContext
          ? await agentContext(userId, object(raw ?? {}).context)
          : null
      const handled = await records.findMany({
        where: {
          userId,
          kind: 'recording-action',
          state: 'confirmed',
          sessionKey: { in: pending.map((row) => row.key) },
        },
        take: 12,
      })
      const input = {
        policy: { trigger: pref.trigger, calledRecently: wakeTimes.some(at => now - at >= 0 && now - at <= 60000) },
        alreadyConfirmed: handled.map((row) => ({ ...object(row.payload), sourceText: undefined })),
        pending: eligible.map((row) => ({
          ...object(row.payload),
          key: row.key,
          revision: row.revision,
        })),
        reminders: reminders.map((row) => ({
          key: row.key,
          revision: row.revision,
          state: row.state,
          content: String(object(row.payload).content).slice(0, 200),
          when: object(row.payload).when,
          timezone: object(row.payload).timezone,
        })),
        agentContext: context,
      }
      const decision = await decideListeningAnalysis(input)
      const output =
        eligible.length && decision.needsAnalysis
          ? await completeModuleJson(LISTENING_ANALYSIS_SYSTEM, input, { maxTokens: 700 })
          : { actions: [] }
      // A setting changed during inference must revoke this inference's right to create candidates.
      const currentPref = await listeningPreferences(userId)
      if (
        currentPref.mode !== 'assist' ||
        currentPref.agentContext !== pref.agentContext ||
        currentPref.trigger !== pref.trigger
      )
        return { status: 'settings_changed', count: 0 }
      const proposals = (Array.isArray(output.actions) ? output.actions : [])
        .slice(0, 3)
        .flatMap((rawAction) => {
          try {
            return [listeningProposal(rawAction, eligible, reminders, now)]
          } catch {
            return []
          }
        })
      let count = 0
      await prisma.$transaction(async (tx) => {
        for (const row of pending) {
          const current = await tx.personalModuleRecord.findUnique({
            where: keyWhere(userId, 'transcript', row.key),
          })
          const deleted = await tx.personalModuleRecord.findUnique({
            where: keyWhere(userId, 'deleted-day', row.day!),
          })
          if (!current || current.revision !== row.revision || deleted) continue
          for (const proposal of proposals.filter((p) => p.sourceKey === row.key)) {
            const key = createHash('sha256')
              .update(
                `${row.key}:${proposal.type}:${proposal.targetKey ?? ''}:${proposal.eventTime ?? ''}:${proposal.content}`,
              )
              .digest('hex')
            await tx.personalModuleRecord.upsert({
              where: keyWhere(userId, 'recording-action', key),
              create: {
                userId,
                kind: 'recording-action',
                key,
                sessionKey: row.key,
                day: row.day,
                payload: proposal,
              },
              update: {},
            })
            count++
          }
          await tx.personalModuleRecord.upsert({
            where: keyWhere(userId, 'recording-analyzed', row.key),
            create: {
              userId,
              kind: 'recording-analyzed',
              key: row.key,
              day: row.day,
              revision: row.revision,
              payload: {},
            },
            update: { revision: row.revision },
          })
        }
      })
      return { status: 'ok', count, decision }
    },
  })
  return lease.acquired ? lease.result : { status: 'busy', count: 0 }
}
export async function listeningActions(userId: string) {
  const rows = await records.findMany({
    where: { userId, kind: 'recording-action', state: 'active' },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  return {
    items: rows.filter((row) => Date.parse(String(object(row.payload).expiresAt)) > Date.now()),
  }
}
export async function listeningAction(userId: string, key: string, confirm: boolean) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.personalModuleRecord.findUnique({
      where: keyWhere(userId, 'recording-action', key),
    })
    if (!row || row.state === 'dismissed') throw new Error('not_found')
    const p = object(row.payload)
    if (row.state === 'confirmed') return { saved: true }
    if (!confirm) {
      await tx.personalModuleRecord.updateMany({
        where: { id: row.id, state: 'active' },
        data: { state: 'dismissed' },
      })
      return { saved: true }
    }
    const source = await tx.personalModuleRecord.findUnique({
      where: keyWhere(userId, 'transcript', String(p.sourceKey)),
    })
    const deleted = row.day
      ? await tx.personalModuleRecord.findUnique({
          where: keyWhere(userId, 'deleted-day', row.day),
        })
      : null
    if (
      !source ||
      source.revision !== p.sourceRevision ||
      deleted ||
      Date.parse(String(p.expiresAt)) <= Date.now()
    )
      throw new Error('stale_candidate')
    // Lock the source version through commit, serializing with transcript revisions/deletion.
    const locked = await tx.personalModuleRecord.updateMany({
      where: { id: source.id, revision: source.revision, state: { not: 'deleted' } },
      data: { revision: source.revision },
    })
    if (!locked.count) throw new Error('stale_candidate')
    if (p.type === 'agent_task') {
      // Preparing a draft is not dispatch: the existing composer keeps its own explicit Send gate.
      return {
        saved: false,
        draft: String(p.content),
        sourceKey: p.sourceKey,
        status: 'draft_only',
      }
    }
    const payload =
      p.type === 'reminder_cancel'
        ? null
        : reminder({ content: p.content, when: p.eventTime, timezone: p.timezone })
    if (p.type === 'reminder_create' && payload) {
      await tx.personalModuleRecord.upsert({
        where: keyWhere(userId, 'reminder', `listening:${key}`),
        create: {
          userId,
          kind: 'reminder',
          key: `listening:${key}`,
          payload,
          dueAt: payload.dueAt === null ? null : new Date(payload.dueAt),
        },
        update: {},
      })
    } else {
      const target = await tx.personalModuleRecord.findUnique({
        where: keyWhere(userId, 'reminder', String(p.targetKey)),
      })
      if (!target || target.state === 'deleted' || target.revision !== p.targetRevision)
        throw new Error('revision_conflict')
      const updated = await tx.personalModuleRecord.updateMany({
        where: { id: target.id, revision: p.targetRevision as number, state: { not: 'deleted' } },
        data: payload
          ? { payload, dueAt: payload.dueAt === null ? null : new Date(payload.dueAt), revision: { increment: 1 }, state: 'active' }
          : { state: 'deleted', dueAt: null, revision: { increment: 1 } },
      })
      if (!updated.count) throw new Error('revision_conflict')
    }
    const claimed = await tx.personalModuleRecord.updateMany({
      where: { id: row.id, state: 'active' },
      data: { state: 'confirmed' },
    })
    if (!claimed.count) throw new Error('revision_conflict')
    return { saved: true }
  })
}
