// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-ws.test.ts
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RawData } from 'ws'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type VoiceChiefClientFrame,
} from '@shennian/wire'
import { verifyToken } from '../services/jwt.js'
import { HANG_UP_CALL_TOOL, loadVoiceChiefProjects } from '../services/voice-chief-control.js'
import { sanitizeVoiceTaskResult, taskProjectBriefs } from '../services/voice-chief-task-router.js'
import {
  executeVoiceChiefCallTool,
  isVoiceChiefExecutableTool,
} from '../services/voice-chief-call-tools.js'
import {
  buildVoiceChiefFlashInstructions,
  buildVoiceChiefRealtimeFlashInstructions,
  DELEGATE_TOOL,
  parseVoiceChiefDelegateArguments,
  VoiceChiefFlashCoordinator,
} from '../services/voice-chief-flash.js'
import {
  buildVoiceChiefV5AttentionSnapshot,
  buildVoiceChiefV5FinalResult,
  buildVoiceChiefV5WorkspaceSnapshot,
  executeVoiceChiefV5Tool,
  VoiceChiefV5TranscriptState,
  VOICE_SHENNIAN_V5_TASK_TOOLS,
} from '../services/voice-chief-v5.js'
import {
  QwenAudioRealtimeClient,
  QWEN_AUDIO_REALTIME_INPUT_SAMPLE_RATE,
  QWEN_AUDIO_REALTIME_OUTPUT_SAMPLE_RATE,
} from '../services/qwen-audio-realtime.js'
import {
  loadVoiceChiefPreviousCallContext,
  saveVoiceChiefPreviousCallContext,
  VOICE_CHIEF_PREVIOUS_CALL_CONTEXT_LIMIT_CHARS,
  type VoiceChiefPreviousCallSnapshot,
} from '../services/voice-chief-memory.js'
import {
  loadVoiceChiefUserPreferences,
  normalizeVoiceChiefVoice,
  VOICE_CHIEF_DEFAULT_VOICE,
} from '../services/voice-chief-preferences.js'
import {
  subscribeVoiceChiefConversation,
  summarizeVoiceChiefAgentEvent,
} from '../services/voice-chief-runtime.js'
import { invalidateVoiceBodyCacheForCall } from '../services/voice-body-cache.js'
import { loadVoiceIncomingCallIntentContext } from '../services/voice-incoming-call-intent.js'
import {
  appendIncomingCallInstructions,
  buildVoiceChiefCallOpeningUserText,
  buildVoiceChiefCurrentDatetimeContext,
  clipVoiceChiefContextValue,
  extractVoiceChiefToken,
  parseVoiceChiefClientFrame,
  parseVoiceChiefOptionalPositiveIntEnv,
  parseVoiceChiefPositiveIntEnv,
  sendVoiceChiefAudio,
  sendVoiceChiefJson,
  type VoiceChiefSocket,
  voiceChiefRawDataToBuffer,
} from './voice-chief-ws-helpers.js'
const START_TIMEOUT_MS = 5_000
const MAX_AUDIO_FRAME_BYTES = 64 * 1024
const SILENCE_AUTO_HANGUP_GRACE_MS = 30_000
const SILENCE_PROMPT_TEXT = '已经沉默较长时间，是否需要挂断？'
const HANG_UP_AFTER_PLAYBACK_DELAY_MS = 800
const HANG_UP_FALLBACK_MS = 20_000
const MAX_TASK_EVENT_SUBSCRIPTIONS = 40
export function handleVoiceChiefConnection(
  socket: VoiceChiefSocket,
  request: FastifyRequest,
): void {
  const url = new URL(request.url, 'http://localhost')
  if (url.searchParams.get('syncProtocol') !== String(SESSION_SYNC_PROTOCOL_VERSION)) {
    socket.close(4406, 'upgrade_required:session_sync_protocol_mismatch')
    return
  }
  if (url.searchParams.get('dataEpoch') !== String(SESSION_SYNC_DATA_EPOCH)) {
    socket.close(4406, `epoch_mismatch:data_epoch_mismatch:required=${SESSION_SYNC_DATA_EPOCH}`)
    return
  }
  const token = extractVoiceChiefToken(request)
  const payload = token ? verifyToken(token) : null
  if (!payload) {
    socket.close(4001, token ? 'Invalid token' : 'Missing token')
    return
  }
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) {
    sendVoiceChiefJson(socket, {
      type: 'error',
      code: 'provider_not_configured',
      message: '实时语音服务未配置。',
      recoverable: false,
    })
    socket.close(4503, 'Realtime provider not configured')
    return
  }
  const conversationId = randomUUID()
  const userId = payload.userId
  let started = false
  let closed = false
  let upstream: QwenAudioRealtimeClient | null = null
  let flashCoordinator: VoiceChiefFlashCoordinator | null = null
  let projects: Awaited<ReturnType<typeof loadVoiceChiefProjects>> = []
  let startTimer: NodeJS.Timeout | null = null
  let maxCallTimer: NodeJS.Timeout | null = null
  let currentAudioResponseId: string | null = null
  const connectedAt = Date.now()
  let inputFrameCount = 0
  let inputByteCount = 0
  let inputLevelSamples = 0
  let inputLevelSquareSum = 0
  let inputLevelPeak = 0
  let outputChunkCount = 0
  let outputByteCount = 0
  const completedCalls = new Map<string, unknown>()
  const inFlightToolCalls = new Map<string, Promise<unknown>>()
  let delegateQueue: Promise<void> = Promise.resolve()
  let debugTools = false
  const conversationUnsubscribers = new Map<string, () => void>()
  let previousCallSnapshot: VoiceChiefPreviousCallSnapshot = { context: '', updatedAt: null }
  let userPreferences: Awaited<ReturnType<typeof loadVoiceChiefUserPreferences>> = {
    voice: VOICE_CHIEF_DEFAULT_VOICE,
  }
  let lastFinalInputTranscript = ''
  const transcriptState = new VoiceChiefV5TranscriptState()
  let currentCallContextEntries: string[] = []
  let currentCallContextChars = 0
  let previousCallPersisted = false
  const silencePromptMs = parseVoiceChiefOptionalPositiveIntEnv('VOICE_CHIEF_SILENCE_PROMPT_MS')
  const maxCallMs = parseVoiceChiefOptionalPositiveIntEnv('VOICE_CHIEF_MAX_CALL_MS')
  const silenceAutoHangupGraceMs = parseVoiceChiefPositiveIntEnv(
    'VOICE_CHIEF_SILENCE_AUTO_HANGUP_GRACE_MS',
    SILENCE_AUTO_HANGUP_GRACE_MS,
  )
  let silenceTimer: NodeJS.Timeout | null = null
  let silenceHangupTimer: NodeJS.Timeout | null = null
  let silencePromptPending = false
  let hangUpCloseTimer: NodeJS.Timeout | null = null
  const playbackResponseIds = new Set<string>()
  let pendingHangUp: {
    reason?: string
    delayMs: number
    playbackStarted: boolean
    fallbackTimer: NodeJS.Timeout | null
  } | null = null
  request.log?.info({ conversationId, userId }, 'voice chief client connected')
  const currentCallContext = () => currentCallContextEntries.join('\n')
  const recordCallContext = (kind: string, text: string) => {
    const clipped = clipVoiceChiefContextValue(text)
    if (!clipped) return
    const line = `[${new Date().toISOString()}] [${kind}] ${clipped}`
    currentCallContextEntries.push(line)
    currentCallContextChars += line.length + 1
    while (
      currentCallContextChars > VOICE_CHIEF_PREVIOUS_CALL_CONTEXT_LIMIT_CHARS &&
      currentCallContextEntries.length > 1
    ) {
      const removed = currentCallContextEntries.shift()
      currentCallContextChars -= (removed?.length ?? 0) + 1
    }
  }
  const persistPreviousCallContext = (reason: string) => {
    if (previousCallPersisted) return
    const context = currentCallContext()
    if (!context) return
    previousCallPersisted = true
    currentCallContextEntries = []
    currentCallContextChars = 0
    void saveVoiceChiefPreviousCallContext({ userId, context })
      .then((result) => {
        request.log?.info(
          {
            conversationId,
            reason,
            contextChars: result.context.length,
          },
          'voice chief previous call context persisted',
        )
      })
      .catch((error) => {
        request.log?.warn?.(
          { conversationId, reason, error },
          'voice chief previous call context persist failed',
        )
      })
  }
  const clearSilenceTimers = () => {
    if (silenceTimer) clearTimeout(silenceTimer)
    if (silenceHangupTimer) clearTimeout(silenceHangupTimer)
    silenceTimer = null
    silenceHangupTimer = null
  }
  const clearPendingHangUp = () => {
    if (pendingHangUp?.fallbackTimer) clearTimeout(pendingHangUp.fallbackTimer)
    pendingHangUp = null
  }
  const sendHangUpNow = (reason?: string, delayMs = HANG_UP_AFTER_PLAYBACK_DELAY_MS) => {
    clearPendingHangUp()
    if (hangUpCloseTimer) clearTimeout(hangUpCloseTimer)
    sendVoiceChiefJson(socket, { type: 'hang_up', reason, delayMs })
    upstream?.beginTerminalHangUp()
    hangUpCloseTimer = setTimeout(
      () => {
        if (!closed && socket.readyState === 1) socket.close(1000, 'AI hang up')
      },
      Math.max(delayMs + 1_000, 1_000),
    )
    hangUpCloseTimer.unref?.()
  }
  const maybeSendPendingHangUpAfterPlayback = (trigger: string, force = false) => {
    if (!pendingHangUp || closed) return
    if (!force && (playbackResponseIds.size > 0 || currentAudioResponseId)) return
    if (!pendingHangUp.playbackStarted && trigger !== 'fallback') return
    request.log?.info(
      {
        conversationId,
        trigger,
        reason: pendingHangUp.reason,
        delayMs: pendingHangUp.delayMs,
      },
      'voice chief deferred hang up released',
    )
    sendHangUpNow(pendingHangUp.reason, pendingHangUp.delayMs)
  }
  const scheduleSilencePrompt = () => {
    if (closed || silencePromptPending || !started || silencePromptMs === null) return
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = setTimeout(() => {
      silenceTimer = null
      if (closed || silencePromptPending) return
      silencePromptPending = true
      request.log?.info(
        {
          conversationId,
          silencePromptMs,
          silenceAutoHangupGraceMs,
        },
        'voice chief silence prompt triggered',
      )
      recordCallContext('沉默提醒', SILENCE_PROMPT_TEXT)
      upstream?.createResponseFromUserText(
        `通话双方已经沉默较长时间。请你现在只说：“${SILENCE_PROMPT_TEXT}”`,
      )
      silenceHangupTimer = setTimeout(() => {
        silenceHangupTimer = null
        if (closed || !silencePromptPending) return
        recordCallContext(
          '沉默自动挂断',
          `用户在 ${Math.round(silenceAutoHangupGraceMs / 1000)} 秒内没有回应。`,
        )
        sendHangUpNow('长时间沉默，自动挂断。', HANG_UP_AFTER_PLAYBACK_DELAY_MS)
      }, silenceAutoHangupGraceMs)
      silenceHangupTimer.unref?.()
    }, silencePromptMs)
    silenceTimer.unref?.()
  }
  const markMeaningfulActivity = (kind: string, options?: { cancelPendingHangup?: boolean }) => {
    if (closed) return
    const cancelPendingHangup = options?.cancelPendingHangup ?? false
    if (silencePromptPending && cancelPendingHangup) {
      silencePromptPending = false
      if (silenceHangupTimer) clearTimeout(silenceHangupTimer)
      silenceHangupTimer = null
      request.log?.info({ conversationId, kind }, 'voice chief silence auto hangup cancelled')
    }
    scheduleSilencePrompt()
  }
  const cleanup = () => {
    if (closed) return
    closed = true
    persistPreviousCallContext('cleanup')
    if (startTimer) clearTimeout(startTimer)
    if (maxCallTimer) clearTimeout(maxCallTimer)
    if (hangUpCloseTimer) clearTimeout(hangUpCloseTimer)
    clearSilenceTimers()
    clearPendingHangUp()
    playbackResponseIds.clear()
    transcriptState.clear()
    invalidateVoiceBodyCacheForCall(conversationId)
    startTimer = null
    maxCallTimer = null
    hangUpCloseTimer = null
    for (const unsubscribe of conversationUnsubscribers.values()) unsubscribe()
    conversationUnsubscribers.clear()
    flashCoordinator?.close()
    flashCoordinator = null
    upstream?.close()
    upstream = null
    request.log?.info(
      {
        conversationId,
        durationMs: Date.now() - connectedAt,
        inputFrames: inputFrameCount,
        inputBytes: inputByteCount,
        outputChunks: outputChunkCount,
        outputBytes: outputByteCount,
      },
      'voice chief call cleaned up',
    )
  }
  const fail = (code: string, message: string, recoverable = false) => {
    request.log?.warn({ conversationId, code, message, recoverable }, 'voice chief call error')
    sendVoiceChiefJson(socket, { type: 'error', code, message, recoverable })
    if (!recoverable) socket.close(4500, code)
  }
  const subscribeConversation = (input: {
    conversationId: string
    projectId: string
    projectName: string
    conversationTitle: string
  }) => {
    if (conversationUnsubscribers.has(input.conversationId)) return
    const unsubscribe = subscribeVoiceChiefConversation(input.conversationId, (message) => {
      request.log?.info(
        {
          conversationId,
          projectId: input.projectId,
          targetConversationId: message.conversationId,
          characters: message.text.length,
        },
        'voice shennian conversation reply received',
      )
      const summary = summarizeVoiceChiefAgentEvent(message.text, message.state)
      recordCallContext(
        '会话回复',
        `projectId=${input.projectId || 'unknown'} project=${input.projectName || 'unknown'} conversationId=${message.conversationId} title=${input.conversationTitle} state=${message.state} kind=${summary.kind}: ${summary.text}`,
      )
      markMeaningfulActivity('conversation_reply', { cancelPendingHangup: true })
      flashCoordinator?.appendSilentContext(
        'TASK_EVENT',
        JSON.stringify({
          projectId: input.projectId,
          projectName: input.projectName,
          conversationId: message.conversationId,
          conversationTitle: input.conversationTitle,
          kind: summary.kind,
          requiresUserResponse: summary.requiresUserResponse,
          text: summary.text,
        }),
      )
      upstream?.injectConversationMessage({
        projectId: input.projectId,
        projectName: input.projectName,
        conversationId: message.conversationId,
        conversationTitle: input.conversationTitle,
        message: summary.text,
        state: message.state,
        eventKind: summary.kind,
        requiresUserResponse: summary.requiresUserResponse,
        shouldSpeak: summary.kind !== 'progress',
      })
    })
    conversationUnsubscribers.set(input.conversationId, unsubscribe)
  }
  const requestHangUp = (
    reason?: string,
    delayMs = HANG_UP_AFTER_PLAYBACK_DELAY_MS,
    options?: { waitForFuturePlayback?: boolean; suppressFurtherModelResponses?: boolean },
  ) => {
    if (options?.suppressFurtherModelResponses) upstream?.beginTerminalHangUp()
    clearPendingHangUp()
    const hasActivePlayback = playbackResponseIds.size > 0 || Boolean(currentAudioResponseId)
    if (!hasActivePlayback && options?.waitForFuturePlayback === false) {
      sendHangUpNow(reason, delayMs)
      return
    }
    pendingHangUp = {
      reason,
      delayMs,
      playbackStarted: hasActivePlayback,
      fallbackTimer: null,
    }
    pendingHangUp.fallbackTimer = setTimeout(() => {
      if (!pendingHangUp || closed) return
      request.log?.warn?.(
        {
          conversationId,
          reason: pendingHangUp.reason,
          fallbackMs: HANG_UP_FALLBACK_MS,
        },
        'voice chief deferred hang up fallback reached',
      )
      pendingHangUp.playbackStarted = true
      maybeSendPendingHangUpAfterPlayback('fallback', true)
    }, HANG_UP_FALLBACK_MS)
    pendingHangUp.fallbackTimer.unref?.()
    request.log?.info(
      {
        conversationId,
        reason,
        delayMs,
        hasPendingPlayback: playbackResponseIds.size > 0 || Boolean(currentAudioResponseId),
        fallbackMs: HANG_UP_FALLBACK_MS,
      },
      'voice chief hang up deferred until playback completes',
    )
    maybeSendPendingHangUpAfterPlayback('request')
  }

  const publishToolResult = (result: unknown) => {
    const statusResult = result as {
      status?: string
      message?: string
      projectId?: string
      projectName?: string
      conversationId?: string
      conversationIds?: string[]
      conversationTitle?: string
    }
    for (const targetConversationId of statusResult.conversationIds ?? []) {
      const targetProject = projects.find((project) =>
        project.conversations.some(
          (candidate) => candidate.conversationId === targetConversationId,
        ),
      )
      const targetConversation = targetProject?.conversations.find(
        (candidate) => candidate.conversationId === targetConversationId,
      )
      if (!targetProject || !targetConversation) continue
      subscribeConversation({
        conversationId: targetConversationId,
        projectId: targetProject.projectId,
        projectName: targetProject.displayName,
        conversationTitle: targetConversation.title,
      })
    }
    if (statusResult.conversationId) {
      subscribeConversation({
        conversationId: statusResult.conversationId,
        projectId: statusResult.projectId ?? '',
        projectName: statusResult.projectName ?? '',
        conversationTitle: statusResult.conversationTitle ?? statusResult.conversationId,
      })
    }
    if (!statusResult.status || !statusResult.message) return
    recordCallContext(
      '任务状态',
      `status=${statusResult.status} projectId=${statusResult.projectId ?? ''} project=${statusResult.projectName ?? ''} conversationId=${statusResult.conversationId ?? ''} title=${statusResult.conversationTitle ?? ''}: ${statusResult.message}`,
    )
    sendVoiceChiefJson(socket, {
      type: 'operation_status',
      status: statusResult.status as never,
      message: statusResult.message,
      ...(statusResult.projectId ? { projectId: statusResult.projectId } : {}),
      ...(statusResult.projectName ? { projectName: statusResult.projectName } : {}),
      ...(statusResult.conversationId ? { conversationId: statusResult.conversationId } : {}),
      ...(statusResult.conversationTitle
        ? { conversationTitle: statusResult.conversationTitle }
        : {}),
    })
  }

  const executeCallToolOnce = async (call: {
    callId: string
    operationId?: string
    name: string
    argumentsJson: string
  }): Promise<unknown> => {
    if (completedCalls.has(call.callId)) return completedCalls.get(call.callId)
    const existing = inFlightToolCalls.get(call.callId)
    if (existing) return existing
    const executionPromise = (async (): Promise<unknown> => {
      const execution = await executeVoiceChiefCallTool({
        name: call.name,
        argumentsJson: call.argumentsJson,
        userId,
        chiefConversationId: conversationId,
        voiceCallId: conversationId,
        callId: call.callId,
        operationId: call.operationId,
        projects,
      })
      projects = execution.projects
      completedCalls.set(call.callId, execution.result)
      publishToolResult(execution.result)
      if (execution.effect.type === 'hang_up_now') {
        requestHangUp(execution.effect.reason, HANG_UP_AFTER_PLAYBACK_DELAY_MS, {
          waitForFuturePlayback: false,
          suppressFurtherModelResponses: true,
        })
      }
      return execution.result
    })()
    inFlightToolCalls.set(call.callId, executionPromise)
    try {
      return await executionPromise
    } finally {
      if (inFlightToolCalls.get(call.callId) === executionPromise) {
        inFlightToolCalls.delete(call.callId)
      }
    }
  }

  const executeFlashTool = async (call: {
    callId: string
    operationId: string
    name: string
    argumentsJson: string
  }) => {
    return executeVoiceChiefV5Tool(call, executeCallToolOnce)
  }
  const executeFlashHandoff = (call: { callId: string; argumentsJson: string }) => {
    const delegateArguments = parseVoiceChiefDelegateArguments(call.argumentsJson)
    if (!flashCoordinator || (!lastFinalInputTranscript.trim() && !delegateArguments.intent)) {
      upstream?.sendFunctionOutput(call.callId, {
        status: 'failed',
        message: '协作者上下文尚未就绪，请稍后重试。',
      })
      return
    }
    const userText = lastFinalInputTranscript
    const accepted = {
      status: 'accepted',
      processing: true,
    }
    completedCalls.set(call.callId, accepted)
    upstream?.sendFunctionOutput(call.callId, accepted)
    if (lastFinalInputTranscript === userText) lastFinalInputTranscript = ''

    const running = delegateQueue.then(async () => {
      if (closed || !flashCoordinator) return
      try {
        const outcome = await flashCoordinator.handleUserTurn(userText, {
          inputAlreadySynced: true,
          realtimeIntent: delegateArguments.intent,
        })
        if (closed || outcome.status === 'interrupted') return
        upstream?.injectDelegateResult({
          result: buildVoiceChiefV5FinalResult(outcome),
        })
      } catch (error) {
        request.log?.warn?.({ conversationId, error }, 'voice flash handoff failed')
        upstream?.injectDelegateResult({
          result: {
            status: 'failed',
            message: '这次没处理成功，你可以稍后再让我试一次。',
            requiresUserResponse: false,
            backgroundRunning: false,
          },
        })
      }
    })
    delegateQueue = running.catch(() => undefined)
  }

  const executeFunctionCall = async (call: {
    callId: string
    name: string
    argumentsJson: string
  }) => {
    request.log?.info(
      { conversationId, callId: call.callId, tool: call.name },
      'voice shennian function call received',
    )
    recordCallContext('工具调用', call.name)
    markMeaningfulActivity('function_call')
    if (debugTools) {
      sendVoiceChiefJson(socket, {
        type: 'tool_call',
        call: { ...call, createdAt: new Date().toISOString() },
      })
    }
    if (call.name === DELEGATE_TOOL.name) {
      if (completedCalls.has(call.callId)) {
        upstream?.sendFunctionOutput(call.callId, completedCalls.get(call.callId), {
          createResponse: false,
        })
      } else {
        executeFlashHandoff(call)
      }
      return
    }
    if (!isVoiceChiefExecutableTool(call.name)) {
      upstream?.sendFunctionOutput(call.callId, {
        status: 'failed',
        message: `不支持的工具：${call.name}`,
      })
      return
    }
    try {
      const result = await executeCallToolOnce(call)
      const modelResult = sanitizeVoiceTaskResult(result)
      if (call.name === HANG_UP_CALL_TOOL.name) {
        upstream?.sendFunctionOutput(call.callId, modelResult, { createResponse: false })
      } else {
        upstream?.sendFunctionOutput(call.callId, modelResult)
      }
    } catch (error) {
      const result = {
        status: 'failed' as const,
        message: error instanceof Error ? error.message : String(error),
      }
      completedCalls.set(call.callId, result)
      upstream?.sendFunctionOutput(call.callId, result)
    }
  }

  const start = async (frame: Extract<VoiceChiefClientFrame, { type: 'start' }>) => {
    if (frame.incomingCallId) {
      const intent = await loadVoiceIncomingCallIntentContext(userId, frame.incomingCallId).catch((error) => {
        request.log?.warn?.(
          { conversationId, callId: frame.incomingCallId, error },
          'voice incoming call intent context load failed',
        )
        return null
      })
      if (intent) {
        frame = {
          ...frame,
          incomingCallId: intent.callId,
          reason: intent.reason ?? undefined,
          initialPrompt: intent.initialPrompt ?? undefined,
          projectHint: intent.projectHint ?? undefined,
        }
      }
    }
    debugTools = Boolean(frame.debugTools)
    const hasIncomingCall = Boolean(frame.incomingCallId || frame.initialPrompt || frame.reason)
    projects = await loadVoiceChiefProjects(userId)
    const attentionSnapshot = buildVoiceChiefV5AttentionSnapshot(projects)
    const currentDatetimeContext = buildVoiceChiefCurrentDatetimeContext(frame.timeZone)
    previousCallSnapshot = await loadVoiceChiefPreviousCallContext(userId).catch((error) => {
      request.log?.warn?.(
        { conversationId, error },
        'voice chief previous call context load failed',
      )
      return { context: '', updatedAt: null }
    })
    userPreferences = await loadVoiceChiefUserPreferences(userId).catch((error) => {
      request.log?.warn?.({ conversationId, error }, 'voice chief preferences load failed')
      return {
        voice: normalizeVoiceChiefVoice(process.env.VOICE_CHIEF_VOICE) ?? VOICE_CHIEF_DEFAULT_VOICE,
      }
    })
    const briefs = taskProjectBriefs(projects)
    const model = process.env.VOICE_CHIEF_REALTIME_MODEL?.trim()
    const voice =
      normalizeVoiceChiefVoice(frame.voice) ??
      userPreferences.voice ??
      normalizeVoiceChiefVoice(process.env.VOICE_CHIEF_VOICE) ??
      VOICE_CHIEF_DEFAULT_VOICE
    const turnDetection =
      process.env.VOICE_CHIEF_TURN_DETECTION === 'smart_turn' ? 'smart_turn' : 'server_vad'
    const instructions = appendIncomingCallInstructions(
      buildVoiceChiefRealtimeFlashInstructions(''),
      frame,
    )
    flashCoordinator = new VoiceChiefFlashCoordinator({
      apiKey,
      instructions: buildVoiceChiefFlashInstructions(''),
      workspaceSnapshot: buildVoiceChiefV5WorkspaceSnapshot(projects),
      tools: VOICE_SHENNIAN_V5_TASK_TOOLS,
      executeTool: executeFlashTool,
      traceContext: { callId: conversationId, userId, realtimeInstructions: instructions },
    })
    flashCoordinator.seedPreviousCallContext(previousCallSnapshot.context)
    if (attentionSnapshot.context) {
      flashCoordinator.appendSilentContext('CALL_ATTENTION_SNAPSHOT', attentionSnapshot.context)
    }
    flashCoordinator.appendSilentContext('CALL_CURRENT_DATETIME', currentDatetimeContext)
    const attentionConversationIds = new Set(
      attentionSnapshot.items.map((item) => item.conversationId),
    )
    const eventSubscriptions = projects
      .flatMap((project) =>
        project.conversations.map((conversation) => ({ project, conversation })),
      )
      .filter(
        ({ conversation }) =>
          attentionConversationIds.has(conversation.conversationId) ||
          Boolean(conversation.runPhase || conversation.canStop),
      )
      .sort(
        (left, right) =>
          Date.parse(right.conversation.lastActivityAt) -
          Date.parse(left.conversation.lastActivityAt),
      )
      .slice(0, MAX_TASK_EVENT_SUBSCRIPTIONS)
    for (const { project, conversation } of eventSubscriptions) {
      subscribeConversation({
        conversationId: conversation.conversationId,
        projectId: project.projectId,
        projectName: project.displayName,
        conversationTitle: conversation.title,
      })
    }
    if (frame.incomingCallId || frame.initialPrompt || frame.reason) {
      recordCallContext(
        '来电上下文',
        `incomingCallId=${frame.incomingCallId ?? ''} reason=${frame.reason ?? ''} initialPrompt=${frame.initialPrompt ?? ''}`,
      )
    }
    request.log?.info(
      {
        conversationId,
        projects: briefs.length,
        model: model || 'qwen-audio-3.0-realtime-plus',
        voice,
        turnDetection,
        hasProjectHint: Boolean(frame.projectHint),
        hasIncomingCall,
      },
      'voice chief provider connecting',
    )
    upstream = new QwenAudioRealtimeClient({
      apiKey,
      workspaceId: process.env.DASHSCOPE_REALTIME_WORKSPACE_ID?.trim(),
      model,
      voice,
      instructions,
      tools: [DELEGATE_TOOL, HANG_UP_CALL_TOOL],
      turnDetection,
      callbacks: {
        onReady: () => {
          request.log?.info({ conversationId }, 'voice chief provider ready')
          sendVoiceChiefJson(socket, {
            type: 'ready',
            conversationId,
            inputSampleRate: QWEN_AUDIO_REALTIME_INPUT_SAMPLE_RATE,
            outputSampleRate: QWEN_AUDIO_REALTIME_OUTPUT_SAMPLE_RATE,
            projects: briefs,
          })
          sendVoiceChiefJson(socket, { type: 'status', state: 'listening' })
          markMeaningfulActivity('ready')
          upstream?.createResponseFromUserText(
            buildVoiceChiefCallOpeningUserText(frame, {
              previousCallContext: previousCallSnapshot.context,
              attentionSnapshot: attentionSnapshot.context,
              currentDatetimeContext,
            }),
          )
        },
        onStatus: (state) => {
          request.log?.info({ conversationId, state }, 'voice chief provider status')
          sendVoiceChiefJson(socket, { type: 'status', state })
        },
        onInputTranscript: (text, final) => {
          if (final)
            request.log?.info(
              { conversationId, characters: text.length },
              'voice chief input transcript completed',
            )
          if (final && text.trim()) {
            lastFinalInputTranscript = text.trim()
            flashCoordinator?.appendPhoneTranscript(
              'user',
              text,
              transcriptState.nextInputEventId(),
            )
            recordCallContext('用户', text)
            markMeaningfulActivity('user_input_transcript', { cancelPendingHangup: true })
          }
          sendVoiceChiefJson(socket, { type: 'input_transcript', text, final })
        },
        onInputSpeechStarted: () => {
          request.log?.info({ conversationId }, 'voice chief user speech started')
          markMeaningfulActivity('user_speech_started', { cancelPendingHangup: true })
        },
        onOutputTranscript: (text, final, responseId) => {
          if (!final) transcriptState.appendOutputDelta(responseId, text)
          if (final)
            request.log?.info(
              { conversationId, responseId, characters: text.length },
              'voice chief output transcript completed',
            )
          if (final && text.trim()) {
            const completed = transcriptState.completeOutput(responseId, text)
            if (completed) {
              flashCoordinator?.appendPhoneTranscript(
                'assistant',
                completed.text,
                completed.eventId,
              )
              recordCallContext('神念', completed.text)
            }
            markMeaningfulActivity('assistant_output_transcript')
          }
          sendVoiceChiefJson(socket, { type: 'output_transcript', text, final, responseId })
        },
        onAudio: (responseId, chunk) => {
          if (currentAudioResponseId !== responseId) {
            currentAudioResponseId = responseId
            playbackResponseIds.add(responseId)
            if (pendingHangUp) pendingHangUp.playbackStarted = true
            outputChunkCount = 0
            outputByteCount = 0
            request.log?.info({ conversationId, responseId }, 'voice chief model audio started')
            markMeaningfulActivity('assistant_audio_started')
            sendVoiceChiefJson(socket, {
              type: 'audio_start',
              responseId,
              sampleRate: QWEN_AUDIO_REALTIME_OUTPUT_SAMPLE_RATE,
            })
          }
          outputChunkCount += 1
          outputByteCount += chunk.byteLength
          if (outputChunkCount === 1 || outputChunkCount % 25 === 0) {
            request.log?.info(
              {
                conversationId,
                responseId,
                chunks: outputChunkCount,
                bytes: outputByteCount,
                chunkBytes: chunk.byteLength,
              },
              'voice chief model audio streaming',
            )
          }
          sendVoiceChiefAudio(socket, chunk)
        },
        onAudioDone: (responseId) => {
          request.log?.info(
            {
              conversationId,
              responseId,
              chunks: outputChunkCount,
              bytes: outputByteCount,
            },
            'voice chief model audio completed',
          )
          sendVoiceChiefJson(socket, { type: 'audio_done', responseId })
          if (currentAudioResponseId === responseId) currentAudioResponseId = null
        },
        onInterrupted: (responseId) => {
          request.log?.info({ conversationId, responseId }, 'voice chief model audio interrupted')
          const interrupted = transcriptState.interruptOutput(responseId)
          if (interrupted) {
            flashCoordinator?.appendPhoneTranscript(
              'assistant',
              interrupted.text,
              interrupted.eventId,
            )
            recordCallContext('神念（被打断）', interrupted.text)
          }
          if (responseId) sendVoiceChiefJson(socket, { type: 'audio_cancel', responseId })
          if (responseId) playbackResponseIds.delete(responseId)
          currentAudioResponseId = null
          maybeSendPendingHangUpAfterPlayback('audio_cancel')
        },
        onFunctionCall: (call) => void executeFunctionCall(call),
        onError: (error) => fail(error.code, error.message, error.recoverable),
      },
    })
    await upstream.connect()
  }

  startTimer = setTimeout(() => {
    if (!started && !closed) fail('start_timeout', '通话建立后未收到 start。')
  }, START_TIMEOUT_MS)
  if (maxCallMs !== null) {
    maxCallTimer = setTimeout(() => {
      if (!closed) {
        sendVoiceChiefJson(socket, { type: 'status', state: 'ended' })
        socket.close(4000, 'Maximum call duration reached')
      }
    }, maxCallMs)
  }

  socket.on('message', (raw: RawData, isBinary?: boolean) => {
    if (closed) return
    if (isBinary) {
      if (!started || !upstream) {
        fail('audio_before_start', '收到音频时通话尚未就绪。')
        return
      }
      const frame = voiceChiefRawDataToBuffer(raw)
      if (frame.byteLength === 0 || frame.byteLength > MAX_AUDIO_FRAME_BYTES) {
        fail('invalid_audio_frame', `音频帧大小无效：${frame.byteLength}`)
        return
      }
      inputFrameCount += 1
      inputByteCount += frame.byteLength
      for (let offset = 0; offset + 1 < frame.byteLength; offset += 2) {
        const sample = frame.readInt16LE(offset) / 32_768
        const absolute = Math.abs(sample)
        inputLevelSquareSum += sample * sample
        inputLevelSamples += 1
        if (absolute > inputLevelPeak) inputLevelPeak = absolute
      }
      if (inputFrameCount === 1 || inputFrameCount % 25 === 0) {
        const rms = inputLevelSamples > 0 ? Math.sqrt(inputLevelSquareSum / inputLevelSamples) : 0
        request.log?.info(
          {
            conversationId,
            frames: inputFrameCount,
            bytes: inputByteCount,
            frameBytes: frame.byteLength,
            rms: Number(rms.toFixed(4)),
            peak: Number(inputLevelPeak.toFixed(4)),
          },
          'voice chief microphone audio received',
        )
        inputLevelSamples = 0
        inputLevelSquareSum = 0
        inputLevelPeak = 0
      }
      upstream.sendAudio(frame)
      return
    }
    const frame = parseVoiceChiefClientFrame(voiceChiefRawDataToBuffer(raw).toString('utf8'))
    if (!frame) {
      fail('invalid_frame', '无法解析通话控制消息。')
      return
    }
    if (frame.type === 'ping') {
      sendVoiceChiefJson(socket, { type: 'pong' })
      return
    }
    if (frame.type === 'start') {
      if (started) {
        fail('duplicate_start', '通话已经开始。')
        return
      }
      started = true
      request.log?.info({ conversationId }, 'voice chief start received')
      if (startTimer) clearTimeout(startTimer)
      startTimer = null
      sendVoiceChiefJson(socket, { type: 'status', state: 'connecting' })
      void start(frame).catch((error) => {
        fail('provider_connection_failed', error instanceof Error ? error.message : String(error))
      })
      return
    }
    if (frame.type === 'playback_complete') {
      request.log?.info(
        { conversationId, responseId: frame.responseId },
        'voice chief playback completed on client',
      )
      playbackResponseIds.delete(frame.responseId)
      if (frame.responseId === currentAudioResponseId) currentAudioResponseId = null
      maybeSendPendingHangUpAfterPlayback('playback_complete')
      markMeaningfulActivity('playback_complete')
      return
    }
    if (frame.type === 'end') {
      request.log?.info({ conversationId }, 'voice chief end received')
      recordCallContext('通话', '用户主动结束通话。')
      clearSilenceTimers()
      persistPreviousCallContext('client_end')
      sendVoiceChiefJson(socket, { type: 'status', state: 'ended' })
      socket.close(1000, 'Call ended')
      return
    }
  })
  socket.on('close', cleanup)
  socket.on('error', cleanup)
}

export async function voiceChiefWsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, request) => {
    handleVoiceChiefConnection(socket as unknown as VoiceChiefSocket, request)
  })
}
