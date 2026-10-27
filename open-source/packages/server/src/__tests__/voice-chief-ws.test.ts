// @covers open-source/packages/server/src/routes/voice-chief-ws.ts

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadProjects = vi.fn()
const mockFlashHandleUserTurn = vi.fn()
const mockFlashInterrupt = vi.fn()
const mockFlashSeedPreviousCallContext = vi.fn()
const mockFlashAppendPhoneTranscript = vi.fn()
const mockFlashAppendSilentContext = vi.fn()
const mockSubscribeConversation = vi.fn()
const mockSummarizeAgentEvent = vi.fn()
const conversationSubscribers = new Map<string, (message: Record<string, any>) => void>()
const mockCreateTask = vi.fn()
const mockListTasks = vi.fn()
const mockReadTask = vi.fn()
const mockContinueTask = vi.fn()
const mockStopTask = vi.fn()
const mockInvalidateVoiceBodyCacheForCall = vi.fn()
const mockLoadIncomingCallIntentContext = vi.fn()
let realtimeOptions: Record<string, any> | null = null
let flashOptions: Record<string, any> | null = null

const realtime = {
  connect: vi.fn(),
  sendAudio: vi.fn(),
  createResponseFromUserText: vi.fn(),
  injectConversationMessage: vi.fn(),
  injectDelegateResult: vi.fn(),
  sendFunctionOutput: vi.fn(),
  beginTerminalHangUp: vi.fn(),
  close: vi.fn(),
}

vi.mock('../services/jwt.js', () => ({ verifyToken: vi.fn(() => ({ userId: 'user-1' })) }))
vi.mock('../services/voice-chief-control.js', () => ({
  HANG_UP_CALL_TOOL: { name: 'hang_up', parameters: { type: 'object', properties: {} } },
  loadVoiceChiefProjects: mockLoadProjects,
  hangUpVoiceCall: vi.fn(() => ({ status: 'ended', message: '通话已结束。' })),
  createProjectConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  sendMessageToConversation: vi.fn(),
  stopConversation: vi.fn(),
}))
vi.mock('../services/voice-chief-task-router.js', () => ({
  listProjectTasksFromVoice: mockListTasks,
  inspectTaskFromVoice: mockReadTask,
  createTaskFromVoice: mockCreateTask,
  continueTaskFromVoice: mockContinueTask,
  stopTaskFromVoice: mockStopTask,
  sanitizeVoiceTaskResult: vi.fn((value: Record<string, unknown>) => {
    const result = { ...value }
    delete result.projectId
    delete result.conversationId
    result.spokenSummary = result.message
    delete result.message
    return result
  }),
  taskProjectBriefs: vi.fn((projects: unknown[]) => projects),
}))
vi.mock('../services/voice-chief-flash.js', () => ({
  DELEGATE_TOOL: {
    name: 'delegate',
    description: 'delegate',
    parameters: {
      type: 'object',
      properties: { intent: { type: 'string' } },
      required: ['intent'],
    },
  },
  parseVoiceChiefDelegateArguments: vi.fn((argumentsJson: string) => {
    const value = JSON.parse(argumentsJson || '{}')
    return {
      intent: typeof value.intent === 'string' ? value.intent : '',
    }
  }),
  buildVoiceChiefRealtimeFlashInstructions: vi.fn(() => 'REALTIME_V5'),
  buildVoiceChiefFlashInstructions: vi.fn(() => 'FLASH_V5'),
  VoiceChiefFlashCoordinator: class {
    constructor(options: Record<string, any>) {
      flashOptions = options
    }
    handleUserTurn = mockFlashHandleUserTurn
    interrupt = mockFlashInterrupt
    seedPreviousCallContext = mockFlashSeedPreviousCallContext
    appendPhoneTranscript = mockFlashAppendPhoneTranscript
    appendSilentContext = mockFlashAppendSilentContext
    close = vi.fn()
    flushTrace = vi.fn()
  },
}))
vi.mock('../services/voice-chief-memory.js', () => ({
  VOICE_CHIEF_PREVIOUS_CALL_CONTEXT_LIMIT_CHARS: 64_000,
  loadVoiceChiefPreviousCallContext: vi.fn(async () => ({ context: '上一通电话' })),
  saveVoiceChiefPreviousCallContext: vi.fn(async () => ({ context: 'saved' })),
}))
vi.mock('../services/voice-chief-preferences.js', () => ({
  VOICE_CHIEF_DEFAULT_VOICE: 'longanlingxin',
  loadVoiceChiefUserPreferences: vi.fn(async () => ({ voice: 'longanqian' })),
  normalizeVoiceChiefVoice: vi.fn((value: unknown) =>
    typeof value === 'string' && value.startsWith('longan') ? value : null,
  ),
}))
vi.mock('../services/voice-chief-runtime.js', () => ({
  subscribeVoiceChiefConversation: mockSubscribeConversation,
  summarizeVoiceChiefAgentEvent: mockSummarizeAgentEvent,
}))
vi.mock('../services/voice-body-cache.js', () => ({
  invalidateVoiceBodyCacheForCall: mockInvalidateVoiceBodyCacheForCall,
}))
vi.mock('../services/voice-incoming-call-intent.js', () => ({
  loadVoiceIncomingCallIntentContext: mockLoadIncomingCallIntentContext,
}))
vi.mock('../services/qwen-audio-realtime.js', () => ({
  QWEN_AUDIO_REALTIME_INPUT_SAMPLE_RATE: 16_000,
  QWEN_AUDIO_REALTIME_OUTPUT_SAMPLE_RATE: 24_000,
  QwenAudioRealtimeClient: class {
    constructor(options: Record<string, any>) {
      realtimeOptions = options
    }
    connect = realtime.connect
    sendAudio = realtime.sendAudio
    createResponseFromUserText = realtime.createResponseFromUserText
    injectConversationMessage = realtime.injectConversationMessage
    injectDelegateResult = realtime.injectDelegateResult
    sendFunctionOutput = realtime.sendFunctionOutput
    beginTerminalHangUp = realtime.beginTerminalHangUp
    close = realtime.close
  },
}))

class FakeSocket extends EventEmitter {
  readyState = 1
  sent: Array<string | Uint8Array> = []
  send(value: string | Uint8Array) {
    this.sent.push(value)
  }
  close = vi.fn(() => {
    this.readyState = 3
  })
  clientJson(frame: Record<string, unknown>) {
    this.emit('message', Buffer.from(JSON.stringify(frame)), false)
  }
  clientAudio(frame: Uint8Array) {
    this.emit('message', Buffer.from(frame), true)
  }
  jsonFrames() {
    return this.sent
      .filter((item): item is string => typeof item === 'string')
      .map((item) => JSON.parse(item))
  }
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function startCall(frame: Record<string, unknown> = {}) {
  const { handleVoiceChiefConnection } = await import('../routes/voice-chief-ws.js')
  const socket = new FakeSocket()
  handleVoiceChiefConnection(
    socket as any,
    {
      url: '/voice-chief/ws?token=valid&syncProtocol=2&dataEpoch=2',
      log: { info: vi.fn(), warn: vi.fn() },
    } as any,
  )
  socket.clientJson({ type: 'start', debugTools: true, ...frame })
  await flush()
  return socket
}

describe('voice chief websocket V5', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realtimeOptions = null
    flashOptions = null
    conversationSubscribers.clear()
    mockSubscribeConversation.mockImplementation(
      (conversationId: string, subscriber: (message: Record<string, any>) => void) => {
        conversationSubscribers.set(conversationId, subscriber)
        return vi.fn()
      },
    )
    mockSummarizeAgentEvent.mockImplementation((text: string) => ({
      kind: 'progress',
      text,
      requiresUserResponse: false,
    }))
    mockLoadIncomingCallIntentContext.mockResolvedValue(null)
    process.env.DASHSCOPE_API_KEY = 'test-key'
    mockLoadProjects.mockResolvedValue([
      {
        projectId: 'p1',
        displayName: 'shennian',
        machineId: 'machine-1',
        machineName: 'Mac',
        machineStatus: 'online',
        recentProgress: [],
        conversations: [
          {
            conversationId: 'task-1',
            title: '语音字幕修复',
            agentType: 'codex',
            modelId: 'gpt-5',
            status: 'completed',
            runPhase: null,
            canStop: false,
            lastActivityAt: '2026-08-29T09:00:00.000Z',
            lastMessagePreview: '字幕修复已经完成。',
            workDir: '/repo/shennian',
            machineId: 'machine-1',
            machineName: 'Mac',
            machineStatus: 'online',
            agentSessionId: 'agent-1',
            systemPrompt: null,
            isUnread: true,
          },
        ],
        workDir: '/repo/shennian',
        latestAgentType: 'codex',
        latestModelId: 'gpt-5',
      },
    ])
    realtime.connect.mockImplementation(async () => realtimeOptions?.callbacks?.onReady?.())
    mockFlashHandleUserTurn.mockResolvedValue({
      status: 'handled',
      response: '已经安排。',
      activities: [],
      background: { running: false },
      speech: { shouldSpeak: true, priority: 'normal' },
      toolCalls: [],
    })
  })

  it('rejects an old App before it can reach personal task controls', async () => {
    const { handleVoiceChiefConnection } = await import('../routes/voice-chief-ws.js')
    const socket = new FakeSocket()
    handleVoiceChiefConnection(
      socket as any,
      { url: '/voice-chief/ws?token=valid', log: { info: vi.fn(), warn: vi.fn() } } as any,
    )
    expect(socket.close).toHaveBeenCalledWith(
      4406,
      'upgrade_required:session_sync_protocol_mismatch',
    )
    expect(realtime.connect).not.toHaveBeenCalled()
  })

  it('always exposes only delegate and hang_up to Realtime', async () => {
    const socket = await startCall()
    expect(realtimeOptions).toMatchObject({ apiKey: 'test-key', instructions: 'REALTIME_V5' })
    expect(realtimeOptions?.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'delegate',
      'hang_up',
    ])
    expect(flashOptions?.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'list_project_tasks',
      'read_task',
      'create_task',
      'continue_task',
      'stop_task',
    ])
    expect(mockFlashSeedPreviousCallContext).toHaveBeenCalledWith('上一通电话')
    expect(mockFlashAppendSilentContext).toHaveBeenCalledWith(
      'CALL_ATTENTION_SNAPSHOT',
      expect.stringContaining('title=语音字幕修复'),
    )
    expect(realtime.createResponseFromUserText).toHaveBeenCalledWith(
      expect.stringContaining('<attention_snapshot>'),
    )
    expect(realtime.createResponseFromUserText).not.toHaveBeenCalledWith(
      expect.stringContaining('<user_context>'),
    )
    expect(realtime.createResponseFromUserText).toHaveBeenCalledWith(
      expect.stringContaining('<previous_call_context>\n上一通电话'),
    )
    expect(mockSubscribeConversation).toHaveBeenCalledWith('task-1', expect.any(Function))
    expect(socket.jsonFrames()).toContainEqual(
      expect.objectContaining({ type: 'ready', inputSampleRate: 16_000 }),
    )
  })

  it('uses durable incoming-call context instead of client supplied context', async () => {
    mockLoadIncomingCallIntentContext.mockResolvedValue({
      callId: 'call-authoritative',
      reason: '数据库里的来电事项',
      initialPrompt: '数据库里的处理目标',
      projectHint: '数据库里的项目',
    })

    await startCall({
      incomingCallId: 'call-authoritative',
      reason: '客户端伪造事项',
      initialPrompt: '客户端伪造目标',
      projectHint: '客户端伪造项目',
    })

    expect(mockLoadIncomingCallIntentContext).toHaveBeenCalledWith('user-1', 'call-authoritative')
    const openingText = realtime.createResponseFromUserText.mock.calls[0]?.[0] as string
    expect(openingText).toContain('数据库里的来电事项')
    expect(openingText).toContain('数据库里的处理目标')
    expect(openingText).toContain('数据库里的项目')
    expect(openingText).not.toContain('客户端伪造')
  })

  it('keeps legacy client context when no durable incoming-call intent exists', async () => {
    mockLoadIncomingCallIntentContext.mockResolvedValue(null)
    await startCall({ incomingCallId: 'legacy-call', reason: '旧客户端事项' })
    const openingText = realtime.createResponseFromUserText.mock.calls[0]?.[0] as string
    expect(openingText).toContain('旧客户端事项')
  })

  it('adds live task events to both contexts without running Flash', async () => {
    await startCall()
    mockSummarizeAgentEvent.mockReturnValueOnce({
      kind: 'completed',
      text: '字幕修复已经完成，可以验收。',
      requiresUserResponse: false,
    })
    conversationSubscribers.get('task-1')?.({
      conversationId: 'task-1',
      runId: 'run-1',
      text: '任务完成',
      state: 'final',
    })

    expect(mockFlashAppendSilentContext).toHaveBeenCalledWith(
      'TASK_EVENT',
      expect.stringContaining('字幕修复已经完成，可以验收。'),
    )
    expect(realtime.injectConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'task-1',
        eventKind: 'completed',
        message: '字幕修复已经完成，可以验收。',
        shouldSpeak: true,
      }),
    )
    expect(mockFlashHandleUserTurn).not.toHaveBeenCalled()
  })

  it('accepts delegate immediately and injects the result after background Flash completes', async () => {
    await startCall()
    let finishFlash: ((value: Record<string, unknown>) => void) | undefined
    mockFlashHandleUserTurn.mockImplementationOnce(
      () => new Promise((resolve) => { finishFlash = resolve }),
    )
    realtimeOptions?.callbacks?.onInputTranscript?.('看看语音任务。', true)
    realtimeOptions?.callbacks?.onFunctionCall?.({
      callId: 'delegate-1',
      name: 'delegate',
      argumentsJson: JSON.stringify({
        intent: '查看语音任务的真实进展',
      }),
    })
    await flush()
    expect(mockFlashHandleUserTurn).toHaveBeenCalledWith('看看语音任务。', {
      inputAlreadySynced: true,
      realtimeIntent: '查看语音任务的真实进展',
    })
    expect(realtime.sendFunctionOutput).toHaveBeenCalledTimes(1)
    expect(realtime.sendFunctionOutput).toHaveBeenCalledWith(
      'delegate-1',
      {
        status: 'accepted',
        processing: true,
      },
    )
    expect(realtime.injectDelegateResult).not.toHaveBeenCalled()

    realtimeOptions?.callbacks?.onInputSpeechStarted?.()
    expect(mockFlashInterrupt).not.toHaveBeenCalled()

    finishFlash?.({
      status: 'handled',
      response: '语音任务正在执行。',
      activities: [],
      background: { running: true },
      speech: { shouldSpeak: true, priority: 'normal' },
      toolCalls: ['read_task'],
    })
    await flush()
    expect(realtime.injectDelegateResult).toHaveBeenCalledWith({
      result: {
        status: 'ok',
        message: '语音任务正在执行。',
        requiresUserResponse: false,
        backgroundRunning: true,
      },
    })
  })

  it('rejects every removed V3 tool', async () => {
    await startCall()
    for (const name of [
      'handoff',
      'find_conversations',
      'enter_conversation',
      'exit_conversation',
    ]) {
      realtimeOptions?.callbacks?.onFunctionCall?.({ callId: name, name, argumentsJson: '{}' })
    }
    await flush()
    expect(
      realtime.sendFunctionOutput.mock.calls.map(([callId, result]) => [callId, result.status]),
    ).toEqual([
      ['handoff', 'failed'],
      ['find_conversations', 'failed'],
      ['enter_conversation', 'failed'],
      ['exit_conversation', 'failed'],
    ])
  })

  it('syncs final user text and only the spoken prefix of interrupted output to Flash', async () => {
    await startCall()
    realtimeOptions?.callbacks?.onInputTranscript?.('继续语音任务。', true)
    realtimeOptions?.callbacks?.onOutputTranscript?.('已经找到任务，', false, 'response-cut')
    realtimeOptions?.callbacks?.onInterrupted?.('response-cut')
    realtimeOptions?.callbacks?.onOutputTranscript?.(
      '已经找到任务，后面还有很长的内容。',
      true,
      'response-cut',
    )
    expect(mockFlashAppendPhoneTranscript).toHaveBeenCalledWith('user', '继续语音任务。', 'input:1')
    expect(mockFlashAppendPhoneTranscript).toHaveBeenCalledWith(
      'assistant',
      '已经找到任务，（被用户打断）',
      'output:response-cut:interrupted',
    )
    expect(mockFlashAppendPhoneTranscript).not.toHaveBeenCalledWith(
      'assistant',
      expect.stringContaining('很长的内容'),
      expect.any(String),
    )
  })

  it('keeps hang_up as the only direct non-delegate action', async () => {
    const socket = await startCall()
    realtimeOptions?.callbacks?.onFunctionCall?.({
      callId: 'hang-1',
      name: 'hang_up',
      argumentsJson: '{"reason":"用户说拜拜"}',
    })
    await flush()
    expect(realtime.sendFunctionOutput).toHaveBeenCalledWith(
      'hang-1',
      expect.objectContaining({ status: 'ended' }),
      { createResponse: false },
    )
    expect(socket.jsonFrames()).toContainEqual(
      expect.objectContaining({ type: 'hang_up', reason: '用户说拜拜' }),
    )
  })

  it('reuses one phone-call cache identity across read_task tool calls and clears it on close', async () => {
    const socket = await startCall()
    mockReadTask.mockResolvedValue({ status: 'ok', message: '任务已读取。' })

    await flashOptions?.executeTool({
      callId: 'model-tool-1',
      name: 'read_task',
      argumentsJson: '{"taskRef":"task-1"}',
    })
    await flashOptions?.executeTool({
      callId: 'model-tool-2',
      name: 'read_task',
      argumentsJson: '{"taskRef":"task-1"}',
    })

    const firstVoiceCallId = mockReadTask.mock.calls[0]?.[0]?.callId
    expect(firstVoiceCallId).toEqual(expect.any(String))
    expect(firstVoiceCallId).not.toBe('model-tool-1')
    expect(mockReadTask.mock.calls[1]?.[0]?.callId).toBe(firstVoiceCallId)

    socket.emit('close')
    expect(mockInvalidateVoiceBodyCacheForCall).toHaveBeenCalledWith(firstVoiceCallId)
  })
})
