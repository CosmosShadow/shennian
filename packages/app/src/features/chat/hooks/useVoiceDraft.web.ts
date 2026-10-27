// @arch docs/architecture/app/chat-voice-draft.md
// @test ../../../__tests__/desktop-voice-draft.test.ts
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../config/auth'
import { createAsrClient } from '../audio/asr-client.web'
import { createPcmRecorder } from '../audio/create-pcm-recorder.web'
import { DEFAULT_PCM_OPTIONS } from '../audio/pcm-recorder'
import { voiceAccountClient } from '../../voice/voiceAccountClient.web'
import type { VoiceDraftResponse } from '../../voice/voiceAccountClient.types'
import { subscribeVoiceInputInterruption } from '../../voice/voiceInputInterruption'
import { DesktopVoiceDraftController } from '../../desktop-control/desktopVoiceDraftController'
import { requestAiDataConsent } from '../../privacy/aiDataConsent'

export function useVoiceDraft(options: {
  sessionId: string | null | undefined; active?: boolean; sessionDraftEnabled?: boolean; currentDraft: string
  onListeningTextChange(text: string): void; onDraftReady(result: VoiceDraftResponse): void
}) {
  const { t } = useTranslation()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const latest = useRef({ ...options, accountId })
  latest.current = { ...options, accountId }
  const [controller] = useState(() => new DesktopVoiceDraftController({
    context: () => ({ ...latest.current, accountId: useAuthStore.getState().user?.id ?? null }),
    createRecorder: () => createPcmRecorder(DEFAULT_PCM_OPTIONS),
    createAsr: (sessionId, callbacks) => createAsrClient({ sessionId, lang: 'zh-CN' }, callbacks),
    finalize: voiceAccountClient.finalizeText,
    onListeningTextChange: (text) => latest.current.onListeningTextChange(text),
    onDraftReady: (result) => latest.current.onDraftReady(result),
  }))
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    void controller.cancel()
    return () => { void controller.cancel() }
  }, [accountId, options.sessionId, controller])
  useEffect(() => {
    if (options.active === false) void controller.cancel()
  }, [controller, options.active])
  useEffect(() => subscribeVoiceInputInterruption(() => { void controller.cancel() }), [controller])
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') void controller.cancel() }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [controller])
  useEffect(() => {
    if (!state.startedAt) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [state.startedAt])
  const startRecording = async () => {
    const isActive = () => latest.current.active !== false
    if (!isActive()) return false
    const currentAccountId = useAuthStore.getState().user?.id ?? ''
    const consented = await requestAiDataConsent({
      accountId: currentAccountId,
      kind: 'voice',
      title: t('ai_consent_voice_title'),
      message: t('ai_consent_voice_body'),
      allowLabel: t('ai_consent_allow_voice'),
      declineLabel: t('ai_consent_not_now'),
      privacyLabel: t('ai_consent_privacy'),
    })
    return consented && isActive() ? controller.startRecording() : false
  }
  return { phase: state.phase, error: state.error, transcript: state.transcript,
    durationMillis: state.startedAt ? Math.max(0, now - state.startedAt) : 0, meterLevel: state.meterLevel,
    startRecording, stopRecording: controller.stopRecording,
    cancelRecording: controller.cancel, clearError: controller.clearError }
}
