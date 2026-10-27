import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  AVAILABLE_BUILTIN_AGENT_TYPES,
  agentInfoSupportsAgent,
  agentInfoSupportsExecutionMode,
  filterAvailableAgentInfos,
  filterAvailableAgentTypes,
  Envelope,
  Frame,
  ReqFrame,
  ResFrame,
  EventFrame,
  ReqMethod,
  AgentType,
  NianSession,
  ChatSendParams,
  ChatEnqueueParams,
  ChatQueueSnapshot,
  SessionResumeParams,
  SessionHistoryParams,
  FsLsParams,
  FsReadParams,
  FsEntry,
  FsTransferRequest,
  FsChunk,
  AgentEventPayload,
} from '../index.ts'

describe('Envelope', () => {
  it('has correct shape', () => {
    expectTypeOf<Envelope>().toHaveProperty('id')
    expectTypeOf<Envelope>().toHaveProperty('sessionId')
    expectTypeOf<Envelope>().toHaveProperty('role')
    expectTypeOf<Envelope>().toHaveProperty('ts')
    expectTypeOf<Envelope>().toHaveProperty('payload')
    expectTypeOf<Envelope['role']>().toEqualTypeOf<'user' | 'agent'>()
    expectTypeOf<Envelope['ts']>().toBeNumber()
  })
})

describe('Frame types', () => {
  it('ReqFrame has correct shape', () => {
    expectTypeOf<ReqFrame>().toHaveProperty('type')
    expectTypeOf<ReqFrame>().toHaveProperty('id')
    expectTypeOf<ReqFrame>().toHaveProperty('method')
    expectTypeOf<ReqFrame>().toHaveProperty('params')
    expectTypeOf<ReqFrame['type']>().toEqualTypeOf<'req'>()
  })

  it('ResFrame has correct shape', () => {
    expectTypeOf<ResFrame>().toHaveProperty('type')
    expectTypeOf<ResFrame>().toHaveProperty('id')
    expectTypeOf<ResFrame>().toHaveProperty('ok')
    expectTypeOf<ResFrame['type']>().toEqualTypeOf<'res'>()
    expectTypeOf<ResFrame['ok']>().toBeBoolean()
  })

  it('EventFrame has correct shape', () => {
    expectTypeOf<EventFrame>().toHaveProperty('type')
    expectTypeOf<EventFrame>().toHaveProperty('event')
    expectTypeOf<EventFrame['type']>().toEqualTypeOf<'event'>()
  })

  it('Frame is a union of Req | Res | Event', () => {
    expectTypeOf<ReqFrame>().toMatchTypeOf<Frame>()
    expectTypeOf<ResFrame>().toMatchTypeOf<Frame>()
    expectTypeOf<EventFrame>().toMatchTypeOf<Frame>()
  })
})

describe('ReqMethod', () => {
  it('includes expected methods', () => {
    expectTypeOf<'chat.send'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'chat.enqueue'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'chat.queue.get'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'chat.queue.edit'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'chat.queue.delete'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'chat.queue.promote'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'chat.abort'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.resume'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.history'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.history.open'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.history.page'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.history.close'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.body.replica.subscribe'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.body.replica.unsubscribe'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.index.update'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.message.status'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'voice.session.body.window'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.refresh'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'session.tool.detail'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'fs.ls'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'fs.read'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'fs.write'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'fs.archive.zip'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'fs.transfer.start'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'fs.rename'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'fs.export.markdown-pdf.setup'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'agent.capabilities.list'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'agents.refresh'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'models.refresh'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'agent.config.get'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'agent.config.upsert'>().toMatchTypeOf<ReqMethod>()
    expectTypeOf<'wechat-rpa.helper.runtime'>().toMatchTypeOf<ReqMethod>()
  })
})

describe('Session types', () => {
  it('AgentType includes all expected agents', () => {
    expectTypeOf<'claude'>().toMatchTypeOf<AgentType>()
    expectTypeOf<'codex'>().toMatchTypeOf<AgentType>()
    expectTypeOf<'workbuddy'>().toMatchTypeOf<AgentType>()
    expectTypeOf<'gemini'>().toMatchTypeOf<AgentType>()
    expectTypeOf<'cursor'>().toMatchTypeOf<AgentType>()
    expectTypeOf<'openclaw'>().toMatchTypeOf<AgentType>()
    expectTypeOf<'opencode'>().toMatchTypeOf<AgentType>()
    expectTypeOf<'pi-coding-agent'>().toMatchTypeOf<AgentType>()
    expectTypeOf<'manager'>().toMatchTypeOf<AgentType>()
  })

  it('filters runtime-available agents without breaking historical types', () => {
    expect(AVAILABLE_BUILTIN_AGENT_TYPES).toEqual([
      'shennian',
      'claude',
      'codex',
      'workbuddy',
      'cursor',
      'opencode',
      'pi',
      'pi-coding-agent',
    ])
    expect(
      filterAvailableAgentTypes([
        'gemini',
        'openclaw',
        'claude',
        'custom:test',
        'cursor',
        'claude',
      ]),
    ).toEqual(['claude', 'custom:test', 'cursor'])
  })

  it('keeps built-in and custom agent infos in runtime-visible order', () => {
    expect(
      filterAvailableAgentInfos([
        { type: 'cursor', models: [] },
        {
          type: 'codex',
          models: [{ id: 'gpt-5', name: 'GPT-5' }],
          config: { status: 'detected', tokenPresent: true },
        },
        { type: 'custom:demo', models: [{ id: 'demo-1', name: 'Demo' }] },
        { type: 'openclaw', models: [] },
      ]),
    ).toEqual([
      { type: 'cursor', models: [] },
      {
        type: 'codex',
        models: [{ id: 'gpt-5', name: 'GPT-5' }],
        config: { status: 'detected', tokenPresent: true },
      },
      { type: 'custom:demo', models: [{ id: 'demo-1', name: 'Demo' }] },
    ])
  })

  it('separates Agent eligibility from execution modes with legacy fallback', () => {
    const openCode = { type: 'opencode' as const, models: [], supportsAgent: true,
      supportedAgentExecutionModes: ['native-full' as const], supportsManagedAgent: false,
      supportsManagedNativeFull: true }
    expect(agentInfoSupportsAgent(openCode)).toBe(true)
    expect(agentInfoSupportsExecutionMode(openCode, 'native-full')).toBe(true)
    expect(agentInfoSupportsExecutionMode(openCode, 'restricted')).toBe(false)
    const legacy = { type: 'codex' as const, models: [], supportsManagedAgent: true,
      supportsManagedNativeFull: false }
    expect(agentInfoSupportsAgent(legacy)).toBe(true)
    expect(agentInfoSupportsExecutionMode(legacy, 'restricted')).toBe(true)
    expect(agentInfoSupportsExecutionMode(legacy, 'native-full')).toBe(false)
  })

  it('NianSession has required fields', () => {
    expectTypeOf<NianSession>().toHaveProperty('id')
    expectTypeOf<NianSession>().toHaveProperty('machineId')
    expectTypeOf<NianSession>().toHaveProperty('userId')
    expectTypeOf<NianSession>().toHaveProperty('agentType')
    expectTypeOf<NianSession>().toHaveProperty('status')
    expectTypeOf<NianSession['status']>().toEqualTypeOf<'active' | 'completed' | 'failed'>()
  })

  it('ChatSendParams has required fields', () => {
    expectTypeOf<ChatSendParams>().toHaveProperty('sessionId')
    expectTypeOf<ChatSendParams>().toHaveProperty('text')
    expectTypeOf<ChatSendParams>().toHaveProperty('agentType')
    expectTypeOf<ChatSendParams>().toHaveProperty('reasoningEffort')
    expectTypeOf<ChatSendParams>().toHaveProperty('replyTarget')
  })

  it('chat queue types have required fields', () => {
    expectTypeOf<ChatEnqueueParams>().toHaveProperty('sessionId')
    expectTypeOf<ChatEnqueueParams>().toHaveProperty('queueMessageId')
    expectTypeOf<ChatEnqueueParams>().toHaveProperty('reasoningEffort')
    expectTypeOf<ChatEnqueueParams>().toHaveProperty('replyTarget')
    expectTypeOf<ChatQueueSnapshot>().toHaveProperty('pending')
  })

  it('SessionResumeParams has required fields', () => {
    expectTypeOf<SessionResumeParams>().toHaveProperty('sessionId')
    expectTypeOf<SessionResumeParams>().toHaveProperty('agentSessionId')
  })

  it('SessionHistoryParams has required fields', () => {
    expectTypeOf<SessionHistoryParams>().toHaveProperty('sessionId')
  })
})

describe('FS types', () => {
  it('FsEntry has correct shape', () => {
    expectTypeOf<FsEntry>().toHaveProperty('name')
    expectTypeOf<FsEntry>().toHaveProperty('path')
    expectTypeOf<FsEntry>().toHaveProperty('isDir')
    expectTypeOf<FsEntry['isDir']>().toBeBoolean()
  })

  it('FsLsParams and FsReadParams have path', () => {
    expectTypeOf<FsLsParams>().toHaveProperty('path')
    expectTypeOf<FsReadParams>().toHaveProperty('path')
  })

  it('FsTransferRequest has correct shape', () => {
    expectTypeOf<FsTransferRequest>().toHaveProperty('transferId')
    expectTypeOf<FsTransferRequest>().toHaveProperty('direction')
    expectTypeOf<FsTransferRequest['direction']>().toEqualTypeOf<'upload' | 'download'>()
  })

  it('FsChunk has correct shape', () => {
    expectTypeOf<FsChunk>().toHaveProperty('transferId')
    expectTypeOf<FsChunk>().toHaveProperty('seq')
    expectTypeOf<FsChunk>().toHaveProperty('total')
    expectTypeOf<FsChunk>().toHaveProperty('data')
    expectTypeOf<FsChunk['seq']>().toBeNumber()
  })
})

describe('AgentEventPayload', () => {
  it('accepts delta state', () => {
    const delta: AgentEventPayload = { state: 'delta', runId: 'r1', seq: 0, text: 'hi' }
    expectTypeOf(delta).toMatchTypeOf<AgentEventPayload>()
  })

  it('accepts final state', () => {
    const final: AgentEventPayload = { state: 'final', runId: 'r1', seq: 1 }
    expectTypeOf(final).toMatchTypeOf<AgentEventPayload>()
  })

  it('accepts error state', () => {
    const err: AgentEventPayload = { state: 'error', runId: 'r1', seq: 1, message: 'fail' }
    expectTypeOf(err).toMatchTypeOf<AgentEventPayload>()
  })

  it('accepts heartbeat state', () => {
    const heartbeat: AgentEventPayload = { state: 'heartbeat', runId: 'r1', seq: 2, runPhase: 'tool_running' }
    expectTypeOf(heartbeat).toMatchTypeOf<AgentEventPayload>()
  })
})
