// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-modules.test.ts
import { prisma } from '../../lib/prisma.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { object, text, instant, transcript, validDay, reminder, type JsonObject } from './domain.js'
export const records = prisma.personalModuleRecord
const json = (p: unknown) => p as Prisma.InputJsonValue
export function keyWhere(userId: string, kind: string, key: string) {
  return { userId_kind_key: { userId, kind, key } }
}
export async function get(userId: string, kind: string, key: string) {
  return records.findUnique({ where: keyWhere(userId, kind, key) })
}
export async function put(userId: string, kind: string, key: string, payload: unknown) {
  return records.upsert({
    where: keyWhere(userId, kind, key),
    create: { userId, kind, key, payload: json(payload) },
    update: { payload: json(payload) },
  })
}
export async function startSession(userId: string, input: unknown) {
  const b = object(input),
    key = text(b.key),
    startAt = instant(b.startAt)
  return records.upsert({
    where: keyWhere(userId, 'recording-session', key),
    create: { userId, kind: 'recording-session', key, payload: { startAt }, state: 'recording' },
    update: {},
  })
}
export async function finishSession(userId: string, key: string, input: unknown) {
  const b = object(input),
    endAt = instant(b.endAt),
    session = await get(userId, 'recording-session', key)
  if (!session || endAt < String(object(session.payload).startAt))
    throw new Error('invalid_session')
  if (b.state !== 'stopped' && b.state !== 'interrupted') throw new Error('invalid_state')
  return records.update({
    where: { id: session.id },
    data: { state: b.state, payload: json({ ...object(session.payload), endAt }) },
  })
}
export async function saveTranscript(userId: string, input: unknown) {
  return saveRecordingEntry(userId, input, 'transcript')
}
export async function saveRecordingFeedback(userId: string, input: unknown) {
  return saveRecordingEntry(userId, input, 'recording-feedback')
}
async function saveRecordingEntry(userId: string, input: unknown, kind: 'transcript' | 'recording-feedback') {
  const item = { ...transcript(input), ...(kind === 'recording-feedback' ? { speaker: 'assistant' as const } : {}) }
  return prisma.$transaction(async (tx) => {
    const session = await tx.personalModuleRecord.findUnique({
      where: keyWhere(userId, 'recording-session', item.sessionKey),
    })
    if (!session) throw new Error('invalid_session')
    const deleted = await tx.personalModuleRecord.findUnique({
      where: keyWhere(userId, 'deleted-day', item.day),
    })
    if (deleted) return { saved: false, deleted: true }
    const old = await tx.personalModuleRecord.findUnique({
      where: keyWhere(userId, kind, item.key),
    })
    if (old && old.sessionKey !== item.sessionKey) throw new Error('identity_conflict')
    if (old && old.revision >= item.revision) return { saved: true, revision: old.revision }
    if (old) {
      const changed = await tx.personalModuleRecord.updateMany({
        where: { id: old.id, revision: old.revision },
        data: { revision: item.revision, state: 'active', payload: json(item) },
      })
      if (!changed.count) throw new Error('revision_conflict')
      if (kind === 'transcript') {
        await tx.personalModuleRecord.deleteMany({ where: { userId, kind: { in: ['english-event', 'reminder-candidate'] }, sessionKey: item.key } })
        await tx.personalModuleRecord.deleteMany({ where: { userId, kind: 'recording-action', sessionKey: item.key, state: { not: 'confirmed' } } })
      }
    } else
      await tx.personalModuleRecord.create({
        data: {
          userId,
          kind,
          key: item.key,
          sessionKey: item.sessionKey,
          day: item.day,
          revision: item.revision,
          payload: json(item),
        },
      })
    return { saved: true, revision: item.revision }
  })
}
export async function listDay(userId: string, day: string, cursor?: string) {
  validDay(day)
  const rows = await records.findMany({
    where: {
      userId,
      kind: { in: ['transcript', 'recording-feedback', 'recording-gap'] },
      day,
      state: { not: 'deleted' },
      ...(cursor ? { key: { gt: cursor } } : {}),
    },
    orderBy: { key: 'asc' },
    take: 201,
  })
  return {
    items: rows.slice(0, 200).map((r) => ({ ...object(r.payload), kind: r.kind })),
    nextCursor: rows.length > 200 ? rows[199]!.key : null,
  }
}
export async function listDays(userId: string, before?: string) {
  if (before) validDay(before)
  const days = await records.findMany({
    where: {
      userId,
      kind: { in: ['transcript', 'recording-feedback'] },
      state: { not: 'deleted' },
      ...(before ? { day: { lt: before } } : {}),
    },
    distinct: ['day'],
    select: { day: true },
    orderBy: { day: 'desc' },
    take: 31,
  })
  return {
    days: days.slice(0, 30).map((r) => r.day),
    nextBefore: days.length > 30 ? days[29]!.day : null,
  }
}
export async function deleteDay(userId: string, day: string) {
  validDay(day)
  await prisma.$transaction(async (tx) => {
    await tx.personalModuleRecord.upsert({
      where: keyWhere(userId, 'deleted-day', day),
      create: { userId, kind: 'deleted-day', key: day, payload: {} },
      update: {},
    })
    await tx.personalModuleRecord.deleteMany({
      where: {
        userId,
        day,
        kind: {
          in: ['transcript', 'recording-feedback', 'recording-gap', 'english-event', 'reminder-candidate', 'recording-action', 'recording-analyzed', 'recording-diarization', 'summary'],
        },
      },
    })
  })
  return { deleted: true }
}
export async function saveGap(userId: string, input: unknown) {
  const b = object(input),
    key = text(b.key),
    sessionKey = text(b.sessionKey),
    startAt = instant(b.startAt),
    endAt = instant(b.endAt)
  if (endAt < startAt || !(await get(userId, 'recording-session', sessionKey)))
    throw new Error('invalid_gap')
  const day = validDay(b.day)
  if (await get(userId, 'deleted-day', day)) return { deleted: true }
  const old = await get(userId, 'recording-gap', key)
  if (old && old.sessionKey !== sessionKey) throw new Error('identity_conflict')
  return records.upsert({
    where: keyWhere(userId, 'recording-gap', key),
    create: {
      userId,
      kind: 'recording-gap',
      key,
      sessionKey,
      day,
      payload: { key, sessionKey, startAt, endAt, reason: text(b.reason, 200) },
    },
    update: {},
  })
}
export async function saveReminder(userId: string, key: string, input: unknown, expected?: number) {
  text(key)
  const old = await get(userId, 'reminder', key)
  if (old && expected === undefined) return old
  const payload = reminder(input)
  if (old) {
    if (expected === undefined) return old // idempotent create retry
    const result = await records.updateMany({
      where: { id: old.id, revision: expected, state: { not: 'deleted' } },
      data: {
        payload: json(payload),
        dueAt: payload.dueAt === null ? null : new Date(payload.dueAt),
        state: 'active',
        revision: { increment: 1 },
      },
    })
    if (!result.count) throw new Error('revision_conflict')
    return get(userId, 'reminder', key)
  }
  if (expected !== undefined) throw new Error('not_found')
  return records.create({
    data: { userId, kind: 'reminder', key, payload: json(payload), dueAt: payload.dueAt === null ? null : new Date(payload.dueAt) },
  })
}
export async function reminderState(userId: string, key: string, state: string, revision: number) {
  if (!['completed', 'deleted', 'active'].includes(state) || !Number.isSafeInteger(revision))
    throw new Error('invalid_state')
  const old = await get(userId, 'reminder', key)
  if (!old || old.state === 'deleted') throw new Error('not_found')
  const p = object(old.payload)
  const dueAt = state === 'active' ? reminder(p).dueAt : null
  const changed = await records.updateMany({
    where: { id: old.id, revision },
    data: { state, dueAt: dueAt ? new Date(dueAt) : null, revision: { increment: 1 } },
  })
  if (!changed.count) throw new Error('revision_conflict')
  return get(userId, 'reminder', key)
}
export async function preferences(userId: string, input?: JsonObject) {
  const old = object(
    (await get(userId, 'preferences', 'english'))?.payload ?? { enabled: false, intervalMinutes: 5 },
  )
  if (!input) return old
  if (
    typeof input.enabled !== 'boolean' ||
    !Number.isInteger(input.intervalMinutes) ||
    Number(input.intervalMinutes) < 1 ||
    Number(input.intervalMinutes) > 120
  )
    throw new Error('invalid_preferences')
  const next = { ...old, enabled: input.enabled, intervalMinutes: input.intervalMinutes }
  await put(userId, 'preferences', 'english', next)
  return next
}
