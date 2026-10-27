import { createVoiceCaptureFeedback } from '../voice/voiceCaptureFeedback'
// @arch docs/features/personal-modules.md
import { useEffect, useRef, useState } from 'react'
import { Pressable, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { createPcmRecorder } from '../chat/audio/create-pcm-recorder'
import { createAsrClient } from '../chat/audio/asr-client'
import { useRecordingState } from './runtime'
export function ReminderVoiceInput({ onText }: { onText: (value: string) => void }) {
  const { t } = useTranslation(),
    { colors } = useTheme()
  const active = useRecordingState((s) => s.active)
  const [listening, setListening] = useState(false),
    [error, setError] = useState(false)
  const current = useRef<{ release: boolean; stop: () => void } | null>(null)
  useEffect(() => () => current.current?.stop(), [])
  async function start() {
    if (active || current.current) return
    const recorder = createPcmRecorder(),
      finals = new Map<number, string>(),
      captureFeedback = createVoiceCaptureFeedback()
    let client: ReturnType<typeof createAsrClient> | null = null
    let timeout: ReturnType<typeof setTimeout> | undefined
    const unsubs: Array<() => void> = []
    const state = {
      release: false,
      stop: () => {
        captureFeedback.end()
        clearTimeout(timeout)
        client?.close()
        void recorder.stop()
        unsubs.forEach((fn) => fn())
        if (current.current === state) {
          current.current = null
          setListening(false)
        }
      },
    }
    current.current = state
    setError(false)
    setListening(true)
    try {
      if (!(await recorder.requestPermission()) || !useAuthStore.getState().token)
        throw new Error('permission')
      if (current.current !== state || state.release) {
        state.stop()
        return
      }
      timeout = setTimeout(() => {
        setError(true)
        state.stop()
      }, 60000)
      unsubs.push(
        recorder.onFrame((frame) => client?.sendAudio(frame)),
        recorder.onError(() => {
          setError(true)
          state.stop()
        }),
      )
      client = createAsrClient(
        { token: useAuthStore.getState().token!, sessionId: 'personal-calendar' },
        {
          onReady: () => {
            if (state.release) client?.finish()
          },
          onPartial: (value) => onText([...finals.values()].join('') + value),
          onFinal: (value, index) => {
            finals.set(index, value)
            onText(
              [...finals]
                .sort((a, b) => a[0] - b[0])
                .map((x) => x[1])
                .join(''),
            )
          },
          onEnd: (value) => {
            if (value) onText(value)
            state.stop()
          },
          onError: () => {
            setError(true)
            state.stop()
          },
          onClose: () => state.stop(),
        },
      )
      await recorder.start()
      if (state.release || current.current !== state) {
        await recorder.stop()
        client.finish()
      }
      if (current.current === state && !state.release) captureFeedback.start()
      // Releasing waits for recognition; timeout still bounds the entire interaction.
      ;(state as typeof state & { finish?: () => void }).finish = () => {
        state.release = true
        captureFeedback.end()
        void recorder.stop().then(() => client?.finish())
      }
    } catch {
      setError(true)
      state.stop()
    }
  }
  function finish() {
    const state = current.current as typeof current.current & { finish?: () => void }
    if (!state) return
    state.release = true
    state.finish?.()
  }
  return (
    <Pressable
      accessibilityRole="button"
      disabled={active}
      onPressIn={() => void start()}
      onPressOut={finish}
      style={{ padding: 12, opacity: active ? 0.4 : 1 }}
    >
      <Text style={{ color: error ? colors.errorText : colors.text }}>
        {t(
          error
            ? 'personal_action_failed'
            : listening
              ? 'personal_release_voice'
              : 'personal_hold_voice',
        )}
      </Text>
    </Pressable>
  )
}
