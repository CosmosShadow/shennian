import AsyncStorage from '@react-native-async-storage/async-storage'
// @covers packages/app/src/features/steward/stewardModel.ts
// @covers packages/app/src/features/steward/stewardStorage.ts

import type { ChatMessage } from '@shennian/shared'
import type { Machine, NianSession } from '@shennian/wire'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    removeItem: vi.fn(async (key: string) => { store.delete(key) }),
  },
}))

import {
  STEWARD_WORKDIR,
  buildStewardPrelude,
  currentStewardSession,
  stewardSwitchMessages,
  withStewardSwitchMarks,
  stewardDividerLabel,
  hasStewardSessionUnread,
  paintedStewardReadSession,
  machineHasStewardUnread,
  unreadStewardSessionsOnMachine,
  machineSupportsSteward,
  newerStewardSession,
  resolveStewardAgent,
  resolveStewardMachine,
  stewardAgentChoices,
  stewardHistory,
  stewardMachines,
  stewardReadWatermark,
  stewardUnreadMachineIds,
  stewardTitle,
  visibleStewardMessages,
  withStewardIntro,
} from '../features/steward/stewardModel'
import {
  appendStewardSwitchMark,
  clearStewardPreferences,
  pruneStewardSwitchMarks,
  readStewardPreferences,
  readStewardSwitchMarks,
  writeStewardPreferences,
} from '../features/steward/stewardStorage'

const machine = (patch: Partial<Machine>): Machine => ({
  id: 'm1', name: 'Mac', os: 'darwin', agentList: ['claude'], paired: true, online: true, lastSeen: '', ...patch,
})
const message = (patch: Partial<ChatMessage>): ChatMessage => ({ id: 'x', role: 'agent', ts: 1, content: '', ...patch })

beforeEach(() => store.clear())

describe('steward message-style filtering', () => {
  it('keeps the user, steward messages and approval cards, and drops working output', () => {
    const shown = visibleStewardMessages([
      message({ id: 'u', role: 'user', content: '帮我看看' }),
      message({ id: 'text', content: 'Agent 的内部说明' }),
      message({ id: 'tool', toolCalls: [{ name: 'shell' } as never] }),
      message({ id: 'say', content: '收到', steward: 'say' }),
      message({ id: 'fb', content: '最后输出', steward: 'fallback' }),
      message({ id: 'ap', content: '需要确认', approval: { v: 1, type: 'approval_pending', title: 't', content: 'c' } }),
      // The copy re-queued when the steward moved to another AI tool would repeat the user's bubble.
      message({ id: 'steward-failover-user-sess_x', role: 'user', content: '帮我看看' }),
    ])
    expect(shown.map((item) => item.id)).toEqual(['u', 'say', 'fb', 'ap'])
  })

  it('opens an empty conversation with the introduction, and only then', () => {
    const intro = withStewardIntro([], '我是神念管家', 123)
    expect(intro).toEqual([{ id: 'steward-intro', role: 'agent', ts: 123, content: '我是神念管家', steward: 'say' }])
    const existing = [message({ id: 'u', role: 'user' })]
    expect(withStewardIntro(existing, '我是神念管家')).toBe(existing)
    expect(withStewardIntro([], undefined)).toEqual([])
  })
})

describe('steward machine and tool choice', () => {
  it('offers only the Owner\'s paired machines and prefers the remembered, then an online one', () => {
    const machines = [
      machine({ id: 'shared', role: 'granted' }),
      machine({ id: 'unpaired', paired: false }),
      machine({ id: 'off', online: false }),
      machine({ id: 'on' }),
    ]
    expect(stewardMachines(machines).map((item) => item.id)).toEqual(['on', 'off'])
    expect(resolveStewardMachine(machines, 'off')?.id).toBe('off')
    expect(resolveStewardMachine(machines, 'gone')?.id).toBe('on')
    expect(resolveStewardMachine(machines.slice(0, 2), null)).toBeNull()
  })

  it('orders the switcher the same way every time: online first, then by name', () => {
    const machines = [
      machine({ id: 'c', name: 'win', online: false }),
      machine({ id: 'a', name: 'zed' }),
      machine({ id: 'b', name: 'air' }),
      machine({ id: 'd', name: 'air', online: false }),
    ]
    expect(stewardMachines(machines).map((item) => item.id)).toEqual(['b', 'a', 'd', 'c'])
    // Reordering the input (a heartbeat, an activity update) does not reorder the list.
    expect(stewardMachines([...machines].reverse()).map((item) => item.id)).toEqual(['b', 'a', 'd', 'c'])
  })

  it('requires the bundled runtime, never falls back to user-installed tools', () => {
    const detailed = machine({
      agentList: ['claude', 'codex', 'manager'],
      agents: [
        { type: 'claude', models: [] },
        { type: 'codex', models: [], supportsStandardSession: false },
        { type: 'manager', models: [] },
        { type: 'opencode', models: [] },
      ] as never,
    })
    expect(stewardAgentChoices(detailed)).toEqual([])
    expect(stewardAgentChoices(machine({ agentList: ['shennian', 'codex'] }))).toEqual(['shennian'])
    expect(stewardAgentChoices(machine({ agentList: ['codex', 'pi', 'claude'] }))).toEqual([])
    expect(stewardAgentChoices(null)).toEqual([])
    expect(resolveStewardAgent(detailed, 'opencode')).toBeNull()
    expect(resolveStewardAgent(machine({ agentList: ['shennian', 'codex'] }), 'codex')).toBe('shennian')
    expect(resolveStewardAgent(machine({ agentList: [] }), 'claude')).toBeNull()
  })
})

describe('steward client version gate', () => {
  it('needs a Client that understands steward sessions; unknown versions get the benefit of the doubt', () => {
    expect(machineSupportsSteward(machine({ cliVersion: '0.5.14' }))).toBe(false)
    expect(machineSupportsSteward(machine({ cliVersion: '0.5.15' }))).toBe(true)
    expect(machineSupportsSteward(machine({ cliVersion: '0.5.15-preview.1' }))).toBe(true)
    expect(machineSupportsSteward(machine({ cliVersion: '0.6.0' }))).toBe(true)
    expect(machineSupportsSteward(machine({ cliVersion: '0.10.0' }))).toBe(true)
    expect(machineSupportsSteward(machine({ cliVersion: '0.4.99' }))).toBe(false)
    expect(machineSupportsSteward(machine({ cliVersion: undefined }))).toBe(true)
    expect(machineSupportsSteward(null)).toBe(true)
  })

  it('prefers an online machine that can host the steward', () => {
    const machines = [
      machine({ id: 'old', cliVersion: '0.5.14' }),
      machine({ id: 'new', cliVersion: '0.5.15' }),
    ]
    expect(resolveStewardMachine(machines, null)?.id).toBe('new')
    expect(resolveStewardMachine(machines, 'old')?.id).toBe('old')
  })
})

describe('steward title and history', () => {
  it('shows the machine name in the title and shortens a long one in the middle', () => {
    expect(stewardTitle('神念管家', 'test_mac')).toBe('神念管家（test_mac）')
    expect(stewardTitle('神念管家', '  ')).toBe('神念管家')
    expect(stewardTitle('神念管家', undefined)).toBe('神念管家')
    const long = stewardTitle('神念管家', 'a-very-long-machine-name-that-keeps-going')
    expect(long).toMatch(/^神念管家（.{4,14}…?.*）$/)
    expect([...long.slice(5, -1)].length).toBeLessThanOrEqual(14)
    expect(long).toContain('…')
  })

  it('lists only steward sessions, newest first', () => {
    const session = (id: string, at: string, patch: Partial<NianSession> = {}) => ({
      id, lastActivityAt: at, sessionScope: 'steward', ...patch,
    }) as NianSession
    const history = stewardHistory([
      session('old', '2026-09-28T00:00:00.000Z'),
      session('new', '2026-09-29T00:00:00.000Z'),
      session('plain', '2026-09-30T00:00:00.000Z', { sessionScope: undefined }),
      session('gone', '2026-09-30T00:00:00.000Z', { deletedAt: '2026-09-30T01:00:00.000Z' }),
    ])
    expect(history.map((item) => item.id)).toEqual(['new', 'old'])
  })

  it('scopes the history to one machine when asked', () => {
    const session = (id: string, machineId: string) => ({
      id, machineId, lastActivityAt: '2026-09-29T00:00:00.000Z', sessionScope: 'steward',
    }) as NianSession
    const list = [session('a', 'm1'), session('b', 'm2')]
    expect(stewardHistory(list, 'm1').map((item) => item.id)).toEqual(['a'])
    expect(stewardHistory(list).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('opens one conversation per machine: the remembered one on that machine, else its latest', () => {
    const session = (id: string, machineId: string, at: string, patch: Partial<NianSession> = {}) => ({
      id, machineId, lastActivityAt: at, sessionScope: 'steward', ...patch,
    }) as NianSession
    const list = [
      session('mac-old', 'm1', '2026-09-28T00:00:00.000Z'),
      session('mac-new', 'm1', '2026-09-30T00:00:00.000Z'),
      session('win', 'm2', '2026-09-29T00:00:00.000Z'),
      session('mac-terminal', 'm1', '2026-10-01T00:00:00.000Z', { title: '来自终端' }),
      session('mac-gone', 'm1', '2026-10-01T00:00:00.000Z', { deletedAt: '2026-10-01T01:00:00.000Z' }),
    ]
    // Switching machines never carries the other machine's conversation over.
    expect(currentStewardSession(list, 'm1', 'win')?.id).toBe('mac-new')
    expect(currentStewardSession(list, 'm2', 'win')?.id).toBe('win')
    // An earlier conversation the user opened from the history list stays open.
    expect(currentStewardSession(list, 'm1', 'mac-old')?.id).toBe('mac-old')
    expect(currentStewardSession(list, 'm3')).toBeUndefined()
    expect(currentStewardSession(list, undefined, 'mac-old')).toBeUndefined()
  })

  it('uses a placeholder directory the daemon replaces with its fixed workspace', () => {
    expect(STEWARD_WORKDIR).toBe('~/shennian-agent')
  })

  it('reads unread off the raw attention fields, ignoring the internal-session exclusion the shared helper applies', () => {
    type Attention = Pick<NianSession, 'attentionCount' | 'userState'>
    const read = { attentionCount: 3, userState: { lastReadAttentionCount: 3 } } as Attention
    const unread = { attentionCount: 3, userState: { lastReadAttentionCount: 1 } } as Attention
    const noState = { attentionCount: 2 } as Attention
    expect(hasStewardSessionUnread(read)).toBe(false)
    expect(hasStewardSessionUnread(unread)).toBe(true)
    expect(hasStewardSessionUnread(noState)).toBe(true)
  })

  it('submits the conversation\'s own index as the read watermark, and nothing when there is nothing new', () => {
    const base = {
      bodyRevision: 12, visibleMessageCount: 9, lastVisibleMessageId: 'msg-9',
      attentionCount: 3, lastAttentionId: 'msg-9',
    } as NianSession
    expect(stewardReadWatermark(base)).toEqual({
      bodyRevision: 12, visibleMessageCount: 9, lastVisibleMessageId: 'msg-9',
      attentionCount: 3, lastAttentionId: 'msg-9',
    })
    expect(stewardReadWatermark({ ...base, userState: { lastReadAttentionCount: 3 } } as NianSession)).toBeUndefined()
    expect(stewardReadWatermark({ ...base, localCreationState: 'draft' } as NianSession)).toBeUndefined()
    expect(stewardReadWatermark(undefined)).toBeUndefined()
    expect(stewardReadWatermark({} as NianSession)).toBeUndefined()
  })

  it('acks a refreshed attention index only when the same body was already painted', () => {
    const presented = { id: 'current', bodyRevision: 12, attentionCount: 2, lastAttentionId: 'a2' } as NianSession
    const finished = { ...presented, attentionCount: 3, lastAttentionId: 'terminal:run-3' } as NianSession
    expect(paintedStewardReadSession(presented, finished)).toBe(finished)
    expect(stewardReadWatermark(paintedStewardReadSession(presented, finished))?.attentionCount).toBe(3)
    expect(paintedStewardReadSession(presented, { ...finished, bodyRevision: 13 })).toBe(presented)
    expect(paintedStewardReadSession(presented, { ...finished, id: 'other' })).toBe(presented)
  })

  it('flags a machine as unread only from its own steward sessions', () => {
    const session = (id: string, machineId: string, patch: Partial<NianSession> = {}) => ({
      id, machineId, sessionScope: 'steward', attentionCount: 2, userState: { lastReadAttentionCount: 0 }, ...patch,
    }) as NianSession
    const sessions = [
      session('a', 'm1'),
      session('b', 'm2', { attentionCount: 1, userState: { lastReadAttentionCount: 1 } } as Partial<NianSession>),
      session('c', 'm3', { sessionScope: undefined }),
      session('d', 'm4', { deletedAt: '2026-09-30T00:00:00.000Z' }),
    ]
    expect(machineHasStewardUnread(sessions, 'm1')).toBe(true)
    expect(machineHasStewardUnread(sessions, 'm2')).toBe(false)
    expect(machineHasStewardUnread(sessions, 'm3')).toBe(false)
    expect(machineHasStewardUnread(sessions, 'm4')).toBe(false)
  })

  it('only shows an entry dot for unread conversations on machines the owner can open', () => {
    const session = (machineId: string) => ({
      id: `session-${machineId}`, machineId, sessionScope: 'steward',
      attentionCount: 1, userState: { lastReadAttentionCount: 0 },
    }) as NianSession
    const machines = [
      machine({ id: 'paired' }),
      machine({ id: 'unpaired', paired: false }),
      machine({ id: 'granted', role: 'granted' }),
    ]
    expect(stewardUnreadMachineIds([
      session('unpaired'), session('granted'), session('missing'),
    ], machines)).toEqual([])
    expect(stewardUnreadMachineIds([
      session('paired'), session('unpaired'), session('granted'),
    ], machines)).toEqual(['paired'])
  })

  it('clears the same machine-wide scope that creates the dot, including older and terminal conversations', () => {
    const session = (id: string, machineId: string, patch: Partial<NianSession> = {}) => ({
      id, machineId, sessionScope: 'steward', attentionCount: 2,
      userState: { lastReadAttentionCount: 0 }, ...patch,
    }) as NianSession
    const sessions = [
      session('current', 'mac'),
      session('old', 'mac'),
      session('terminal', 'mac', { title: '来自终端' }),
      session('read', 'mac', { userState: { lastReadAttentionCount: 2 } } as Partial<NianSession>),
      session('other', 'test_mac'),
      session('deleted', 'mac', { deletedAt: '2026-10-02T00:00:00Z' }),
      session('internal', 'mac', { sessionScope: undefined }),
    ]
    expect(unreadStewardSessionsOnMachine(sessions, 'mac').map((item) => item.id))
      .toEqual(['current', 'old', 'terminal'])
    expect(machineHasStewardUnread(sessions, 'test_mac')).toBe(true)
  })
})

describe('steward timeline', () => {
  const session = (id: string, at: string, patch: Partial<NianSession> = {}) => ({
    id, createdAt: at, lastActivityAt: at, sessionScope: 'steward',
    machineId: 'm1', agentType: 'claude', modelId: null, ...patch,
  }) as NianSession
  const names = {
    machine: (item: NianSession) => `机器${item.machineId}`,
    agent: (item: NianSession) => `AI ${item.agentType}`,
    model: (item: NianSession) => `模型${item.modelId}`,
    newConversation: '新对话',
    switchTo: (name: string) => `切换到 ${name}`,
  }
  const say = (id: string, ts: number): ChatMessage => message({ id, ts, content: id, steward: 'say' })

  it('follows a newer conversation the machine opened, but never leaves a draft or picks the terminal one', () => {
    const current = session('a', '2026-09-29T01:00:00.000Z')
    const list = [
      current,
      session('other-machine', '2026-09-29T03:00:00.000Z', { machineId: 'm2' }),
      session('terminal', '2026-09-29T04:00:00.000Z', { title: '来自终端' }),
      session('switched', '2026-09-29T02:00:00.000Z', { agentType: 'codex' }),
    ]
    expect(newerStewardSession(list, current)?.id).toBe('switched')
    expect(newerStewardSession(list, { ...current, localCreationState: 'draft' })).toBeUndefined()
    expect(newerStewardSession([current], current)).toBeUndefined()
  })

  it('names every dimension that changed between neighbouring conversations, machine before AI before model', () => {
    const base = session('a', '2026-09-29T01:00:00.000Z')
    expect(stewardDividerLabel(base, session('b', '2026-09-29T02:00:00.000Z'), names)).toBe('新对话')
    expect(stewardDividerLabel(base, session('b', '2026-09-29T02:00:00.000Z', { modelId: 'x' }), names)).toBe('切换到 模型x')
    expect(stewardDividerLabel(base, session('b', '2026-09-29T02:00:00.000Z', { agentType: 'codex', modelId: 'x' }), names)).toBe('切换到 AI codex、模型x')
    // A machine switch never swallows a tool switch that happened in the same move.
    expect(stewardDividerLabel(base, session('b', '2026-09-29T02:00:00.000Z', { machineId: 'm2', agentType: 'codex' }), names)).toBe('切换到 机器m2、AI codex')
  })

  it('joins earlier conversations oldest first with a rule before each later one', () => {
    const sessions = [
      session('c', '2026-09-29T03:00:00.000Z', { agentType: 'codex' }),
      session('a', '2026-09-29T01:00:00.000Z'),
      session('b', '2026-09-29T02:00:00.000Z'),
    ]
    const prelude = buildStewardPrelude({
      sessions, currentId: 'c', names,
      earlierMessages: new Map([['a', [say('a1', 10)]], ['b', [say('b1', 20), say('b2', 21)]]]),
    })
    expect(prelude.map((item) => item.divider ?? item.id)).toEqual(['a1', '新对话', 'b1', 'b2', '切换到 AI codex'])
    expect(prelude[1]).toMatchObject({ id: 'steward-divider-b', role: 'agent', content: '' })
  })

  it('skips empty earlier conversations, but always marks the current one once anything came before', () => {
    const sessions = [session('a', '2026-09-29T01:00:00.000Z'), session('empty', '2026-09-29T02:00:00.000Z'), session('b', '2026-09-29T03:00:00.000Z')]
    const prelude = buildStewardPrelude({ sessions, currentId: 'b', names, earlierMessages: new Map([['a', [say('a1', 10)]]]) })
    expect(prelude.map((item) => item.divider ?? item.id)).toEqual(['a1', '新对话'])
    // Nothing before the current one: no rule, no clutter.
    expect(buildStewardPrelude({ sessions: [session('b', '2026-09-29T03:00:00.000Z')], currentId: 'b', names, earlierMessages: new Map() })).toEqual([])
    // Sessions after the current one are not part of what is shown above it.
    expect(buildStewardPrelude({ sessions, currentId: 'a', names, earlierMessages: new Map([['b', [say('b1', 30)]]]) })).toEqual([])
  })
})

describe('steward in-conversation switches', () => {
  it('draws a rule where the tool or model changed, inside the open conversation only', () => {
    const marks = [
      { sessionId: 's1', ts: 20, agentType: 'codex' },
      { sessionId: 's1', ts: 30, modelId: 'gpt-5' },
      { sessionId: 's1', ts: 40, defaultModel: true as const },
      { sessionId: 'other', ts: 50, agentType: 'claude' },
      // Nothing actually changed: no rule.
      { sessionId: 's1', ts: 60 },
    ]
    const switches = stewardSwitchMessages({
      marks, sessionId: 's1',
      switchTo: (name) => `切换到 ${name}`,
      agentName: (agentType) => `AI ${agentType}`,
      modelName: (modelId) => modelId ?? '默认模型',
    })
    expect(switches.map((item) => [item.ts, item.divider])).toEqual([
      [20, '切换到 AI codex'],
      [30, '切换到 gpt-5'],
      [40, '切换到 默认模型'],
    ])
    expect(stewardSwitchMessages({
      marks, sessionId: null, switchTo: (name) => name, agentName: (type) => type, modelName: () => '',
    })).toEqual([])
  })

  it('merges those rules into the conversation by time, keeping a mark after a message of the same moment', () => {
    const messages = [message({ id: 'm1', ts: 10 }), message({ id: 'm2', ts: 30 }), message({ id: 'm3', ts: 50 })]
    const marks = [message({ id: 'sw', ts: 30, divider: '切换到 AI codex' })]
    expect(withStewardSwitchMarks(messages, marks).map((item) => item.id)).toEqual(['m1', 'm2', 'sw', 'm3'])
    expect(withStewardSwitchMarks(messages, [])).toEqual(messages)
  })

  it('remembers switches per account, caps and prunes them, and survives a broken store', async () => {
    await appendStewardSwitchMark('a', { sessionId: 's1', ts: 1, agentType: 'codex' })
    await appendStewardSwitchMark('a', { sessionId: 's2', ts: 2, modelId: 'gpt-5' })
    await appendStewardSwitchMark('b', { sessionId: 's9', ts: 3 })
    expect(await readStewardSwitchMarks('a')).toEqual([
      { sessionId: 's1', ts: 1, agentType: 'codex' },
      { sessionId: 's2', ts: 2, modelId: 'gpt-5' },
    ])
    expect(await pruneStewardSwitchMarks('a', ['s2'])).toEqual([{ sessionId: 's2', ts: 2, modelId: 'gpt-5' }])
    expect(await readStewardSwitchMarks('a')).toHaveLength(1)
    expect(await readStewardSwitchMarks('b')).toHaveLength(1)
    store.set('shennian:steward:switches:v1:c', JSON.stringify([{ sessionId: 'ok', ts: 7 }, { ts: 8 }, 'junk']))
    expect(await readStewardSwitchMarks('c')).toEqual([{ sessionId: 'ok', ts: 7 }])
    store.set('shennian:steward:switches:v1:d', 'not json')
    expect(await readStewardSwitchMarks('d')).toEqual([])
    expect(await readStewardSwitchMarks('')).toEqual([])
    // Clearing the steward also drops the rules of the conversations that are gone.
    await clearStewardPreferences('b')
    expect(await readStewardSwitchMarks('b')).toEqual([])
  })
})

describe('steward preferences', () => {
  it('are kept per account, merged on write and sanitized on read', async () => {
    await writeStewardPreferences('a', { machineId: 'm1', agentType: 'claude' })
    await writeStewardPreferences('a', { sessionId: 's1' })
    await writeStewardPreferences('b', { machineId: 'other' })
    expect(await readStewardPreferences('a')).toEqual({ machineId: 'm1', agentType: 'claude', sessionId: 's1' })
    await writeStewardPreferences('a', { showMachineName: false, showModel: false })
    expect(await readStewardPreferences('a')).toMatchObject({ showMachineName: false, showModel: false })
    await writeStewardPreferences('a', { showMachineName: undefined, showModel: undefined })
    expect(await readStewardPreferences('b')).toEqual({ machineId: 'other' })
    store.set('shennian:steward:v1:c', JSON.stringify({ machineId: 42, sessionId: 'x'.repeat(200), extra: true }))
    expect(await readStewardPreferences('c')).toEqual({})
    store.set('shennian:steward:v1:d', 'not json')
    expect(await readStewardPreferences('d')).toEqual({})
    await clearStewardPreferences('a')
    expect(await readStewardPreferences('a')).toEqual({})
    expect(await readStewardPreferences('')).toEqual({})
  })
})

// @covers packages/app/src/features/steward/stewardModelChoices.ts
import { stewardModelChoices } from '../features/steward/stewardModelChoices'

describe('steward model choices', () => {
  it('keeps the concrete default selectable independently of following defaults', () => {
    const models = [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', isDefault: true },
      { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
    ]
    expect(stewardModelChoices(models)).toEqual({ explicitModels: models, defaultModel: models[0] })
  })

  it('does not treat the default sentinel as a concrete model name', () => {
    expect(stewardModelChoices([{ id: 'default', name: 'Default', isDefault: true }]))
      .toEqual({ explicitModels: [], defaultModel: undefined })
  })

  it('leaves the default unknown when discovery has no default flag or no models', () => {
    expect(stewardModelChoices([{ id: 'x', name: 'X' }]).defaultModel).toBeUndefined()
    expect(stewardModelChoices([])).toEqual({ explicitModels: [], defaultModel: undefined })
  })

  it('reflects a changed default without removing either fixed model choice', () => {
    const models = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', isDefault: true }]
    expect(stewardModelChoices(models).defaultModel?.id).toBe('b')
    expect(stewardModelChoices(models).explicitModels.map((model) => model.id)).toEqual(['a', 'b'])
  })
})

// @covers packages/app/src/features/steward/personalModelClient.ts
const api = vi.hoisted(() => vi.fn())
vi.mock('../config/api', () => ({ authApi: api }))
import { personalModelClient } from '../features/steward/personalModelClient'
beforeEach(() => vi.clearAllMocks())
describe('personal model configuration transport', () => {
  it('binds reads and writes to the exact primary revision without persisting secrets to account state', async () => {
    api.mockResolvedValue({ mode: 'custom', hasApiKey: true })
    await personalModelClient.read(5)
    expect(JSON.parse(api.mock.calls[0]![1].body)).toEqual({ action: 'model_info', expectedPrimaryRevision: 5 })
    await personalModelClient.save(5, { mode: 'custom', baseUrl: 'https://provider.example/v1', model: 'test', apiKey: 'synthetic' })
    expect(JSON.parse(api.mock.calls[1]![1].body)).toEqual({ action: 'model_set', expectedPrimaryRevision: 5, settings: { mode: 'custom', baseUrl: 'https://provider.example/v1', model: 'test', apiKey: 'synthetic' } })
  })
  it('can switch to official without resending the saved custom key', async () => {
    await personalModelClient.save(9, { mode: 'official' })
    expect(JSON.parse(api.mock.calls[0]![1].body).settings).toEqual({ mode: 'official' })
  })
})

// @covers packages/app/src/features/steward/stewardModel.ts
import { machineNeedsBuiltinUpgrade } from '../features/steward/stewardModel'
describe('builtin Client capability state', () => {
  it('requests an update only for a known older Client', () => {
    expect(machineNeedsBuiltinUpgrade({ cliVersion: '0.5.39' })).toBe(true)
    expect(machineNeedsBuiltinUpgrade({ cliVersion: '0.5.40' })).toBe(false)
    expect(machineNeedsBuiltinUpgrade({ cliVersion: '0.6.0' })).toBe(false)
    expect(machineNeedsBuiltinUpgrade({})).toBe(false)
  })
})

it('reports strict session-selection persistence failure instead of claiming context reset success', async () => {
  vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage failed'))
  await expect(writeStewardPreferences('a', { sessionId: 'fresh' }, true)).rejects.toThrow('storage failed')
  expect((await readStewardPreferences('a')).sessionId).toBeUndefined()
  await expect(writeStewardPreferences('', { sessionId: 'fresh' }, true)).rejects.toThrow('steward_account_missing')
})
