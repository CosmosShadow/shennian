// @covers src/services/personal-modules/listening-policy.ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LISTENING,
  listeningPreferencesValue,
  listeningProposal,
  hasListeningWakeWord,
} from '../services/personal-modules/listening-policy.js'
const now = Date.parse('2026-10-23T12:00:00Z')
const sources = [
  {
    key: 's',
    revision: 2,
    payload: {
      text: '把明天的会取消',
      endAt: new Date(now - 1000).toISOString(),
      timezone: 'Asia/Shanghai',
    },
  },
]
const reminders = [
  { key: 'r', revision: 3, state: 'active', payload: { content: '原会议', when: '每天09:00' } },
]
const raw = {
  type: 'reminder_cancel',
  content: '取消会议',
  sourceKey: 's',
  sourceRevision: 2,
  targetKey: 'r',
  targetRevision: 3,
}
describe('listening bounded decisions', () => {
  it('defaults to assistance with balanced speech and no conversation upload', () => {
    expect(DEFAULT_LISTENING).toEqual({
      mode: 'assist',
      feedback: 'balanced',
      agentContext: false,
      trigger: 'contextual',
    })
    expect(listeningPreferencesValue({ ...DEFAULT_LISTENING, feedback: 'active' })).toEqual({
      ...DEFAULT_LISTENING,
      feedback: 'active',
    })
    expect(() =>
      listeningPreferencesValue({ ...DEFAULT_LISTENING, mode: 'execute_everything' }),
    ).toThrow()
    expect(() =>
      listeningPreferencesValue({ ...DEFAULT_LISTENING, agentContext: 'true' }),
    ).toThrow()
  })
  it('binds candidates to exact source and target versions, with actual target text', () => {
    expect(listeningProposal(raw, sources, reminders, now)).toMatchObject({
      sourceRevision: 2,
      targetRevision: 3,
      targetContent: '原会议',
      targetWhen: '每天09:00',
    })
    for (const patch of [
      { sourceKey: 'other' },
      { sourceRevision: 1 },
      { targetKey: 'other' },
      { targetRevision: 1 },
      { type: 'shell' },
    ])
      expect(() => listeningProposal({ ...raw, ...patch }, sources, reminders, now)).toThrow()
  })
  it('rejects stale, malformed, future sources, missing targets and past schedules', () => {
    for (const endAt of [
      'bad',
      new Date(now - 600001).toISOString(),
      new Date(now + 60000).toISOString(),
    ])
      expect(() =>
        listeningProposal(
          raw,
          [{ ...sources[0]!, payload: { ...sources[0]!.payload, endAt } }],
          reminders,
          now,
        ),
      ).toThrow()
    expect(() =>
      listeningProposal(raw, sources, [{ ...reminders[0]!, state: 'deleted' }], now),
    ).toThrow()
    expect(() =>
      listeningProposal(
        { ...raw, type: 'reminder_create', eventTime: new Date(now - 1).toISOString() },
        sources,
        reminders,
        now,
      ),
    ).toThrow()
    expect(() =>
      listeningProposal(
        { ...raw, type: 'agent_task', content: 'x'.repeat(1001) },
        sources,
        reminders,
        now,
      ),
    ).toThrow()
  })
})

describe('ASR text addressing hints', () => {
  it('accepts direct calls and constrained homophones, not ordinary mentions or quotations', () => {
    for (const value of [
      '神念，帮我记一下',
      '神念帮我安排',
      '哎，沈念，帮我处理一下',
      '喂，深念，提醒我',
      '嘿，神剑，提醒我',
      '说完了。神念：取消明天的会',
    ])
      expect(hasListeningWakeWord(value)).toBe(true)
    for (const value of [
      '这个神念产品很好',
      '他对神念说取消',
      '他说“神念，取消”',
      '神剑这个词是什么意思',
    ])
      expect(hasListeningWakeWord(value)).toBe(false)
  })
})

it('ignores the removed speaker switch in legacy saved preferences', () => {
  for (const separateSpeakers of [true, false])
    expect(listeningPreferencesValue({ ...DEFAULT_LISTENING, separateSpeakers })).toEqual(DEFAULT_LISTENING)
})
