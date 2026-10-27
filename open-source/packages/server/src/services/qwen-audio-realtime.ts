// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-realtime.test.ts

import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

export const QWEN_AUDIO_REALTIME_DEFAULT_MODEL = 'qwen-audio-3.0-realtime-plus'
export const QWEN_AUDIO_REALTIME_INPUT_SAMPLE_RATE = 16_000 as const
export const QWEN_AUDIO_REALTIME_OUTPUT_SAMPLE_RATE = 24_000 as const
export const QWEN_AUDIO_REALTIME_DEFAULT_VAD_SILENCE_MS = 450 as const

export type VoiceChiefToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type QwenAudioRealtimeCallbacks = {
  onReady?: () => void
  onStatus?: (state: 'listening' | 'thinking' | 'speaking') => void
  onInputSpeechStarted?: () => void
  onInputTranscript?: (text: string, final: boolean) => void
  onOutputTranscript?: (text: string, final: boolean, responseId?: string) => void
  onAudio?: (responseId: string, chunk: Uint8Array) => void
  onAudioDone?: (responseId: string) => void
  onInterrupted?: (responseId: string | null) => void
  onFunctionCall?: (call: { callId: string; name: string; argumentsJson: string }) => void
  onResponseDone?: (responseId: string | null) => void
  onError?: (error: { code: string; message: string; recoverable: boolean }) => void
}

type SocketLike = {
  readonly readyState: number
  on(event: 'open', listener: () => void): unknown
  on(event: 'message', listener: (data: WebSocket.RawData) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number, reason: Buffer) => void): unknown
  send(data: string): void
  close(code?: number, reason?: string): void
}

type QwenServerEvent = {
  type?: string
  event_id?: string
  response_id?: string
  call_id?: string
  name?: string
  arguments?: string
  delta?: string
  transcript?: string
  error?: { code?: string; message?: string }
  response?: { id?: string; status?: string; status_details?: unknown }
}

export type QwenAudioRealtimeOptions = {
  apiKey: string
  workspaceId?: string
  model?: string
  voice?: string
  instructions: string
  tools: VoiceChiefToolDefinition[]
  callbacks?: QwenAudioRealtimeCallbacks
  createSocket?: (url: string, headers: Record<string, string>) => SocketLike
  connectTimeoutMs?: number
  turnDetection?: 'server_vad' | 'smart_turn'
}

export function qwenAudioRealtimeUrl(options: { workspaceId?: string; model?: string }): string {
  const model = encodeURIComponent(options.model || QWEN_AUDIO_REALTIME_DEFAULT_MODEL)
  const override = process.env.VOICE_CHIEF_REALTIME_URL?.trim()
  if (override) {
    const separator = override.includes('?') ? '&' : '?'
    return `${override}${separator}model=${model}`
  }
  if (options.workspaceId?.trim()) {
    return `wss://${options.workspaceId.trim()}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=${model}`
  }
  return `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${model}`
}

export function buildQwenSessionUpdate(options: {
  instructions: string
  voice?: string
  tools: VoiceChiefToolDefinition[]
  turnDetection?: 'server_vad' | 'smart_turn'
  includeAudioSessionConfig?: boolean
}) {
  const includeAudioSessionConfig = options.includeAudioSessionConfig ?? true
  return {
    event_id: randomUUID(),
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: options.instructions,
      ...(includeAudioSessionConfig
        ? {
            voice: options.voice || 'longanqian',
            input_audio_format: 'pcm',
            output_audio_format: 'pcm',
            turn_detection:
              options.turnDetection === 'smart_turn'
                ? {
                    type: 'smart_turn',
                  }
                : {
                    type: 'server_vad',
                    threshold: 0.2,
                    silence_duration_ms: QWEN_AUDIO_REALTIME_DEFAULT_VAD_SILENCE_MS,
                  },
          }
        : {}),
      tools: options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    },
  }
}

function toText(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function defaultSocket(url: string, headers: Record<string, string>): SocketLike {
  return new WebSocket(url, { headers })
}

function isBenignCancelRace(event: QwenServerEvent): boolean {
  return (
    event.error?.code === 'invalid_value' && /no active response/i.test(event.error.message || '')
  )
}

function isBenignManualResponseInProgress(event: QwenServerEvent): boolean {
  return /manual response is already in progress/i.test(event.error?.message || '')
}

function isBenignRealtimeRace(event: QwenServerEvent): boolean {
  return isBenignCancelRace(event) || isBenignManualResponseInProgress(event)
}

export class QwenAudioRealtimeClient {
  private socket: SocketLike | null = null
  private closed = false
  private ready = false
  private activeResponseId: string | null = null
  private responseInProgress = false
  private responseCreatePending = false
  private terminalHangUp = false
  private readonly audioStarted = new Set<string>()

  constructor(private readonly options: QwenAudioRealtimeOptions) {}

  async connect(): Promise<void> {
    if (this.socket) return
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      'X-DashScope-DataInspection': 'disable',
    }
    if (this.options.workspaceId?.trim()) {
      headers['X-DashScope-WorkSpace'] = this.options.workspaceId.trim()
    }
    const socket = (this.options.createSocket ?? defaultSocket)(
      qwenAudioRealtimeUrl(this.options),
      headers,
    )
    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('Qwen Audio Realtime connection timeout'))
        this.close()
      }, this.options.connectTimeoutMs ?? 10_000)

      socket.on('open', () => {
        this.send(
          buildQwenSessionUpdate({
            instructions: this.options.instructions,
            voice: this.options.voice,
            tools: this.options.tools,
            turnDetection: this.options.turnDetection,
          }),
        )
      })
      socket.on('message', (data) => {
        const event = this.parseEvent(toText(data))
        if (!event) return
        this.handleEvent(event)
        if (!settled && event.type === 'error' && !isBenignRealtimeRace(event)) {
          settled = true
          clearTimeout(timer)
          reject(
            new Error(
              event.error?.message || event.error?.code || 'Qwen Realtime rejected session',
            ),
          )
          this.close()
          return
        }
        if (!settled && event.type === 'session.updated') {
          settled = true
          clearTimeout(timer)
          resolve()
        }
      })
      socket.on('error', (error) => {
        this.emitError('upstream_error', error.message, true)
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(error)
        }
      })
      socket.on('close', (code, reason) => {
        const closedLocally = this.closed
        this.closed = true
        this.ready = false
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(
            new Error(`Qwen Audio Realtime closed before ready (${code} ${reason.toString()})`),
          )
        } else if (!closedLocally) {
          this.emitError(
            'upstream_closed',
            `Qwen Audio Realtime connection closed (${code} ${reason.toString()})`,
            true,
          )
        }
      })
    })
  }

  sendAudio(frame: Uint8Array): void {
    if (!this.ready || this.closed || frame.byteLength === 0) return
    this.send({
      event_id: randomUUID(),
      type: 'input_audio_buffer.append',
      audio: Buffer.from(frame).toString('base64'),
    })
  }

  cancelResponse(): void {
    if (!this.ready || this.closed || !this.activeResponseId) return
    const responseId = this.activeResponseId
    this.send({ event_id: randomUUID(), type: 'response.cancel' })
    this.options.callbacks?.onInterrupted?.(responseId)
    this.activeResponseId = null
  }

  createResponse(): void {
    if (!this.ready || this.closed || this.terminalHangUp) return
    if (this.responseInProgress) {
      this.responseCreatePending = true
      return
    }
    this.responseInProgress = true
    this.send({
      event_id: randomUUID(),
      type: 'response.create',
      response: { modalities: ['text', 'audio'] },
    })
  }

  createResponseFromUserText(text: string): void {
    if (!this.ready || this.closed || this.terminalHangUp) return
    const content = text.trim()
    if (!content) {
      this.createResponse()
      return
    }
    this.send({
      event_id: randomUUID(),
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: content }],
      },
    })
    this.createResponse()
  }

  updateInstructions(instructions: string): void {
    if (!this.ready || this.closed) return
    this.send(
      buildQwenSessionUpdate({
        instructions,
        voice: this.options.voice,
        tools: this.options.tools,
        turnDetection: this.options.turnDetection,
        includeAudioSessionConfig: false,
      }),
    )
  }

  sendFunctionOutput(
    callId: string,
    output: unknown,
    options?: { createResponse?: boolean },
  ): void {
    if (!this.ready || this.closed) return
    this.send({
      event_id: randomUUID(),
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: typeof output === 'string' ? output : JSON.stringify(output),
      },
    })
    if (options?.createResponse !== false) this.createResponse()
  }

  injectDelegateResult(input: {
    result: unknown
    shouldSpeak?: boolean
  }): void {
    if (!this.ready || this.closed) return
    const callId = `delegate_result_${randomUUID()}`
    this.send({
      event_id: randomUUID(),
      type: 'conversation.item.create',
      item: {
        type: 'function_call',
        call_id: callId,
        name: 'delegate_result',
        arguments: JSON.stringify({ background: true }),
      },
    })
    this.send({
      event_id: randomUUID(),
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: typeof input.result === 'string' ? input.result : JSON.stringify(input.result),
      },
    })
    if (input.shouldSpeak !== false) this.createResponse()
  }

  beginTerminalHangUp(): void {
    this.terminalHangUp = true
    this.responseCreatePending = false
  }

  injectConversationMessage(input: {
    projectId: string
    projectName: string
    conversationId: string
    conversationTitle: string
    message: string
    state?: string
    eventKind?: 'question' | 'failed' | 'completed' | 'progress'
    requiresUserResponse?: boolean
    shouldSpeak?: boolean
  }): void {
    if (!this.ready || this.closed) return
    const callId = `conversation_event_${randomUUID()}`
    this.send({
      event_id: randomUUID(),
      type: 'conversation.item.create',
      item: {
        type: 'function_call',
        call_id: callId,
        name: 'conversation_message',
        arguments: JSON.stringify({
          projectId: input.projectId,
          projectName: input.projectName,
          conversationId: input.conversationId,
          conversationTitle: input.conversationTitle,
          state: input.state ?? 'final',
          eventKind: input.eventKind ?? 'progress',
          requiresUserResponse: input.requiresUserResponse ?? false,
          shouldSpeak: input.shouldSpeak ?? true,
        }),
      },
    })
    this.send({
      event_id: randomUUID(),
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify({
          message: input.message,
          speech: { shouldSpeak: input.shouldSpeak ?? true },
        }),
      },
    })
    if (input.shouldSpeak !== false) this.createResponse()
  }

  injectManagerMessage(input: {
    projectId: string
    projectName: string
    managerSessionId: string
    message: string
  }): void {
    this.injectConversationMessage({
      projectId: input.projectId,
      projectName: input.projectName,
      conversationId: input.managerSessionId,
      conversationTitle: 'Manager',
      message: input.message,
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.ready = false
    this.responseInProgress = false
    this.responseCreatePending = false
    this.terminalHangUp = true
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'voice chief closed')
  }

  private parseEvent(text: string): QwenServerEvent | null {
    try {
      const event = JSON.parse(text) as QwenServerEvent
      return event && typeof event.type === 'string' ? event : null
    } catch {
      this.emitError('bad_upstream_event', 'Qwen Audio Realtime returned invalid JSON', true)
      return null
    }
  }

  private handleEvent(event: QwenServerEvent): void {
    switch (event.type) {
      case 'session.updated':
        this.ready = true
        this.options.callbacks?.onReady?.()
        this.options.callbacks?.onStatus?.('listening')
        return
      case 'input_audio_buffer.speech_started':
        this.options.callbacks?.onInputSpeechStarted?.()
        if (this.activeResponseId) this.cancelResponse()
        return
      case 'input_audio_buffer.speech_stopped':
        this.options.callbacks?.onStatus?.('thinking')
        return
      case 'conversation.item.input_audio_transcription.delta':
        this.options.callbacks?.onInputTranscript?.(event.delta ?? '', false)
        return
      case 'conversation.item.input_audio_transcription.completed':
        this.options.callbacks?.onInputTranscript?.(event.transcript ?? '', true)
        return
      case 'response.created': {
        const responseId = event.response?.id || event.response_id || randomUUID()
        this.responseInProgress = true
        this.activeResponseId = responseId
        this.options.callbacks?.onStatus?.('thinking')
        return
      }
      case 'response.audio.delta': {
        const responseId = event.response_id || this.activeResponseId || randomUUID()
        this.activeResponseId = responseId
        this.audioStarted.add(responseId)
        const chunk = event.delta ? Buffer.from(event.delta, 'base64') : Buffer.alloc(0)
        if (chunk.byteLength > 0) {
          this.options.callbacks?.onStatus?.('speaking')
          this.options.callbacks?.onAudio?.(responseId, chunk)
        }
        return
      }
      case 'response.audio.done': {
        const responseId = event.response_id || this.activeResponseId
        if (responseId) {
          this.options.callbacks?.onAudioDone?.(responseId)
          this.audioStarted.delete(responseId)
        }
        return
      }
      case 'response.audio_transcript.delta':
        this.options.callbacks?.onOutputTranscript?.(
          event.delta ?? '',
          false,
          event.response_id || this.activeResponseId || undefined,
        )
        return
      case 'response.audio_transcript.done':
        this.options.callbacks?.onOutputTranscript?.(
          event.transcript ?? '',
          true,
          event.response_id || this.activeResponseId || undefined,
        )
        return
      case 'response.function_call_arguments.done':
        if (event.call_id && event.name) {
          this.options.callbacks?.onFunctionCall?.({
            callId: event.call_id,
            name: event.name,
            argumentsJson: event.arguments || '{}',
          })
        }
        return
      case 'response.done': {
        const responseId = event.response?.id || event.response_id || this.activeResponseId
        this.options.callbacks?.onResponseDone?.(responseId)
        this.activeResponseId = null
        this.responseInProgress = false
        this.options.callbacks?.onStatus?.('listening')
        if (!this.terminalHangUp && this.responseCreatePending) {
          this.responseCreatePending = false
          this.createResponse()
        }
        return
      }
      case 'error':
        if (isBenignRealtimeRace(event)) return
        this.emitError(
          event.error?.code || 'upstream_error',
          event.error?.message || 'Qwen Audio Realtime error',
          false,
        )
        return
      default:
        return
    }
  }

  private send(payload: unknown): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN || this.closed) return
    socket.send(JSON.stringify(payload))
  }

  private emitError(code: string, message: string, recoverable: boolean) {
    this.options.callbacks?.onError?.({ code, message, recoverable })
  }
}
