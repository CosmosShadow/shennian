import { acquirePcmLease, releasePcmLease, isPcmLeaseHeld, ownsPcmLease } from '../audio/pcm-lease'
// @arch docs/architecture/app/chat-voice-draft.md
// @test src/__tests__/voice-utils.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { createVoiceCaptureFeedback } from '../../voice/voiceCaptureFeedback'
import { useTranslation } from 'react-i18next'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { voiceAccountClient, type VoiceDraftResponse } from '../../voice/voiceAccountClient'
import { useAuthStore } from '../../../config/auth'
import { reportLog } from '../../../config/log'
import { requestAiDataConsent } from '../../privacy/aiDataConsent'
import { subscribeVoiceInputInterruption } from '../../voice/voiceInputInterruption'
import { createAsrClient, type AsrClient } from '../audio/asr-client'
import { borrowSharedRecording, hasSharedRecordingSource } from '../audio/shared-recording-source'
import { createPcmRecorder } from '../audio/create-pcm-recorder.native'
import { DEFAULT_PCM_OPTIONS, type PcmRecorder } from '../audio/pcm-recorder'
import {
  appendVoiceTranscript,
  finalizeVoiceDraft,
  mergeVoiceTranscriptIntoDraft,
  voiceMeterToLevel,
  type VoiceComposerPhase,
} from '../utils/voice'

type UseVoiceDraftOptions = {
  sessionId: string | null | undefined
  active?: boolean
  sessionDraftEnabled?: boolean
  shareContinuousRecording?: boolean
  currentDraft: string
  onListeningTextChange: (nextText: string) => void
  onDraftReady: (result: VoiceDraftResponse) => void
}

type ActiveRecognitionMode = 'none' | 'asr-ws' | 'audio'

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
}

const RECORDING_AUDIO_MODE = {
  playsInSilentMode: true,
  interruptionMode: 'duckOthers' as const,
  allowsRecording: true,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
}

const IDLE_AUDIO_MODE = {
  playsInSilentMode: true,
  interruptionMode: 'mixWithOthers' as const,
  allowsRecording: false,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
}

function getAudioMimeType(): string {
  return Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a'
}

async function readFileAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri)
  const blob = await response.blob()

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function computePcmLevel(frame: Uint8Array): number {
  if (frame.byteLength < 2) return 0
  const sampleCount = Math.min(frame.byteLength / 2, 320)
  let sumSquares = 0
  for (let i = 0; i < sampleCount; i += 1) {
    const low = frame[i * 2]!
    const high = frame[i * 2 + 1]!
    let sample = (high << 8) | low
    if (sample & 0x8000) sample -= 0x10000
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / sampleCount) / 32_768
  if (!Number.isFinite(rms) || rms <= 0) return 0
  return Math.max(0, Math.min(1, rms * 4))
}

export function useVoiceDraft({
  sessionId,
  active = true,
  sessionDraftEnabled = true,
  shareContinuousRecording = true,
  currentDraft,
  onListeningTextChange,
  onDraftReady,
}: UseVoiceDraftOptions) {
  const { t } = useTranslation()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const captureFeedback = useRef(createVoiceCaptureFeedback()).current
  const recorder = useAudioRecorder(RECORDING_OPTIONS, (status) => {
    if (status.isFinished || status.hasError || status.mediaServicesDidReset) captureFeedback.end()
  })
  const recorderState = useAudioRecorderState(recorder, 160)
  const [phase, setPhase] = useState<VoiceComposerPhase>('idle')
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState('')
  const [listeningDurationMillis, setListeningDurationMillis] = useState(0)
  const [pcmLevel, setPcmLevel] = useState(0)
  const fallbackRecordingObservedRef = useRef(false)
  const fallbackLease = useRef(Symbol('voice-draft-fallback'))
  const recognitionModeRef = useRef<ActiveRecognitionMode>('none')
  const requestIdRef = useRef(0)
  const sessionRef = useRef(sessionId)
  const phaseRef = useRef<VoiceComposerPhase>('idle')
  const activeRef = useRef(active)
  activeRef.current = active
  const transcriptRef = useRef('')
  const draftRef = useRef(currentDraft)
  const listeningStartedAtRef = useRef(0)
  const asrClientRef = useRef<AsrClient | null>(null)
  const pcmRecorderRef = useRef<PcmRecorder | null>(null)
  const pcmUnsubsRef = useRef<Array<() => void>>([])
  const wsCommittedTranscriptRef = useRef('')
  const wsInterimRef = useRef('')
  const wsConnectionIdRef = useRef(0)
  const wsStopRequestedRef = useRef(false)
  const wsReconnectPromiseRef = useRef<Promise<boolean> | null>(null)
  const wsSkipRefineOnStopRef = useRef(false)
  const wsStopResolveRef = useRef<((result: VoiceDraftResponse | null) => void) | null>(null)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  useEffect(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'error') {
      draftRef.current = currentDraft
    }
  }, [currentDraft])

  useEffect(() => {
    if (phase !== 'listening' || recognitionModeRef.current === 'audio') return

    const tick = () => {
      if (!listeningStartedAtRef.current) return
      setListeningDurationMillis(Date.now() - listeningStartedAtRef.current)
    }

    tick()
    const timer = setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [phase])

  const resetAudioMode = useCallback(async () => {
    if (isPcmLeaseHeld() && !ownsPcmLease(fallbackLease.current)) return
    try {
      await setAudioModeAsync(IDLE_AUDIO_MODE)
    } catch {
      // ignore
    } finally { releasePcmLease(fallbackLease.current) }
  }, [])

  const syncListeningPreview = useCallback(
    (nextTranscript: string) => {
      setTranscript(nextTranscript)
      onListeningTextChange(mergeVoiceTranscriptIntoDraft(draftRef.current, nextTranscript))
    },
    [onListeningTextChange],
  )

  const teardownWsPath = useCallback(
    async ({
      stopRecorder = true,
      resetTranscript = true,
    }: { stopRecorder?: boolean; resetTranscript?: boolean } = {}) => {
      captureFeedback.end()
      wsConnectionIdRef.current += 1
      wsReconnectPromiseRef.current = null
      asrClientRef.current?.close()
      asrClientRef.current = null

      if (stopRecorder) {
        for (const unsub of pcmUnsubsRef.current) unsub()
        pcmUnsubsRef.current = []
        try {
          await pcmRecorderRef.current?.stop()
        } catch {
          // noop
        }
        pcmRecorderRef.current = null
        recognitionModeRef.current = 'none'
      }

      if (resetTranscript) {
        wsCommittedTranscriptRef.current = ''
        wsInterimRef.current = ''
      }
      wsStopRequestedRef.current = false
      setPcmLevel(0)
    },
    [captureFeedback],
  )

  const buildWsTranscript = useCallback(() => {
    return appendVoiceTranscript(wsCommittedTranscriptRef.current, wsInterimRef.current)
  }, [])

  const completeTranscriptDirectly = useCallback(
    async (
      rawTranscript: string,
      options?: { cleanup?: boolean },
    ): Promise<VoiceDraftResponse | null> => {
      const requestId = ++requestIdRef.current
      const targetSessionId = sessionId
      const nextTranscript = rawTranscript.trim()
      if (!nextTranscript) {
        setPhase('idle')
        return null
      }

      const previewDraft = mergeVoiceTranscriptIntoDraft(draftRef.current, nextTranscript)
      setTranscript(nextTranscript)
      setListeningDurationMillis(0)
      listeningStartedAtRef.current = 0
      onListeningTextChange(previewDraft)

      if (options?.cleanup !== false) setPhase('refining')
      let directResult: VoiceDraftResponse
      if (sessionId && sessionDraftEnabled) {
        try {
          directResult = await voiceAccountClient.finalizeText({
            sessionId,
            currentDraft: draftRef.current,
            transcript: nextTranscript,
            cleanup: options?.cleanup ?? true,
          })
        } catch {
          if (requestId !== requestIdRef.current || sessionRef.current !== targetSessionId) {
            return null
          }
          setPhase('error')
          setError('voice_processing_failed')
          return null
        }
      } else {
        const directDraft = mergeVoiceTranscriptIntoDraft(draftRef.current, nextTranscript)
        directResult = {
          transcript: nextTranscript,
          draft: directDraft,
          intent: draftRef.current.trim() ? 'append' : 'new',
          model: 'client-transcript',
        }
      }

      if (requestId !== requestIdRef.current || sessionRef.current !== targetSessionId) {
        return null
      }

      setTranscript(directResult.transcript)
      setPhase('idle')
      onDraftReady(directResult)
      return directResult
    },
    [onDraftReady, onListeningTextChange, sessionDraftEnabled, sessionId],
  )

  const finalizeWsRecording = useCallback(async (): Promise<VoiceDraftResponse | null> => {
    const mergedTranscript = buildWsTranscript()
    await teardownWsPath({ stopRecorder: true, resetTranscript: false })
    if (!mergedTranscript) {
      setTranscript('')
      setListeningDurationMillis(0)
      listeningStartedAtRef.current = 0
      setPhase('idle')
      wsStopResolveRef.current?.(null)
      wsStopResolveRef.current = null
      return null
    }
    const shouldCleanup = !wsSkipRefineOnStopRef.current
    wsSkipRefineOnStopRef.current = false
    const result = await completeTranscriptDirectly(mergedTranscript, { cleanup: shouldCleanup })
    wsStopResolveRef.current?.(result)
    wsStopResolveRef.current = null
    return result
  }, [buildWsTranscript, completeTranscriptDirectly, teardownWsPath])

  useEffect(() => {
    requestIdRef.current += 1
    captureFeedback.end()
    sessionRef.current = sessionId
    setTranscript('')
    setError('')
    setListeningDurationMillis(0)
    listeningStartedAtRef.current = 0
    wsCommittedTranscriptRef.current = ''
    wsInterimRef.current = ''
    wsStopRequestedRef.current = false
    wsSkipRefineOnStopRef.current = false
    wsStopResolveRef.current = null
    void teardownWsPath()
    recognitionModeRef.current = 'none'

    const status = recorder.getStatus()
    if (status.isRecording) {
      void recorder
        .stop()
        .catch(() => {})
        .finally(() => {
          void resetAudioMode()
        })
    }

    setPhase('idle')
  }, [captureFeedback, recorder, resetAudioMode, sessionId, teardownWsPath])

  const connectWsClient = useCallback(async (): Promise<boolean> => {
    const token = useAuthStore.getState().token
    const userId = useAuthStore.getState().user?.id
    if (!token || !sessionId) return false
    const connectionId = ++wsConnectionIdRef.current
    let terminalHandled = false

    const resolveSegmentTranscript = (reportedTranscript: string): string => {
      const mergedTranscript = reportedTranscript.trim() || buildWsTranscript()
      reportLog({
        level: 'debug',
        userId,
        sessionId,
        wsEvent: 'voice.resolveSegmentTranscript',
        metadata: {
          connectionId,
          mergedTranscript,
        },
      })
      wsCommittedTranscriptRef.current = mergedTranscript
      wsInterimRef.current = ''
      return mergedTranscript
    }

    const handleTerminal = (reportedTranscript: string, message?: string) => {
      if (terminalHandled || wsConnectionIdRef.current !== connectionId) return
      terminalHandled = true
      const mergedTranscript = resolveSegmentTranscript(reportedTranscript)
      syncListeningPreview(mergedTranscript)

      if (wsStopRequestedRef.current) {
        void finalizeWsRecording()
        return
      }

      if (phaseRef.current !== 'listening') return
      if (message) {
        setError(message)
      }
      captureFeedback.end()
      void reconnectWsClient()
    }

    const reconnectWsClient = async (): Promise<boolean> => {
      if (wsReconnectPromiseRef.current) {
        return await wsReconnectPromiseRef.current
      }

      const reconnectPromise = (async () => {
        if (
          phaseRef.current !== 'listening' ||
          recognitionModeRef.current !== 'asr-ws' ||
          wsStopRequestedRef.current
        ) {
          return false
        }
        return await connectWsClient()
      })()

      wsReconnectPromiseRef.current = reconnectPromise
      try {
        return await reconnectPromise
      } finally {
        if (wsReconnectPromiseRef.current === reconnectPromise) {
          wsReconnectPromiseRef.current = null
        }
      }
    }

    try {
      asrClientRef.current = createAsrClient(
        { token, sessionId, lang: 'zh-CN', sampleRate: DEFAULT_PCM_OPTIONS.sampleRate },
        {
          onReady: () => {
            if (wsConnectionIdRef.current !== connectionId) return
            reportLog({
              level: 'info',
              userId,
              sessionId,
              wsEvent: 'voice.asr.ready',
              metadata: { connectionId },
            })
            setError('')
            if (phaseRef.current === 'listening' && !wsStopRequestedRef.current) captureFeedback.start()
          },
          onPartial: (text) => {
            if (wsConnectionIdRef.current !== connectionId || phaseRef.current !== 'listening')
              return
            wsInterimRef.current = text
            const preview = text.trim() || wsCommittedTranscriptRef.current
            reportLog({
              level: 'debug',
              userId,
              sessionId,
              wsEvent: 'voice.asr.partial',
              metadata: {
                connectionId,
                text,
                previewTranscript: preview,
              },
            })
            if (preview) {
              syncListeningPreview(preview)
            }
          },
          onFinal: (text, index) => {
            if (
              wsConnectionIdRef.current !== connectionId ||
              (phaseRef.current !== 'listening' && phaseRef.current !== 'refining')
            ) {
              return
            }
            const finalTranscript = text.trim()
            if (!finalTranscript) return
            wsCommittedTranscriptRef.current = finalTranscript
            wsInterimRef.current = ''
            reportLog({
              level: 'debug',
              userId,
              sessionId,
              wsEvent: 'voice.asr.final',
              metadata: {
                connectionId,
                index,
                text,
                committedTranscript: wsCommittedTranscriptRef.current,
              },
            })
            syncListeningPreview(wsCommittedTranscriptRef.current)
          },
          onEnd: (finalTranscript) => {
            reportLog({
              level: 'info',
              userId,
              sessionId,
              wsEvent: 'voice.asr.end',
              metadata: {
                connectionId,
                finalTranscript,
                committedTranscript: wsCommittedTranscriptRef.current,
              },
            })
            handleTerminal(finalTranscript)
          },
          onError: (_code, message) => {
            reportLog({
              level: 'warn',
              userId,
              sessionId,
              wsEvent: 'voice.asr.error',
              errorMessage: message || 'voice_asr_failed',
              metadata: {
                connectionId,
                committedTranscript: wsCommittedTranscriptRef.current,
              },
            })
            handleTerminal('', message || 'voice_asr_failed')
          },
          onClose: () => {
            reportLog({
              level: 'info',
              userId,
              sessionId,
              wsEvent: 'voice.asr.close',
              metadata: {
                connectionId,
                committedTranscript: wsCommittedTranscriptRef.current,
              },
            })
            handleTerminal('')
          },
        },
      )
      return true
    } catch {
      return false
    }
  }, [buildWsTranscript, captureFeedback, finalizeWsRecording, sessionId, syncListeningPreview])

  const tryStartWsPath = useCallback(async (canStart: () => boolean = () => true): Promise<boolean> => {
    let pcmRecorder = pcmRecorderRef.current
    if (!pcmRecorder) {
      try {
        pcmRecorder = (shareContinuousRecording ? borrowSharedRecording() : null) ?? createPcmRecorder(DEFAULT_PCM_OPTIONS)
      } catch {
        return false
      }

      const available = await Promise.resolve(pcmRecorder.isAvailable())
      if (!available || !canStart()) return false

      try {
        const granted = await pcmRecorder.requestPermission()
        if (!granted || !canStart()) return false
      } catch {
        return false
      }

      try {
        await pcmRecorder.start()
      } catch {
        return false
      }

      if (!canStart()) { await pcmRecorder.stop(); return false }
      pcmRecorderRef.current = pcmRecorder
      pcmUnsubsRef.current.push(
        pcmRecorder.onFrame((frame) => {
          asrClientRef.current?.sendAudio(frame)
          setPcmLevel(computePcmLevel(frame))
        }),
      )
      pcmUnsubsRef.current.push(
        pcmRecorder.onError(() => {
          void teardownWsPath({ stopRecorder: true, resetTranscript: false })
          if (phaseRef.current === 'listening' || phaseRef.current === 'refining') {
            setPhase('error')
            setError('voice_recording_failed')
          }
        }),
      )
    }

    if (!canStart()) return false
    recognitionModeRef.current = 'asr-ws'
    wsStopRequestedRef.current = false
    listeningStartedAtRef.current = Date.now()
    phaseRef.current = 'listening'
    setPhase('listening')

    const connected = await connectWsClient()
    if (!connected) {
      await teardownWsPath({ stopRecorder: true, resetTranscript: false })
      recognitionModeRef.current = 'none'
      return false
    }

    return true
  }, [connectWsClient, teardownWsPath, shareContinuousRecording])

  const startFallbackRecording = useCallback(async (): Promise<boolean> => {
    const permission = await requestRecordingPermissionsAsync()
    if (!permission.granted) {
      setPhase('error')
      setError('voice_permission_denied')
      return false
    }

    fallbackRecordingObservedRef.current = false
    listeningStartedAtRef.current = Date.now()
    recognitionModeRef.current = 'audio'
    phaseRef.current = 'listening'
    setPhase('listening')

    try {
      acquirePcmLease(fallbackLease.current)
      await setAudioModeAsync(RECORDING_AUDIO_MODE)
      await recorder.prepareToRecordAsync(RECORDING_OPTIONS)
      recorder.record()
      captureFeedback.start()
      return true
    } catch {
      recognitionModeRef.current = 'none'
      setPhase('error')
      setError('voice_recording_failed')
      await resetAudioMode()
      return false
    }
  }, [captureFeedback, recorder, resetAudioMode])

  const interruptRecording = useCallback(async (): Promise<void> => {
    if (phaseRef.current !== 'listening' && phaseRef.current !== 'refining') return

    captureFeedback.end()
    requestIdRef.current += 1
    wsStopResolveRef.current?.(null)
    wsStopResolveRef.current = null
    wsStopRequestedRef.current = false
    wsSkipRefineOnStopRef.current = false

    if (recognitionModeRef.current === 'asr-ws') {
      await teardownWsPath({ stopRecorder: true, resetTranscript: false })
    } else if (recognitionModeRef.current === 'audio') {
      try {
        if (recorder.getStatus().isRecording) {
          await recorder.stop()
        }
      } catch {
        // ignore; incoming voice call needs the microphone released best-effort.
      }
      recognitionModeRef.current = 'none'
      await resetAudioMode()
    }

    listeningStartedAtRef.current = 0
    setListeningDurationMillis(0)
    setPcmLevel(0)
    setError('')
    phaseRef.current = 'idle'
    setPhase('idle')
  }, [captureFeedback, recorder, resetAudioMode, teardownWsPath])

  const startRecording = useCallback(async (canStart: () => boolean = () => true): Promise<boolean> => {
    if (!canStart() || !activeRef.current || !sessionId || phaseRef.current === 'listening') return false
    if (isPcmLeaseHeld() && !(shareContinuousRecording && hasSharedRecordingSource())) { setError('personal_error_microphone_in_use'); setPhase('error'); return false }
    if (phaseRef.current === 'refining') await interruptRecording()

    const consented = await requestAiDataConsent({
      accountId,
      kind: 'voice',
      title: t('ai_consent_voice_title'),
      message: t('ai_consent_voice_body'),
      allowLabel: t('ai_consent_allow_voice'),
      declineLabel: t('ai_consent_not_now'),
      privacyLabel: t('ai_consent_privacy'),
    })
    if (!consented || !activeRef.current || !canStart()) return false

    setError('')
    setTranscript('')
    setListeningDurationMillis(0)
    setPcmLevel(0)
    listeningStartedAtRef.current = 0
    wsCommittedTranscriptRef.current = ''
    wsInterimRef.current = ''
    wsStopRequestedRef.current = false
    wsSkipRefineOnStopRef.current = false
    wsStopResolveRef.current = null
    draftRef.current = currentDraft

    const wsStarted = await tryStartWsPath(canStart)
    if (!activeRef.current || !canStart()) {
      await interruptRecording()
      return false
    }
    if (wsStarted) return true

    if (!sessionDraftEnabled || hasSharedRecordingSource()) {
      setPhase('error')
      setError('voice_recording_failed')
      return false
    }

    const fallbackStarted = await startFallbackRecording()
    if (!activeRef.current || !canStart()) {
      await interruptRecording()
      return false
    }
    return fallbackStarted
  }, [accountId, currentDraft, interruptRecording, sessionDraftEnabled, sessionId, startFallbackRecording, t, tryStartWsPath, shareContinuousRecording])

  const stopFallbackRecording = useCallback(async (): Promise<VoiceDraftResponse | null> => {
    if (!sessionId) return null

    const requestId = ++requestIdRef.current
    const targetSessionId = sessionId
    setPhase('refining')
    setError('')

    try {
      await recorder.stop()
      const audioUrl = recorder.uri ?? recorderState.url
      if (!audioUrl) {
        throw new Error('missing audio url')
      }

      const audioBase64 = await readFileAsBase64(audioUrl)
      const result = await voiceAccountClient.createDraft({
        sessionId: targetSessionId,
        currentDraft: draftRef.current,
        audioBase64,
        audioMimeType: getAudioMimeType(),
      })

      if (requestId !== requestIdRef.current || sessionRef.current !== targetSessionId) {
        return null
      }

      if (wsSkipRefineOnStopRef.current) {
        wsSkipRefineOnStopRef.current = false
        return completeTranscriptDirectly(result.transcript, { cleanup: false })
      }

      const finalizedDraft = finalizeVoiceDraft({
        baseDraft: draftRef.current,
        transcript: result.transcript,
        refinedDraft: result.draft,
        intent: result.intent,
      })

      setTranscript(result.transcript)
      setListeningDurationMillis(0)
      listeningStartedAtRef.current = 0
      setPhase('idle')
      const finalizedResult = { ...result, draft: finalizedDraft }
      onDraftReady(finalizedResult)
      return finalizedResult
    } catch {
      if (requestId !== requestIdRef.current || sessionRef.current !== targetSessionId) {
        return null
      }
      onListeningTextChange(mergeVoiceTranscriptIntoDraft(draftRef.current, transcriptRef.current))
      recognitionModeRef.current = 'none'
      setPhase('error')
      setError('voice_processing_failed')
      return null
    } finally {
      await resetAudioMode()
    }
  }, [
    onDraftReady,
    onListeningTextChange,
    recorder,
    recorderState.url,
    resetAudioMode,
    completeTranscriptDirectly,
    sessionId,
  ])

  const stopRecording = useCallback(
    async (options?: { skipRefine?: boolean }): Promise<VoiceDraftResponse | null> => {
      if (phaseRef.current !== 'listening' || !sessionId) return null

      captureFeedback.end()
      if (recognitionModeRef.current === 'asr-ws') {
        wsStopRequestedRef.current = true
        wsSkipRefineOnStopRef.current = Boolean(options?.skipRefine)
        if (asrClientRef.current) {
          return await new Promise<VoiceDraftResponse | null>((resolve) => {
            wsStopResolveRef.current = resolve
            asrClientRef.current?.finish()
          })
        }
        if (options?.skipRefine) {
          wsSkipRefineOnStopRef.current = false
        }
        return await finalizeWsRecording()
      }

      if (options?.skipRefine) {
        wsSkipRefineOnStopRef.current = true
        try {
          return await stopFallbackRecording()
        } finally {
          wsSkipRefineOnStopRef.current = false
        }
      }

      return await stopFallbackRecording()
    },
    [captureFeedback, finalizeWsRecording, sessionId, stopFallbackRecording],
  )

  useEffect(() => {
    if (!active) void interruptRecording()
  }, [active, interruptRecording])

  useEffect(() => () => { void interruptRecording() }, [interruptRecording])

  useEffect(() => {
    return subscribeVoiceInputInterruption(() => {
      void interruptRecording()
    })
  }, [interruptRecording])

  useEffect(() => {
    if (recognitionModeRef.current !== 'audio' || phase !== 'listening') return
    if (recorderState.isRecording) fallbackRecordingObservedRef.current = true
    else if (fallbackRecordingObservedRef.current) void interruptRecording()
  }, [interruptRecording, phase, recorderState.isRecording])

  const clearError = useCallback(() => {
    if (phase === 'error') {
      setPhase('idle')
      setError('')
    }
  }, [phase])

  const meterLevel = useMemo(() => {
    if (recognitionModeRef.current === 'asr-ws') {
      return pcmLevel
    }
    return voiceMeterToLevel(recorderState.metering)
  }, [pcmLevel, recorderState.metering])

  return {
    phase,
    error,
    transcript,
    durationMillis:
      recognitionModeRef.current === 'asr-ws' && listeningDurationMillis > 0
        ? listeningDurationMillis
        : recorderState.durationMillis,
    meterLevel,
    startRecording,
    stopRecording,
    cancelRecording: interruptRecording,
    clearError,
  }
}
