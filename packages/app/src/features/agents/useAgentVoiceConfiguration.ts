import { createVoiceCaptureFeedback } from '../voice/voiceCaptureFeedback'
// @arch docs/features/agent-voice-configuration.md
// @test src/__tests__/agent-voice-configuration.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import { agentAccountClient } from './agentAccountClient'
import { useAuthStore } from '../../config/auth'
import { createAsrClient, type AsrClient } from '../chat/audio/asr-client'
import { createPcmRecorder } from '../chat/audio/create-pcm-recorder'
import { DEFAULT_PCM_OPTIONS, type PcmRecorder } from '../chat/audio/pcm-recorder'
import type {
  AgentVoiceConfigurationResponse,
  AgentVoiceTextDraft,
} from './agent-voice-configuration'

export type AgentVoiceConfigurationPhase =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'transcribing'
  | 'configuring'
  | 'error'

export function useAgentVoiceConfiguration(options: {
  getDraft: () => AgentVoiceTextDraft
  onConfigured: (response: AgentVoiceConfigurationResponse, baseline: AgentVoiceTextDraft) => void
}) {
  const [phase, setPhase] = useState<AgentVoiceConfigurationPhase>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const captureFeedback = useRef(createVoiceCaptureFeedback()).current
  const mountedRef = useRef(true)
  const phaseRef = useRef<AgentVoiceConfigurationPhase>('idle')
  const releaseRequestedRef = useRef(false)
  const terminalHandledRef = useRef(false)
  const recorderRef = useRef<PcmRecorder | null>(null)
  const asrRef = useRef<AsrClient | null>(null)
  const unsubsRef = useRef<Array<() => void>>([])
  const baselineRef = useRef<AgentVoiceTextDraft | null>(null)
  const transcriptRef = useRef('')
  const finalSegmentsRef = useRef<string[]>([])
  const interimRef = useRef('')
  const operationRef = useRef(0)

  const updatePhase = useCallback((next: AgentVoiceConfigurationPhase) => {
    phaseRef.current = next
    if (mountedRef.current) setPhase(next)
  }, [])

  const cleanupAudio = useCallback(async () => {
    captureFeedback.end()
    for (const unsubscribe of unsubsRef.current.splice(0)) unsubscribe()
    asrRef.current?.close()
    asrRef.current = null
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) await recorder.stop().catch(() => {})
  }, [captureFeedback])

  const fail = useCallback(
    async (message: string) => {
      operationRef.current += 1
      terminalHandledRef.current = true
      await cleanupAudio()
      if (!mountedRef.current) return
      setError(message)
      updatePhase('error')
    },
    [cleanupAudio, updatePhase],
  )

  const configureTranscript = useCallback(
    async (rawTranscript: string, operation: number) => {
      const finalTranscript = rawTranscript.trim()
      const baseline = baselineRef.current
      if (!finalTranscript || !baseline) {
        await fail('empty')
        return
      }
      transcriptRef.current = finalTranscript
      if (mountedRef.current) setTranscript(finalTranscript)
      updatePhase('configuring')
      try {
        const response = await agentAccountClient.configureAgentDraft<AgentVoiceConfigurationResponse>(
          finalTranscript,
          baseline,
        )
        if (!mountedRef.current || operationRef.current !== operation) return
        options.onConfigured(response, baseline)
        setError('')
        updatePhase('idle')
      } catch {
        if (!mountedRef.current || operationRef.current !== operation) return
        setError('processing')
        updatePhase('error')
      }
    },
    [fail, options, updatePhase],
  )

  const finishAsr = useCallback(
    async (reportedTranscript: string, operation: number) => {
      if (terminalHandledRef.current || operationRef.current !== operation) return
      terminalHandledRef.current = true
      const finalTranscript = reportedTranscript.trim() || transcriptRef.current.trim()
      await cleanupAudio()
      if (operationRef.current !== operation) return
      await configureTranscript(finalTranscript, operation)
    },
    [cleanupAudio, configureTranscript],
  )

  const stop = useCallback(async () => {
    releaseRequestedRef.current = true
    if (phaseRef.current === 'starting') return
    if (phaseRef.current !== 'listening') return
    captureFeedback.end()
    updatePhase('transcribing')
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) await recorder.stop().catch(() => {})
    asrRef.current?.finish()
  }, [captureFeedback, updatePhase])

  const start = useCallback(async () => {
    if (!['idle', 'error'].includes(phaseRef.current)) return false
    const token = useAuthStore.getState().token
    if (!token) {
      setError('unavailable')
      updatePhase('error')
      return false
    }

    const operation = ++operationRef.current
    releaseRequestedRef.current = false
    terminalHandledRef.current = false
    baselineRef.current = options.getDraft()
    transcriptRef.current = ''
    finalSegmentsRef.current = []
    interimRef.current = ''
    setTranscript('')
    setError('')
    updatePhase('starting')

    let recorder: PcmRecorder
    try {
      recorder = createPcmRecorder(DEFAULT_PCM_OPTIONS)
      if (!(await Promise.resolve(recorder.isAvailable()))) throw new Error('unavailable')
      if (!(await recorder.requestPermission())) throw new Error('permission')
      if (operationRef.current !== operation) return false

      asrRef.current = createAsrClient(
        {
          token,
          sessionId: `agent-config-${operation}-${Date.now()}`,
          lang: 'zh-CN',
          sampleRate: DEFAULT_PCM_OPTIONS.sampleRate,
        },
        {
          onReady: () => {},
          onPartial: (text) => {
            if (operationRef.current !== operation || terminalHandledRef.current) return
            interimRef.current = text.trim()
            transcriptRef.current =
              `${finalSegmentsRef.current.join('')}${interimRef.current}`.trim()
            if (mountedRef.current) setTranscript(transcriptRef.current)
          },
          onFinal: (text, index) => {
            if (operationRef.current !== operation || terminalHandledRef.current) return
            const segment = text.trim()
            if (segment) finalSegmentsRef.current[index] = segment
            interimRef.current = ''
            transcriptRef.current = finalSegmentsRef.current.filter(Boolean).join('').trim()
            if (mountedRef.current) setTranscript(transcriptRef.current)
          },
          onEnd: (text) => void finishAsr(text, operation),
          onError: () => void fail('recognition'),
          onClose: () => {
            if (
              operationRef.current === operation &&
              !terminalHandledRef.current &&
              phaseRef.current === 'transcribing'
            ) {
              void finishAsr('', operation)
            } else if (
              operationRef.current === operation && !terminalHandledRef.current &&
              phaseRef.current === 'listening'
            ) {
              void fail('recognition')
            }
          },
        },
      )
      recorderRef.current = recorder
      unsubsRef.current.push(
        recorder.onFrame((frame) => asrRef.current?.sendAudio(frame)),
        recorder.onError(() => void fail('recording')),
      )
      await recorder.start()
      if (operationRef.current !== operation) return false
      captureFeedback.start()
      updatePhase('listening')
      if (releaseRequestedRef.current) void stop()
      return true
    } catch (caught) {
      const message =
        caught instanceof Error && caught.message === 'permission' ? 'permission' : 'recording'
      await fail(message)
      return false
    }
  }, [captureFeedback, fail, finishAsr, options, stop, updatePhase])

  const clearError = useCallback(() => {
    if (phaseRef.current !== 'error') return
    setError('')
    updatePhase('idle')
  }, [updatePhase])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      operationRef.current += 1
      void cleanupAudio()
    }
  }, [cleanupAudio])

  return { phase, transcript, error, start, stop, clearError }
}
