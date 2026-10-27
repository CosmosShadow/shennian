// @covers src/services/personal-modules/domain.ts
// @covers src/services/personal-modules/store.ts
// @covers src/services/personal-modules/english.ts
// @covers src/jobs/personal-reminders.ts
// @covers src/services/personal-modules/listening.ts
// Isolated unit tests: no DB, network, real model, push or account data.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { memory, model, sessions } = vi.hoisted(() => {
  const memory = { rows: new Map<string, any>(), id: 0 }
  function matches(row: any, where: any): boolean {
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === 'userId_kind_key') return matches(row, v)
      if (v instanceof Date) return row[k]?.getTime() === v.getTime()
      if (v && typeof v === 'object') {
        return (
          (!v.in || v.in.includes(row[k])) &&
          (!('not' in v) || row[k] !== v.not) &&
          (!v.lte || row[k] <= v.lte) &&
          (!v.lt || row[k] < v.lt) &&
          (!v.gt || row[k] > v.gt)
        )
      }
      return row[k] === v
    })
  }
  const model = {
    findUnique: vi.fn(
      async ({ where }: any) => [...memory.rows.values()].find((r) => matches(r, where)) ?? null,
    ),
    findMany: vi.fn(async ({ where, take }: any) =>
      [...memory.rows.values()].filter((r) => matches(r, where ?? {})).slice(0, take),
    ),
    findFirst: vi.fn(
      async ({ where }: any) => [...memory.rows.values()].find((r) => matches(r, where)) ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      if (
        [...memory.rows.values()].some(
          (r) => r.userId === data.userId && r.kind === data.kind && r.key === data.key,
        )
      )
        throw new Error('unique')
      const row = {
        id: `r${++memory.id}`,
        state: 'active',
        revision: 1,
        dueAt: null,
        createdAt: new Date(),
        ...data,
      }
      memory.rows.set(row.id, row)
      return row
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = [...memory.rows.values()].find((r) => matches(r, where))!
      Object.assign(row, data)
      return row
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = [...memory.rows.values()].filter((r) => matches(r, where))
      for (const row of rows)
        for (const [k, v] of Object.entries(data) as any)
          row[k] = v?.increment ? row[k] + v.increment : v
      return { count: rows.length }
    }),
    upsert: vi.fn(async ({ where, create, update }: any): Promise<any> => {
      const row = await model.findUnique({ where })
      return row
        ? model.update({ where: { id: row.id }, data: update })
        : model.create({ data: create })
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      for (const row of [...memory.rows.values()])
        if (matches(row, where)) memory.rows.delete(row.id)
      return { count: 1 }
    }),
  }
  return { memory, model, sessions: { findFirst: vi.fn(async () => null as any) } }
})
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    personalModuleRecord: model,
    nianSession: sessions,
    $transaction: (run: any) => run({ personalModuleRecord: model }),
  },
}))
vi.mock('../services/push.js', () => ({ sendPushNotification: vi.fn(async () => {}) }))
vi.mock('../services/personal-modules/listening-decision.js', () => ({ decideListeningAnalysis: vi.fn(async () => ({ needsAnalysis: true, provider: 'text_fallback', reason: 'not_configured', elapsedMs: 0 })) }))
vi.mock('../services/personal-modules/model.js', () => ({ completeModuleJson: vi.fn() }))
vi.mock('../services/distributed-lease.js', () => ({
  withDistributedLease: async (input: any) => ({ acquired: true, result: await input.run() }),
}))
import {
  transcript,
  reminder,
  advanceReminder,
  wordInSource,
} from '../services/personal-modules/domain.js'
import {
  startSession,
  saveTranscript,
  get,
  saveReminder,
  reminderState,
  deleteDay,
  preferences,
} from '../services/personal-modules/store.js'
import {
  candidateAction,
  analyzeEnglish,
  englishItems,
} from '../services/personal-modules/english.js'
import { completeModuleJson } from '../services/personal-modules/model.js'
import { sendPushNotification } from '../services/push.js'
import { runPersonalReminders } from '../jobs/personal-reminders.js'
import { analyzeListening, listeningPreferences, listeningActions, listeningAction } from '../services/personal-modules/listening.js'
const sample = {
  key: 'utterance',
  sessionKey: 'session',
  revision: 1,
  text: 'I ate an apple',
  startAt: '2026-10-21T16:00:01Z',
  endAt: '2026-10-21T16:00:05Z',
  timezone: 'Asia/Shanghai',
}
beforeEach(() => {
  memory.rows.clear()
  memory.id = 0
  vi.clearAllMocks()
})
describe('personal records ownership and replay', () => {
  it('uses local day and rejects timezone-free or backwards timestamps', () => {
    expect(transcript(sample).day).toBe('2026-10-22')
    expect(() => transcript({ ...sample, startAt: '2026-10-21T16:00:00' })).toThrow()
    expect(() => transcript({ ...sample, endAt: '2026-10-21T15:00:00Z' })).toThrow()
  })
  it('requires an owned session, keeps revisions monotonic and blocks post-deletion replay', async () => {
    await startSession('alice', { key: 'session', startAt: sample.startAt })
    await expect(saveTranscript('bob', sample)).rejects.toThrow('invalid_session')
    await saveTranscript('alice', sample)
    await saveTranscript('alice', { ...sample, revision: 2, text: 'corrected' })
    await saveTranscript('alice', sample)
    expect((await get('alice', 'transcript', 'utterance'))?.revision).toBe(2)
    await deleteDay('alice', '2026-10-22')
    expect(await saveTranscript('alice', sample)).toEqual({ saved: false, deleted: true })
  })
  it('does not allow a foreign candidate to create a reminder', async () => {
    await model.create({
      data: {
        userId: 'alice',
        kind: 'reminder-candidate',
        key: 'c',
        payload: { content: 'meeting' },
      },
    })
    await expect(candidateAction('bob', 'c', true)).rejects.toThrow('not_found')
  })
})
describe('calendar reminder semantics', () => {
  it('advances one daily item through every clock time and rolls to tomorrow', () => {
    const input = { content: '吃药', when: '每天18:30、09:00、12:30、09:00', timezone: 'Asia/Shanghai' }
    const r = reminder(input, Date.parse('2026-10-25T00:00:00Z'))
    expect(r.rules).toHaveLength(3)
    expect(r.dueAt).toBe(Date.parse('2026-10-25T01:00:00Z'))
    expect(advanceReminder(r, r.dueAt!)).toBe(Date.parse('2026-10-25T04:30:00Z'))
    expect(advanceReminder(r, Date.parse('2026-10-25T04:30:00Z'))).toBe(Date.parse('2026-10-25T10:30:00Z'))
    expect(advanceReminder(r, Date.parse('2026-10-25T10:30:00Z'))).toBe(Date.parse('2026-10-26T01:00:00Z'))
    // Recovery skips elapsed slots, rather than flooding missed notifications.
    expect(advanceReminder(r, Date.parse('2026-10-27T05:00:00Z'))).toBe(Date.parse('2026-10-27T10:30:00Z'))
    for (const when of ['每天09:00、25:00', '每天09:00、12:99', '每天09:00、garbage'])
      expect(() => reminder({ ...input, when })).toThrow()
  })
  it('persists all daily times in one record and delivers each occurrence only once', async () => {
    const row = await saveReminder('alice', 'medicine', { content: '吃药', when: '每天09:00、12:30、18:30', timezone: 'Asia/Shanghai' })
    expect(memory.rows.size).toBe(1)
    const initial = row!.dueAt!.getTime()
    for (let i = 0; i < 3; i++) {
      const due = (await get('alice', 'reminder', 'medicine'))!.dueAt!.getTime()
      await runPersonalReminders(due)
      await runPersonalReminders(due)
    }
    expect(sendPushNotification).toHaveBeenCalledTimes(3)
    expect(memory.rows.size).toBe(1)
    expect((await get('alice', 'reminder', 'medicine'))!.dueAt!.getTime()).toBeGreaterThan(initial)
    const current = (await get('alice', 'reminder', 'medicine'))!
    await reminderState('alice', 'medicine', 'completed', current.revision)
    expect(current.dueAt).toBeNull()
    await reminderState('alice', 'medicine', 'active', current.revision)
    expect(current.dueAt).toBeInstanceOf(Date)
    expect((current.payload as any).rules).toHaveLength(3)
  })
  it('resolves recurring local clock times independently of server timezone', () => {
    const now = Date.parse('2026-10-22T00:00:00Z')
    const r = reminder({ content: 'water', when: '每天09:00', timezone: 'Asia/Shanghai' }, now)
    expect(r.dueAt).toBe(Date.parse('2026-10-22T01:00:00Z'))
    expect(advanceReminder(r, r.dueAt!)).toBe(Date.parse('2026-10-23T01:00:00Z'))
  })
  it('accepts omitted, empty and null time as memos but never downgrades invalid times', () => {
    for (const when of [undefined, '', null]) {
      const memo = reminder({ content: '充值阿里云', when, timezone: 'Asia/Shanghai' })
      expect(memo).toEqual({ content: '充值阿里云', when: '', timezone: 'Asia/Shanghai', rule: null, dueAt: null })
      expect(advanceReminder(memo, Date.now())).toBeNull()
    }
    for (const when of ['garbage', false, 123, '   ']) {
      expect(() => reminder({ content: 'memo', when, timezone: 'Asia/Shanghai' })).toThrow()
    }
    expect(() => reminder({ content: '', timezone: 'Asia/Shanghai' })).toThrow('invalid_text')
    expect(() => reminder({ content: 'memo', timezone: 'invalid/zone' })).toThrow()
  })
  it('creates, retries, completes, restores and deletes memos without scheduling a push', async () => {
    const input = { content: '充值阿里云', timezone: 'Asia/Shanghai' }
    const row = await saveReminder('alice', 'memo', input)
    expect(row).toMatchObject({ dueAt: null, state: 'active', payload: { when: '', rule: null } })
    expect((await saveReminder('alice', 'memo', input))!.revision).toBe(1)
    await runPersonalReminders()
    expect(sendPushNotification).not.toHaveBeenCalled()
    await reminderState('alice', 'memo', 'completed', 1)
    await reminderState('alice', 'memo', 'active', 2)
    expect(await get('alice', 'reminder', 'memo')).toMatchObject({ dueAt: null, state: 'active', revision: 3 })
    await reminderState('alice', 'memo', 'deleted', 3)
    await expect(reminderState('alice', 'memo', 'active', 4)).rejects.toThrow('not_found')
  })
  it('adds and removes time with revision checks, clearing the old scheduled trigger', async () => {
    await saveReminder('alice', 'memo', { content: 'memo', timezone: 'Asia/Shanghai' })
    await saveReminder('alice', 'memo', { content: 'memo', when: '30分钟后', timezone: 'Asia/Shanghai' }, 1)
    expect((await get('alice', 'reminder', 'memo'))!.dueAt).toBeInstanceOf(Date)
    await saveReminder('alice', 'memo', { content: 'memo', when: '', timezone: 'Asia/Shanghai' }, 2)
    expect(await get('alice', 'reminder', 'memo')).toMatchObject({ dueAt: null, revision: 3, payload: { rule: null } })
    await runPersonalReminders(Date.now() + 3600000)
    expect(sendPushNotification).not.toHaveBeenCalled()
  })
  it('uses optimistic updates and prevents a deleted reminder from returning', async () => {
    await saveReminder('alice', 'r', {
      content: 'water',
      when: '30分钟后',
      timezone: 'Asia/Shanghai',
    })
    await expect(reminderState('bob', 'r', 'deleted', 1)).rejects.toThrow('not_found')
    await reminderState('alice', 'r', 'completed', 1)
    await expect(reminderState('alice', 'r', 'active', 1)).rejects.toThrow('revision_conflict')
    await reminderState('alice', 'r', 'deleted', 2)
    await expect(reminderState('alice', 'r', 'active', 3)).rejects.toThrow('not_found')
  })
  it('claims a due occurrence once across repeated worker ticks', async () => {
    const r = await saveReminder('alice', 'r', {
      content: 'water',
      when: '30分钟后',
      timezone: 'Asia/Shanghai',
    })
    const now = r!.dueAt!.getTime() + 1
    await runPersonalReminders(now)
    await runPersonalReminders(now)
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
  })
})
describe('English evidence validation', () => {
  it('does not count a substring or injected regex as an English use', () => {
    expect(wordInSource('he', 'the apple')).toBe(false)
    expect(wordInSource('apple', sample.text)).toBe(true)
  })
  it('only accepts vocabulary actually present in a current owned transcript', async () => {
    await startSession('alice', { key: 'session', startAt: sample.startAt })
    await saveTranscript('alice', sample)
    vi.mocked(completeModuleJson).mockResolvedValue({
      events: [
        { word: 'apple', sourceKey: sample.key, revision: 1, event: 'self' },
        { word: 'banana', sourceKey: sample.key, revision: 1, event: 'self' },
        { word: 'ate', sourceKey: sample.key, revision: 99, event: 'mastered' },
      ],
      prompt: null,
    })
    await analyzeEnglish('alice')
    const result = await englishItems('alice')
    expect(result.items.map((x) => [x.word, x.selfUseCount])).toEqual([['apple', 1]])
    expect((await englishItems('bob')).items).toEqual([])
    await saveTranscript('alice', { ...sample, revision: 2, text: 'corrected' })
    expect((await englishItems('alice')).items).toEqual([])
  })
})

describe('listening inference and confirmed actions', () => {
  it('starts English disabled and preserves a saved opt-in', async () => {
    expect(await preferences('alice')).toEqual({ enabled: false, intervalMinutes: 5 })
    await preferences('alice', { enabled: true, intervalMinutes: 5 })
    expect(await preferences('alice')).toEqual({ enabled: true, intervalMinutes: 5 })
  })
  async function setup() {
    const endAt = new Date(Date.now() - 1000).toISOString()
    const current = { ...sample, startAt: endAt, endAt, text: '神念，明天下午提醒我开会' }
    await startSession('alice', { key: 'session', startAt: endAt })
    await saveTranscript('alice', current)
    await listeningPreferences('alice', { mode: 'assist', feedback: 'balanced', agentContext: false })
    return current
  }
  const output = (type = 'reminder_create') => ({ actions: [{ type, content: '开会', sourceKey: 'utterance', sourceRevision: 1, eventTime: new Date(Date.now() + 3600000).toISOString() }] })
  it('does not invoke a model in transcribe mode or when there is no new text', async () => {
    await listeningPreferences('alice', { mode: 'transcribe', feedback: 'silent', agentContext: false })
    expect((await analyzeListening('alice', {})).status).toBe('disabled')
    await listeningPreferences('alice', { mode: 'assist', feedback: 'silent', agentContext: false })
    await startSession('alice', { key: 'empty', startAt: new Date().toISOString() })
    expect((await analyzeListening('alice', { sessionKey: 'empty' })).status).toBe('no_pending_text')
    expect(completeModuleJson).not.toHaveBeenCalled()
  })
  it('creates no side effects until confirmation, then creates exactly one reminder', async () => {
    await setup(); vi.mocked(completeModuleJson).mockResolvedValue(output())
    expect((await analyzeListening('alice', { sessionKey: 'session', context: { messages: ['ignored'] } })).count).toBe(1)
    expect(vi.mocked(completeModuleJson).mock.calls[0]?.[1]).toMatchObject({ agentContext: null })
    expect(vi.mocked(completeModuleJson).mock.calls[0]?.[2]).toEqual({ maxTokens: 700 })
    expect([...memory.rows.values()].filter(r => r.kind === 'reminder')).toHaveLength(0)
    const [action] = (await listeningActions('alice')).items
    await expect(listeningAction('bob', action!.key, true)).rejects.toThrow('not_found')
    await listeningAction('alice', action!.key, true); await listeningAction('alice', action!.key, true)
    expect([...memory.rows.values()].filter(r => r.kind === 'reminder')).toHaveLength(1)
    await model.deleteMany({ where: { userId: 'alice', kind: 'analysis-clock' } })
    expect((await analyzeListening('alice', { sessionKey: 'session' })).status).toBe('no_pending_text')
    expect(completeModuleJson).toHaveBeenCalledTimes(1)
  })
  it('keeps a committed action idempotent when ASR appends a new revision', async () => {
    const current = await setup(), value = output()
    vi.mocked(completeModuleJson).mockResolvedValue(value)
    await analyzeListening('alice', { sessionKey: 'session' })
    const [action] = (await listeningActions('alice')).items
    await listeningAction('alice', action!.key, true)
    await saveTranscript('alice', { ...current, revision: 2, text: current.text + '。谢谢。' })
    await model.deleteMany({ where: { userId: 'alice', kind: 'analysis-clock' } })
    vi.mocked(completeModuleJson).mockResolvedValue({ actions: [{ ...value.actions[0], sourceRevision: 2 }] })
    await analyzeListening('alice', { sessionKey: 'session' })
    expect((await listeningActions('alice')).items).toHaveLength(0)
    expect([...memory.rows.values()].filter(r => r.kind === 'reminder')).toHaveLength(1)
  })
  it('rejects hallucinated evidence and revokes results when settings change during inference', async () => {
    await setup()
    vi.mocked(completeModuleJson).mockResolvedValue({ actions: [{ ...output().actions[0], sourceRevision: 99 }] })
    expect((await analyzeListening('alice', { sessionKey: 'session' })).count).toBe(0)
    await model.deleteMany({ where: { userId: 'alice', kind: 'analysis-clock' } })
    await model.deleteMany({ where: { userId: 'alice', kind: 'recording-analyzed' } })
    vi.mocked(completeModuleJson).mockImplementationOnce(async () => {
      await listeningPreferences('alice', { mode: 'transcribe', feedback: 'silent', agentContext: false })
      return output()
    })
    expect((await analyzeListening('alice', { sessionKey: 'session' })).status).toBe('settings_changed')
    expect((await listeningActions('alice')).items).toHaveLength(0)
  })
  it('invalidates pending actions when the source is revised or its day is deleted', async () => {
    const current = await setup(); vi.mocked(completeModuleJson).mockResolvedValue(output())
    await analyzeListening('alice', { sessionKey: 'session' })
    const [action] = (await listeningActions('alice')).items
    await saveTranscript('alice', { ...current, revision: 2, text: '不用提醒了' })
    await expect(listeningAction('alice', action!.key, true)).rejects.toThrow('not_found')
    await model.create({ data: { userId: 'alice', kind: 'recording-action', key: 'manual', sessionKey: 'utterance', day: transcript(current).day, payload: { ...output().actions[0], sourceRevision: 2, expiresAt: new Date(Date.now() + 60000).toISOString() } } })
    const source = await get('alice', 'transcript', 'utterance')
    await deleteDay('alice', source!.day!)
    expect((await listeningActions('alice')).items).toHaveLength(0)
  })
  it('prepares an Agent task draft without claiming it was sent or executed', async () => {
    await setup(); vi.mocked(completeModuleJson).mockResolvedValue(output('agent_task'))
    await analyzeListening('alice', { sessionKey: 'session' })
    const [action] = (await listeningActions('alice')).items
    await expect(listeningAction('alice', action!.key, true)).resolves.toMatchObject({ saved: false, status: 'draft_only', draft: '开会' })
    expect((await get('alice', 'recording-action', action!.key))!.state).toBe('active')
    expect([...memory.rows.values()].filter(r => r.kind === 'reminder')).toHaveLength(0)
    await listeningAction('alice', action!.key, false)
    expect((await listeningActions('alice')).items).toHaveLength(0)
  })
  it('references only an opted-in owned primary-machine conversation and bounds its text', async () => {
    await setup()
    await listeningPreferences('alice', { mode: 'assist', feedback: 'silent', agentContext: true })
    await model.create({ data: { userId: 'alice', kind: 'personal-agent', key: 'primary-machine', payload: { machineId: 'primary' } } })
    sessions.findFirst.mockResolvedValueOnce({ id: 'owned-steward' })
    vi.mocked(completeModuleJson).mockResolvedValue({ actions: [] })
    await analyzeListening('alice', { sessionKey: 'session', context: { sessionId: 'owned-steward', messages: Array.from({ length: 10 }, () => ({ role: 'user', text: 'x'.repeat(2000), ts: Date.now() })) } })
    expect(sessions.findFirst).toHaveBeenCalledWith({ where: { id: 'owned-steward', userId: 'alice', machineId: 'primary', sessionScope: 'steward', deletedAt: null }, select: { id: true } })
    const input = vi.mocked(completeModuleJson).mock.calls[0]?.[1] as any
    expect(input.agentContext.messages.map((m: any) => m.text).join('').length).toBe(2400)
    await model.deleteMany({ where: { userId: 'alice', kind: 'analysis-clock' } })
    await model.deleteMany({ where: { userId: 'alice', kind: 'recording-analyzed' } })
    sessions.findFirst.mockResolvedValueOnce(null)
    await analyzeListening('alice', { sessionKey: 'session', context: { sessionId: 'foreign', messages: [{ role: 'user', text: 'private', ts: Date.now() }] } })
    expect(vi.mocked(completeModuleJson).mock.calls[1]?.[1]).toMatchObject({ agentContext: null })
  })
  it('refuses a stale target version without changing the target reminder', async () => {
    await setup(); await saveReminder('alice', 'r', { content: '原会议', when: '30分钟后', timezone: 'Asia/Shanghai' })
    vi.mocked(completeModuleJson).mockResolvedValue({ actions: [{ ...output('reminder_cancel').actions[0], targetKey: 'r', targetRevision: 1 }] })
    await analyzeListening('alice', { sessionKey: 'session' })
    const [action] = (await listeningActions('alice')).items
    await reminderState('alice', 'r', 'completed', 1)
    await expect(listeningAction('alice', action!.key, true)).rejects.toThrow('revision_conflict')
    expect((await get('alice', 'reminder', 'r'))!.state).toBe('completed')
    expect((await get('alice', 'recording-action', action!.key))!.state).toBe('active')
  })
  it('sends natural and homophonic calls to semantic analysis, never treating a name as permission', async () => {
    const current = await setup()
    await listeningPreferences('alice', { mode: 'assist', feedback: 'silent', agentContext: false, trigger: 'name' })
    await saveTranscript('alice', { ...current, revision: 2, text: '我明天需要交报告，帮我安排一下' })
    vi.mocked(completeModuleJson).mockResolvedValue({ actions: [] })
    expect((await analyzeListening('alice', { sessionKey: 'session' })).count).toBe(0)
    expect(completeModuleJson).toHaveBeenCalledTimes(1)
    expect(vi.mocked(completeModuleJson).mock.calls[0]?.[1]).toMatchObject({ policy: { trigger: 'name' }, pending: [expect.objectContaining({ text: '我明天需要交报告，帮我安排一下' })] })
    await model.deleteMany({ where: { userId: 'alice', kind: 'analysis-clock' } })
    await saveTranscript('alice', { ...current, revision: 3, text: '哎，沈念，帮我安排交报告的提醒' })
    vi.mocked(completeModuleJson).mockResolvedValue({ actions: [{ ...output().actions[0], sourceRevision: 3 }] })
    expect((await analyzeListening('alice', { sessionKey: 'session' })).count).toBe(1)
    expect([...memory.rows.values()].filter(r => r.kind === 'reminder')).toHaveLength(0)
  })
  it('uses exact target revisions for schedule edits and cancellation', async () => {
    await setup(); const target = await saveReminder('alice', 'r', { content: '原会议', when: '30分钟后', timezone: 'Asia/Shanghai' })
    vi.mocked(completeModuleJson).mockResolvedValue({ actions: [{ ...output('reminder_cancel').actions[0], targetKey: 'r', targetRevision: target!.revision }] })
    await analyzeListening('alice', { sessionKey: 'session' })
    const [action] = (await listeningActions('alice')).items
    await listeningAction('alice', action!.key, true)
    expect((await get('alice', 'reminder', 'r'))!.state).toBe('deleted')
    await listeningAction('alice', action!.key, true)
    expect((await get('alice', 'reminder', 'r'))!.revision).toBe(2)
  })
})

// @covers src/services/personal-modules/speech.ts
import { recordingSpeech, speechPcm, synthesizeSpeech } from '../services/personal-modules/speech.js'
function unitSpeechWav() {
  const wav = Buffer.alloc(48)
  wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVE', 8)
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24)
  wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(4, 40); wav.writeInt16LE(123, 44)
  return wav
}
describe('Aliyun recording feedback speech', () => {
  it('validates mono PCM WAV and refuses corrupt or unsupported output', () => {
    expect(speechPcm(unitSpeechWav())).toEqual({ sampleRate: 24000, pcmBase64: unitSpeechWav().subarray(44).toString('base64') })
    const streaming = unitSpeechWav(); streaming.writeUInt32LE(0x7fffffbf, 4); streaming.writeUInt32LE(0x7fffff9b, 40)
    expect(speechPcm(streaming)).toEqual(speechPcm(unitSpeechWav()))
    const stereo = unitSpeechWav(); stereo.writeUInt16LE(2, 22)
    expect(() => speechPcm(stereo)).toThrow('speech_invalid_audio')
    expect(() => speechPcm(unitSpeechWav().subarray(0, 46))).toThrow('speech_invalid_audio')
  })
  it('uses Qwen Cherry with Auto for mixed English teaching and downloads only trusted audio', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'unit-speech-key')
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ output: { audio: { url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/unit.wav' } } })))
      .mockResolvedValueOnce(new Response(unitSpeechWav()))
    vi.stubGlobal('fetch', fetcher)
    try {
      expect((await synthesizeSpeech('苹果就是 apple。', 'Auto')).sampleRate).toBe(24000)
      expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ model: 'qwen3-tts-flash', input: { text: '苹果就是 apple。', voice: 'Cherry', language_type: 'Auto' } })
      expect(String(fetcher.mock.calls[1]![0])).toBe('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/unit.wav')
      expect(fetcher.mock.calls[1]![1].redirect).toBe('error')
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
  })
  it('never downloads a provider response pointing to an arbitrary host', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'unit-speech-key')
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: { audio: { url: 'https://127.0.0.1/private' } } })))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(synthesizeSpeech('你好。', 'Chinese')).rejects.toThrow('speech_invalid_audio')
      expect(fetcher).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
  })
  it('cannot synthesize another account prompt or accept arbitrary notification text', async () => {
    await expect(recordingSpeech('unit-other-account', { promptKey: 'private-prompt' })).rejects.toThrow('prompt_expired')
    await expect(recordingSpeech('unit-account', { text: 'arbitrary private body' })).rejects.toThrow('invalid_speech_request')
  })
})

import { saveRecordingFeedback, listDay, listDays } from '../services/personal-modules/store.js'
it('stores AI feedback separately from human speech, without learning from it or executing it', async () => {
  await startSession('alice', { key: 'session', startAt: sample.startAt })
  await expect(saveRecordingFeedback('bob', sample)).rejects.toThrow('invalid_session')
  await saveRecordingFeedback('alice', { ...sample, text: 'apple。提醒我明天开会。' })
  const row = await get('alice', 'recording-feedback', sample.key)
  expect(row?.payload).toMatchObject({ speaker: 'assistant', text: 'apple。提醒我明天开会。' })
  expect(await get('alice', 'transcript', sample.key)).toBeNull()
  expect((await listDay('alice', '2026-10-22')).items[0]).toMatchObject({ kind: 'recording-feedback', speaker: 'assistant' })
  expect((await listDays('alice')).days).toContain('2026-10-22')
  await preferences('alice', { enabled: true, intervalMinutes: 5 })
  expect((await analyzeEnglish('alice')).status).toBe('no_pending_text')
  expect((await analyzeListening('alice', { sessionKey: 'session' })).status).toBe('no_pending_text')
  await deleteDay('alice', '2026-10-22')
  expect(await saveRecordingFeedback('alice', sample)).toEqual({ saved: false, deleted: true })
})
it('accepts the bounded five-minute continuous recognition window, but not unbounded intervals', () => {
  const start = Date.parse(sample.startAt)
  expect(transcript({ ...sample, endAt: new Date(start + 300000).toISOString() }).endAt).toBe(new Date(start + 300000).toISOString())
  expect(() => transcript({ ...sample, endAt: new Date(start + 360001).toISOString() })).toThrow('invalid_interval')
})
