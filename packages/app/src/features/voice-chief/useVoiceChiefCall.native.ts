// @arch docs/features/voice-shennian.md
// @test src/__tests__/voice-chief-audio.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Vibration } from 'react-native'
import { useAuthStore } from '../../config/auth'
import type { VoiceChiefServerFrame } from '@shennian/wire'
import { createPcmRecorder } from '../chat/audio/create-pcm-recorder'
import { notifyVoiceInputInterruption } from '../voice/voiceInputInterruption'
import { createPcmPlayer } from './audio/create-pcm-player'
import type { PcmOutputRoute } from './audio/pcm-player'
import { useAppIsActive } from './useAppIsActive'
import {
  loadVoiceChiefSubtitlePreference,
  saveVoiceChiefSubtitlePreference,
} from './subtitlePreference'
import { mergeVoiceChiefTranscript } from './transcript'
import { buildVoiceChiefUrl } from './voiceChiefUrl'

const HANG_UP_VIBRATION_PATTERN = [0, 35, 45, 35]
const VOICE_CHIEF_HEARTBEAT_MS = 15_000

export type VoiceChiefCallState =
  | 'connecting'
  | 'reconnecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'ended'
  | 'error'
export type VoiceChiefTranscript = {
  id: string
  role: 'user' | 'chief'
  text: string
  final: boolean
}
export type VoiceChiefOperationUpdate = Extract<VoiceChiefServerFrame, { type: 'operation_status' }>

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function logVoiceChief(event: string, details?: Record<string, unknown>) {
  if (!__DEV__ && !event.includes('error')) return
  if (details) console.info(`[voice-chief] ${event}`, details)
  else console.info(`[voice-chief] ${event}`)
}

function reconnectDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(attempt - 1, 0), 8_000)
}

function estimatePcm16Level(bytes: Uint8Array): number {
  if (bytes.byteLength < 2) return 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = Math.floor(bytes.byteLength / 2)
  let sumSquares = 0
  for (let index = 0; index < samples; index += 1) {
    const sample = view.getInt16(index * 2, true) / 32768
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / samples)
  return Math.min(1, Math.sqrt(rms) * 1.7)
}

function triggerHangUpFeedback(): void {
  Vibration.vibrate(HANG_UP_VIBRATION_PATTERN)
}

export function useVoiceChiefCall(options: {
  projectHint?: string
  incomingCallId?: string
  initialPrompt?: string
  reason?: string
}) {
  const token = useAuthStore((current) => current.token) || ''
  const [state, setState] = useState<VoiceChiefCallState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<VoiceChiefTranscript[]>([])
  const [operationUpdates, setOperationUpdates] = useState<VoiceChiefOperationUpdate[]>([])
  const [muted, setMuted] = useState(false)
  const [subtitles, setSubtitlesState] = useState(true)
  const [outputRoute, setOutputRouteState] = useState<PcmOutputRoute>('system')
  const [meterLevel, setMeterLevel] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef(
    createPcmRecorder({ sampleRate: 16_000, frameDurationMs: 40, voiceChat: true }),
  )
  const playerRef = useRef(createPcmPlayer())
  const responseIdRef = useRef<string | null>(null)
  const subtitleChangedRef = useRef(false)
  const mutedRef = useRef(false)
  const endedRef = useRef(false)
  const terminalCloseRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delayedHangupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const socketHeartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const outputRouteRef = useRef<PcmOutputRoute>('system')
  const socketReadyForAudioRef = useRef(false)
  const appIsActive = useAppIsActive()
  const appIsActiveRef = useRef(appIsActive)
  const lastMeterUpdateAtRef = useRef(0)

  useEffect(() => {
    appIsActiveRef.current = appIsActive
    lastMeterUpdateAtRef.current = 0
    if (!appIsActive) setMeterLevel(0)
  }, [appIsActive])

  const shouldPublishMeterLevel = useCallback(() => {
    if (!appIsActiveRef.current) return false
    const now = Date.now()
    if (now - lastMeterUpdateAtRef.current < 120) return false
    lastMeterUpdateAtRef.current = now
    return true
  }, [])

  const upsertTranscript = useCallback(
    (role: 'user' | 'chief', text: string, final: boolean, responseId?: string) => {
      setTranscripts((current) =>
        mergeVoiceChiefTranscript(current, { role, text, final, responseId }),
      )
    },
    [],
  )

  useEffect(() => {
    let active = true
    void loadVoiceChiefSubtitlePreference()
      .then((enabled) => {
        if (active && !subtitleChangedRef.current) setSubtitlesState(enabled)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const setSubtitles = useCallback((enabled: boolean) => {
    subtitleChangedRef.current = true
    setSubtitlesState(enabled)
    void saveVoiceChiefSubtitlePreference(enabled).catch(() => {})
  }, [])

  const end = useCallback(
    async (endOptions?: { feedback?: boolean }) => {
      if (endedRef.current) return
      endedRef.current = true
      terminalCloseRef.current = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (delayedHangupTimerRef.current) {
        clearTimeout(delayedHangupTimerRef.current)
        delayedHangupTimerRef.current = null
      }
      if (socketHeartbeatTimerRef.current) {
        clearInterval(socketHeartbeatTimerRef.current)
        socketHeartbeatTimerRef.current = null
      }
      const socket = socketRef.current
      socketRef.current = null
      socketReadyForAudioRef.current = false
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'end' }))
      socket?.close()
      await Promise.allSettled([
        recorderRef.current.stop(),
        playerRef.current.stop(),
      ])
      if (endOptions?.feedback) triggerHangUpFeedback()
      setMeterLevel(0)
      setState('ended')
    },
    [],
  )

  useEffect(() => {
    notifyVoiceInputInterruption('voice-chief-call-starting')
    endedRef.current = false
    terminalCloseRef.current = false
    socketReadyForAudioRef.current = false
    let disposed = false
    let latestSocketId = 0
    let inputFrameCount = 0
    let inputByteCount = 0
    let outputChunkCount = 0
    let outputByteCount = 0
    let missingResponseIdLogged = false
    const recorder = recorderRef.current
    const player = playerRef.current
    const clearReconnectTimer = () => {
      if (!reconnectTimerRef.current) return
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    const removeFrame = recorder.onFrame((frame) => {
      inputFrameCount += 1
      inputByteCount += frame.byteLength
      const socket = socketRef.current
      if (inputFrameCount === 1 || inputFrameCount % 25 === 0) {
        logVoiceChief('microphone_audio', {
          frames: inputFrameCount,
          bytes: inputByteCount,
          frameBytes: frame.byteLength,
          muted: mutedRef.current,
          socketState: socket?.readyState ?? WebSocket.CLOSED,
        })
      }
      if (shouldPublishMeterLevel()) setMeterLevel(mutedRef.current ? 0 : estimatePcm16Level(frame))
      if (
        !mutedRef.current &&
        socket?.readyState === WebSocket.OPEN &&
        socketReadyForAudioRef.current
      )
        socket.send(toArrayBuffer(frame))
    })
    const removeRecorderError = recorder.onError((reason) => {
      logVoiceChief('recorder_error', { message: reason.message })
      setError(reason.message)
      setState('error')
      void end()
    })
    const removePlayerError = player.onError((reason) => {
      logVoiceChief('player_error', { message: reason.message })
      setError(reason.message)
      setState('error')
      void end()
    })
    const removeComplete = player.onComplete((responseId) => {
      logVoiceChief('playback_complete', { responseId })
      if (responseIdRef.current === responseId) responseIdRef.current = null
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'playback_complete', responseId }))
    })

    const connectSocket = () => {
      if (disposed || endedRef.current) return
      clearReconnectTimer()
      const socketId = ++latestSocketId
      const socket = new WebSocket(buildVoiceChiefUrl(token))
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket
      socketReadyForAudioRef.current = false
      const stopHeartbeat = () => {
        if (!socketHeartbeatTimerRef.current) return
        clearInterval(socketHeartbeatTimerRef.current)
        socketHeartbeatTimerRef.current = null
      }
      logVoiceChief('socket_connecting', {
        attempt: reconnectAttemptRef.current + 1,
        hasProjectHint: Boolean(options.projectHint),
        hasIncomingCall: Boolean(options.incomingCallId || options.initialPrompt || options.reason),
      })

      const isCurrentSocket = () => socketRef.current === socket && socketId === latestSocketId
      const scheduleReconnect = (reason: string) => {
        if (disposed || endedRef.current || terminalCloseRef.current || !isCurrentSocket()) return
        const attempt = reconnectAttemptRef.current + 1
        reconnectAttemptRef.current = attempt
        const delayMs = reconnectDelayMs(attempt)
        responseIdRef.current = null
        socketReadyForAudioRef.current = false
        void player.flush()
        setError(null)
        setState('reconnecting')
        logVoiceChief('socket_reconnect_scheduled', { reason, attempt, delayMs })
        reconnectTimerRef.current = setTimeout(connectSocket, delayMs)
      }

      socket.onopen = () => {
        if (!isCurrentSocket()) return
        logVoiceChief('socket_open', { attempt: reconnectAttemptRef.current + 1 })
        socket.send(
          JSON.stringify({
            type: 'start',
            projectHint: options.projectHint,
            incomingCallId: options.incomingCallId,
            initialPrompt: options.initialPrompt,
            reason: options.reason,
            reconnectAttempt: reconnectAttemptRef.current,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        )
        stopHeartbeat()
        socketHeartbeatTimerRef.current = setInterval(() => {
          if (isCurrentSocket() && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          }
        }, VOICE_CHIEF_HEARTBEAT_MS)
      }
      socket.onmessage = (event) => {
        if (!isCurrentSocket()) return
        if (event.data instanceof ArrayBuffer) {
          const responseId = responseIdRef.current
          if (!responseId) {
            if (!missingResponseIdLogged) {
              missingResponseIdLogged = true
              logVoiceChief('audio_chunk_dropped_without_response', {
                bytes: event.data.byteLength,
              })
            }
            return
          }
          const chunk = new Uint8Array(event.data)
          if (shouldPublishMeterLevel()) setMeterLevel(estimatePcm16Level(chunk))
          outputChunkCount += 1
          outputByteCount += chunk.byteLength
          if (outputChunkCount === 1 || outputChunkCount % 25 === 0) {
            logVoiceChief('model_audio', {
              responseId,
              chunks: outputChunkCount,
              bytes: outputByteCount,
              chunkBytes: chunk.byteLength,
            })
          }
          void player.enqueue(responseId, chunk).catch((reason) => {
            const message = reason instanceof Error ? reason.message : String(reason)
            logVoiceChief('playback_enqueue_error', { responseId, message })
            setError(message)
            setState('error')
          })
          return
        }
        if (typeof event.data !== 'string') return
        let frame: VoiceChiefServerFrame
        try {
          frame = JSON.parse(event.data) as VoiceChiefServerFrame
        } catch {
          return
        }
        switch (frame.type) {
          case 'ready':
            reconnectAttemptRef.current = 0
            socketReadyForAudioRef.current = true
            setError(null)
            logVoiceChief('server_ready', {
              conversationId: frame.conversationId,
              projects: frame.projects.length,
              inputSampleRate: frame.inputSampleRate,
              outputSampleRate: frame.outputSampleRate,
            })
            void (async () => {
              try {
                const granted = await recorder.requestPermission()
                if (disposed || !isCurrentSocket()) return
                logVoiceChief('microphone_permission', { granted })
                if (!granted) throw new Error('microphone_permission_denied')
                await player.start(frame.outputSampleRate)
                if (disposed || !isCurrentSocket()) {
                  await player.stop()
                  return
                }
                logVoiceChief('player_prepared', { sampleRate: frame.outputSampleRate })
                await recorder.start()
                if (disposed || !isCurrentSocket()) {
                  await Promise.allSettled([recorder.stop(), player.stop()])
                  return
                }
                logVoiceChief('recorder_started', { sampleRate: frame.inputSampleRate })
                await player.setOutputRoute(outputRouteRef.current)
                if (disposed || !isCurrentSocket()) {
                  await Promise.allSettled([recorder.stop(), player.stop()])
                  return
                }
                logVoiceChief('output_route_set', { route: outputRouteRef.current })
                if (!disposed && isCurrentSocket()) setState('listening')
              } catch (reason) {
                if (disposed || !isCurrentSocket()) return
                const message = reason instanceof Error ? reason.message : String(reason)
                logVoiceChief('audio_start_error', { message })
                setError(message)
                setState('error')
              }
            })()
            break
          case 'status':
            logVoiceChief('server_status', { state: frame.state })
            if (frame.state === 'ended') terminalCloseRef.current = true
            setState(frame.state)
            break
          case 'audio_start':
            responseIdRef.current = frame.responseId
            missingResponseIdLogged = false
            outputChunkCount = 0
            outputByteCount = 0
            logVoiceChief('audio_start', {
              responseId: frame.responseId,
              sampleRate: frame.sampleRate,
            })
            setState('speaking')
            break
          case 'audio_done':
            logVoiceChief('audio_done', {
              responseId: frame.responseId,
              chunks: outputChunkCount,
              bytes: outputByteCount,
            })
            void player.finish(frame.responseId).catch((reason) => {
              logVoiceChief('playback_finish_error', {
                responseId: frame.responseId,
                message: reason instanceof Error ? reason.message : String(reason),
              })
            })
            break
          case 'audio_cancel':
            logVoiceChief('audio_cancel', { responseId: frame.responseId })
            if (responseIdRef.current === frame.responseId) responseIdRef.current = null
            void player.flush()
            break
          case 'input_transcript':
            if (frame.final)
              logVoiceChief('input_transcript_final', { characters: frame.text.length })
            upsertTranscript('user', frame.text, frame.final)
            break
          case 'output_transcript':
            if (frame.final)
              logVoiceChief('output_transcript_final', {
                characters: frame.text.length,
                responseId: frame.responseId,
              })
            upsertTranscript('chief', frame.text, frame.final, frame.responseId)
            break
          case 'operation_status':
            setOperationUpdates((current) => [...current.slice(-5), frame])
            break
          case 'tool_call':
            logVoiceChief('tool_call', {
              name: frame.call.name,
            })
            break
          case 'hang_up':
            logVoiceChief('server_hang_up', { reason: frame.reason, delayMs: frame.delayMs })
            terminalCloseRef.current = true
            clearReconnectTimer()
            if (delayedHangupTimerRef.current) clearTimeout(delayedHangupTimerRef.current)
            delayedHangupTimerRef.current = setTimeout(
              () => {
                delayedHangupTimerRef.current = null
                void end({ feedback: true })
              },
              Math.max(frame.delayMs ?? 0, 0),
            )
            break
          case 'error':
            logVoiceChief('server_error', {
              code: frame.code,
              message: frame.message,
              recoverable: frame.recoverable,
            })
            socketReadyForAudioRef.current = false
            setError(frame.recoverable ? null : frame.message)
            setState(frame.recoverable ? 'reconnecting' : 'error')
            if (frame.recoverable) socket.close(4000, 'recoverable voice chief error')
            else terminalCloseRef.current = true
            break
          case 'pong':
            break
        }
      }
      socket.onerror = () => {
        if (!isCurrentSocket()) return
        logVoiceChief('socket_error')
      }
      socket.onclose = (event) => {
        if (!isCurrentSocket()) return
        socketReadyForAudioRef.current = false
        stopHeartbeat()
        logVoiceChief('socket_close', {
          code: event.code,
          reason: event.reason,
          clean: event.wasClean,
        })
        if (!disposed && !endedRef.current && !terminalCloseRef.current)
          scheduleReconnect(`close:${event.code}`)
      }
    }

    connectSocket()

    return () => {
      disposed = true
      clearReconnectTimer()
      if (socketHeartbeatTimerRef.current) {
        clearInterval(socketHeartbeatTimerRef.current)
        socketHeartbeatTimerRef.current = null
      }
      if (delayedHangupTimerRef.current) {
        clearTimeout(delayedHangupTimerRef.current)
        delayedHangupTimerRef.current = null
      }
      logVoiceChief('call_cleanup', {
        inputFrames: inputFrameCount,
        inputBytes: inputByteCount,
        outputChunks: outputChunkCount,
        outputBytes: outputByteCount,
      })
      removeFrame()
      removeRecorderError()
      removePlayerError()
      removeComplete()
      socketRef.current?.close()
      socketRef.current = null
      socketReadyForAudioRef.current = false
      void recorder.stop()
      void player.stop()
    }
  }, [
    end,
    options.incomingCallId,
    options.initialPrompt,
    options.projectHint,
    options.reason,
    token,
    shouldPublishMeterLevel,
    upsertTranscript,
  ])

  const toggleMute = useCallback(() => {
    setMuted((value) => {
      mutedRef.current = !value
      return !value
    })
  }, [])
  const setOutputRoute = useCallback(async (route: PcmOutputRoute) => {
    await playerRef.current.setOutputRoute(route)
    outputRouteRef.current = route
    setOutputRouteState(route)
  }, [])

  return useMemo(
    () => ({
      state,
      error,
      transcripts,
      operationUpdates,
      muted,
      subtitles,
      outputRoute,
      supportsOutputRoute: true,
      meterLevel,
      toggleMute,
      setSubtitles,
      setOutputRoute,
      end,
    }),
    [
      state,
      error,
      transcripts,
      operationUpdates,
      muted,
      subtitles,
      outputRoute,
      meterLevel,
      toggleMute,
      setSubtitles,
      setOutputRoute,
      end,
    ],
  )
}
