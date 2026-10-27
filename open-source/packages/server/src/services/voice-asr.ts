// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-asr-ws.test.ts

import { randomUUID } from 'crypto'
import { WebSocket as WsWebSocket } from 'ws'

const DASHSCOPE_REALTIME_ASR_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
const DASHSCOPE_FUN_ASR_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/'
const DASHSCOPE_MODEL = process.env.VOICE_ASR_MODEL ?? 'fun-asr-realtime'
const DEFAULT_SAMPLE_RATE = 16_000
const DEFAULT_LANGUAGE_HINTS = ['zh']
const CONNECT_TIMEOUT_MS = 8_000
const UPSTREAM_IDLE_MS = 30_000

export type AsrProvider = 'dashscope'

export type AsrErrorCode =
  | 'unauthorized'
  | 'upstream_unavailable'
  | 'upstream_timeout'
  | 'upstream_failed'
  | 'bad_request'
  | 'internal_error'

export interface RealtimeAsrOptions {
  provider?: AsrProvider
  model?: string
  sampleRate?: number
  languageHints?: string[]
  onReady: () => void
  onPartial: (text: string) => void
  onFinal: (text: string, index: number) => void
  onEnd: (transcript: string) => void
  onError: (code: AsrErrorCode, message: string) => void
  onDebug?: (event: string, payload?: unknown) => void
}

export function getDefaultRealtimeAsrProvider(): AsrProvider {
  return 'dashscope'
}

export interface RealtimeAsrClient {
  sendAudio(frame: ArrayBuffer | Uint8Array | Buffer): void
  finish(): void
  close(reason?: string): void
  readonly closed: boolean
}

function getDashScopeApiKey(): string | null {
  const key = process.env.DASHSCOPE_API_KEY
  return key && key.trim() ? key.trim() : null
}

function normalizeLanguageHint(languageHints: string[]): string {
  const first = languageHints[0]?.trim().toLowerCase()
  if (!first) return 'zh'
  if (first.startsWith('zh')) return 'zh'
  if (first.startsWith('yue')) return 'yue'
  if (first.startsWith('en')) return 'en'
  if (first.startsWith('ja')) return 'ja'
  if (first.startsWith('de')) return 'de'
  if (first.startsWith('ko')) return 'ko'
  if (first.startsWith('ru')) return 'ru'
  if (first.startsWith('fr')) return 'fr'
  return first
}

function mapUpstreamErrorCode(code: string | undefined): AsrErrorCode {
  if (!code) return 'upstream_failed'
  const upper = code.toUpperCase()
  if (upper.includes('AUTH') || upper === 'INVALID_API_KEY' || upper.includes('TOKEN')) {
    return 'unauthorized'
  }
  if (upper.includes('TIMEOUT')) return 'upstream_timeout'
  return 'upstream_failed'
}

type DashScopeClientEvent =
  | {
      event_id: string
      type: 'session.update' | 'input_audio_buffer.append' | 'session.finish'
      audio?: string
      session?: {
        input_audio_format: 'pcm'
        sample_rate: number
        input_audio_transcription: {
          language: string
        }
        turn_detection: {
          type: 'server_vad'
          threshold: number
          silence_duration_ms: number
        }
      }
    }
  | {
      header: {
        action: 'run-task' | 'finish-task'
        task_id: string
        streaming: 'duplex'
      }
      payload: {
        task_group?: 'audio'
        task?: 'asr'
        function?: 'recognition'
        model?: string
        parameters?: {
          format: 'pcm'
          sample_rate: number
        }
        input: Record<string, never>
      }
    }

type DashScopeServerEvent =
  | {
      event_id?: string
      type: 'session.created' | 'session.updated' | 'session.finished'
    }
  | {
      event_id?: string
      type: 'conversation.item.input_audio_transcription.text'
      text?: string
      stash?: string
    }
  | {
      event_id?: string
      type: 'conversation.item.input_audio_transcription.completed'
      transcript?: string
    }
  | {
      event_id?: string
      type: 'conversation.item.input_audio_transcription.failed'
      error?: {
        code?: string
        message?: string
      }
    }
  | {
      event_id?: string
      type: 'error'
      error?: {
        code?: string
        message?: string
      }
    }
  | {
      event_id?: string
      type:
        | 'input_audio_buffer.speech_started'
        | 'input_audio_buffer.speech_stopped'
        | 'input_audio_buffer.committed'
        | 'conversation.item.created'
    }
  | {
      header?: {
        event?: 'task-started' | 'result-generated' | 'task-finished' | 'task-failed'
      }
      payload?: {
        output?: {
          sentence?: {
            text?: string
            sentence_end?: boolean
          }
        }
        error?: {
          code?: string
          message?: string
        }
      }
    }

type DashScopeRealtimeServerEvent = Extract<DashScopeServerEvent, { type: string }>
type DashScopeFunAsrServerEvent = Extract<DashScopeServerEvent, { header?: unknown }>

function hasDashScopeRealtimeType(event: DashScopeServerEvent): event is DashScopeRealtimeServerEvent {
  return typeof (event as { type?: unknown }).type === 'string'
}

function hasDashScopeFunAsrHeader(event: DashScopeServerEvent): event is DashScopeFunAsrServerEvent {
  return Boolean((event as { header?: unknown }).header)
}

function buildDashScopeSessionUpdateEvent(options: {
  sampleRate: number
  languageHints: string[]
}): DashScopeClientEvent {
  return {
    event_id: randomUUID(),
    type: 'session.update',
    session: {
      input_audio_format: 'pcm',
      sample_rate: options.sampleRate,
      input_audio_transcription: {
        language: normalizeLanguageHint(options.languageHints),
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.45,
        silence_duration_ms: 700,
      },
    },
  }
}

function buildDashScopeAppendAudioEvent(frame: Uint8Array): DashScopeClientEvent {
  return {
    event_id: randomUUID(),
    type: 'input_audio_buffer.append',
    audio: Buffer.from(frame).toString('base64'),
  }
}

function buildDashScopeSessionFinishEvent(): DashScopeClientEvent {
  return {
    event_id: randomUUID(),
    type: 'session.finish',
  }
}

function buildFunAsrRunTaskEvent(options: {
  taskId: string
  model: string
  sampleRate: number
}): DashScopeClientEvent {
  return {
    header: {
      action: 'run-task',
      task_id: options.taskId,
      streaming: 'duplex',
    },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: options.model,
      parameters: {
        format: 'pcm',
        sample_rate: options.sampleRate,
      },
      input: {},
    },
  }
}

function buildFunAsrFinishTaskEvent(taskId: string): DashScopeClientEvent {
  return {
    header: {
      action: 'finish-task',
      task_id: taskId,
      streaming: 'duplex',
    },
    payload: {
      input: {},
    },
  }
}

function createClosedClient(options: RealtimeAsrOptions, message: string): RealtimeAsrClient {
  queueMicrotask(() => options.onError('upstream_unavailable', message))
  return {
    sendAudio: () => {},
    finish: () => {},
    close: () => {},
    closed: true,
  }
}

function createBaseClient(
  configure: (helpers: {
    setReady: () => void
    emitPartial: (text: string) => void
    emitFinal: (text: string) => void
    emitEnd: () => void
    emitError: (code: AsrErrorCode, message: string) => void
    onStateClosed: () => boolean
  }) => {
    sendAudioFrame: (frame: Uint8Array) => void
    sendFinish: () => void
    closeSocket: () => void
  },
  options: RealtimeAsrOptions,
): RealtimeAsrClient {
  let state: 'connecting' | 'ready' | 'finishing' | 'closed' = 'connecting'
  const pending: Uint8Array[] = []
  const finalSegments: string[] = []
  let finalIndex = 0

  const helpers = {
    setReady() {
      if (state === 'ready' || state === 'finishing' || state === 'closed') return
      state = 'ready'
      options.onReady()
      while (pending.length > 0) {
        const frame = pending.shift()!
        transport.sendAudioFrame(frame)
      }
    },
    emitPartial(text: string) {
      if (text) options.onPartial(text)
    },
    emitFinal(text: string) {
      const final = text.trim()
      if (!final) return
      if (finalSegments.length === 0) {
        finalSegments.push(final)
      } else {
        const joined = finalSegments.join('')
        if (final.startsWith(joined)) {
          finalSegments.splice(0, finalSegments.length, final)
        } else {
          finalSegments.push(final)
        }
      }
      options.onFinal(final, finalIndex)
      finalIndex += 1
    },
    emitEnd() {
      options.onEnd(finalSegments.join('').trim())
    },
    emitError(code: AsrErrorCode, message: string) {
      options.onError(code, message)
    },
    onStateClosed() {
      return state === 'closed'
    },
  }

  const transport = configure(helpers)

  return {
    sendAudio(frame) {
      if (state === 'closed' || state === 'finishing') return
      let view: Uint8Array
      if (frame instanceof Uint8Array) {
        view = frame
      } else if (frame instanceof ArrayBuffer) {
        view = new Uint8Array(frame)
      } else {
        const buf = frame as Buffer
        view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      }
      if (state === 'connecting') {
        pending.push(view)
        return
      }
      transport.sendAudioFrame(view)
    },
    finish() {
      if (state === 'closed' || state === 'finishing') return
      state = 'finishing'
      transport.sendFinish()
    },
    close() {
      if (state === 'closed') return
      state = 'closed'
      transport.closeSocket()
    },
    get closed() {
      return state === 'closed'
    },
  }
}

export function createDashScopeRealtimeAsrClient(options: RealtimeAsrOptions): RealtimeAsrClient {
  const apiKey = getDashScopeApiKey()
  if (!apiKey) return createClosedClient(options, 'DASHSCOPE_API_KEY not configured')

  const model = options.model ?? DASHSCOPE_MODEL
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
  const languageHints =
    options.languageHints && options.languageHints.length > 0
      ? options.languageHints
      : DEFAULT_LANGUAGE_HINTS
  const useFunAsr = model === 'fun-asr-realtime'

  return createBaseClient((helpers) => {
    let idleTimer: NodeJS.Timeout | null = null
    let connectTimer: NodeJS.Timeout | null = null
    let accumulatedText = ''
    const taskId = randomUUID()

    const url = useFunAsr
      ? DASHSCOPE_FUN_ASR_URL
      : `${DASHSCOPE_REALTIME_ASR_URL}?model=${encodeURIComponent(model)}`
    const ws = new WsWebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-DashScope-DataInspection': 'disable',
        'user-agent': 'shennian-voice-asr/1.0',
      },
      perMessageDeflate: false,
    })

    function clearTimers() {
      if (idleTimer) clearTimeout(idleTimer)
      if (connectTimer) clearTimeout(connectTimer)
      idleTimer = null
      connectTimer = null
    }

    function kickIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (helpers.onStateClosed()) return
        helpers.emitError('upstream_timeout', 'upstream idle timeout')
        try {
          ws.close()
        } catch {
          // noop
        }
      }, UPSTREAM_IDLE_MS)
    }

    connectTimer = setTimeout(() => {
      if (helpers.onStateClosed()) return
      helpers.emitError('upstream_timeout', 'upstream connect timeout')
      try {
        ws.close()
      } catch {
        // noop
      }
    }, CONNECT_TIMEOUT_MS)

    ws.on('open', () => {
      if (connectTimer) {
        clearTimeout(connectTimer)
        connectTimer = null
      }
      try {
        const startEvent = useFunAsr
          ? buildFunAsrRunTaskEvent({ taskId, model, sampleRate })
          : buildDashScopeSessionUpdateEvent({ sampleRate, languageHints })
        ws.send(JSON.stringify(startEvent))
        kickIdleTimer()
      } catch (error) {
        helpers.emitError('upstream_unavailable', (error as Error).message)
        try {
          ws.close()
        } catch {
          // noop
        }
      }
    })

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return
      let event: DashScopeServerEvent
      try {
        event = JSON.parse(raw.toString('utf8')) as DashScopeServerEvent
      } catch {
        return
      }
      kickIdleTimer()

      if (hasDashScopeRealtimeType(event)) {
        switch (event.type) {
          case 'session.created':
            return
          case 'session.updated':
            helpers.setReady()
            return
          case 'conversation.item.input_audio_transcription.text':
            helpers.emitPartial(`${event.text ?? ''}${event.stash ?? ''}`.trim())
            return
          case 'conversation.item.input_audio_transcription.completed':
            helpers.emitFinal(typeof event.transcript === 'string' ? event.transcript : '')
            return
          case 'conversation.item.input_audio_transcription.failed':
            helpers.emitError(
              mapUpstreamErrorCode(event.error?.code),
              event.error?.message ?? 'upstream transcription failed',
            )
            try {
              ws.close()
            } catch {
              // noop
            }
            return
          case 'session.finished':
            helpers.emitEnd()
            try {
              ws.close()
            } catch {
              // noop
            }
            return
          case 'error':
            helpers.emitError(
              mapUpstreamErrorCode(event.error?.code),
              event.error?.message ?? 'upstream task failed',
            )
            try {
              ws.close()
            } catch {
              // noop
            }
            return
          default:
            break
        }
      }

      if (!hasDashScopeFunAsrHeader(event)) return
      switch (event.header?.event) {
        case 'task-started':
          helpers.setReady()
          return
        case 'result-generated': {
          const sentence = event.payload?.output?.sentence
          const text = sentence?.text ?? ''
          if (!text) return
          if (sentence?.sentence_end) {
            accumulatedText += text
            helpers.emitFinal(accumulatedText)
          } else {
            helpers.emitPartial(`${accumulatedText}${text}`.trim())
          }
          return
        }
        case 'task-finished':
          helpers.emitEnd()
          try {
            ws.close()
          } catch {
            // noop
          }
          return
        case 'task-failed':
          helpers.emitError(
            mapUpstreamErrorCode(event.payload?.error?.code),
            event.payload?.error?.message ?? 'upstream task failed',
          )
          try {
            ws.close()
          } catch {
            // noop
          }
          return
        default:
          return
      }
    })

    ws.on('error', (error) => {
      if (helpers.onStateClosed()) return
      helpers.emitError('upstream_unavailable', error.message || 'upstream error')
      clearTimers()
    })

    ws.on('close', (code) => {
      if (helpers.onStateClosed()) return
      helpers.emitError('upstream_unavailable', `upstream closed (${code})`)
      clearTimers()
    })

    return {
      sendAudioFrame(frame) {
        try {
          if (useFunAsr) {
            ws.send(frame)
          } else {
            ws.send(JSON.stringify(buildDashScopeAppendAudioEvent(frame)))
          }
          kickIdleTimer()
        } catch (error) {
          helpers.emitError('internal_error', (error as Error).message)
          try {
            ws.close()
          } catch {
            // noop
          }
        }
      },
      sendFinish() {
        try {
          ws.send(
            JSON.stringify(useFunAsr ? buildFunAsrFinishTaskEvent(taskId) : buildDashScopeSessionFinishEvent()),
          )
        } catch (error) {
          helpers.emitError('internal_error', (error as Error).message)
          try {
            ws.close()
          } catch {
            // noop
          }
        }
      },
      closeSocket() {
        clearTimers()
        try {
          ws.close()
        } catch {
          // noop
        }
      },
    }
  }, options)
}

export function createRealtimeAsrClient(options: RealtimeAsrOptions): RealtimeAsrClient {
  return createDashScopeRealtimeAsrClient({ ...options, provider: 'dashscope' })
}
