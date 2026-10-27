// @arch docs/features/personal-modules.md
import { useEffect, useRef, useState } from 'react'
import { Keyboard, Text, TextInput } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ComposerDock } from '../../components/ComposerDock'
import { useComposerBottomInset } from '../chat/hooks/useComposerBottomInset'
import { useIsFocused } from '@react-navigation/native'
import { randomUUID } from 'expo-crypto'
import { useTranslation } from 'react-i18next'
import { HeaderIconButton } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { authApi } from '../../config/api'
import { StewardComposerInput } from '../steward/components/StewardComposerInput'
import { useVoiceDraft } from '../chat/hooks/useVoiceDraft'
import { createCloudReminder, type PendingReminder } from './createCloudReminder'
import { localZone } from './types'

export function ScheduleComposer({
  initialText,
  onCreated,
}: {
  initialText?: string
  onCreated: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const focused = useIsFocused()
  const insets = useSafeAreaInsets()
  const bottomInset = useComposerBottomInset(insets.bottom)
  const accountId = useAuthStore((s) => s.user?.id ?? '')
  const [input, setInput] = useState(initialText ?? '')
  const inputRef = useRef<TextInput>(null)
  const pending = useRef<PendingReminder | null>(null)
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const voice = useVoiceDraft({
    sessionId: `personal-calendar:${accountId}`,
    sessionDraftEnabled: false,
    active: focused && !!accountId,
    shareContinuousRecording: true,
    currentDraft: input,
    onListeningTextChange: setInput,
    onDraftReady: (result) => setInput(result.draft),
  })
  useEffect(() => {
    pending.current = null
    setInput(initialText ?? '')
    setError(false)
  }, [accountId, initialText])
  async function send(value = input) {
    const text = value.trim()
    if (!text || sending.current || !accountId) return
    sending.current = true
    setBusy(true)
    setError(false)
    const isCurrent = () => useAuthStore.getState().user?.id === accountId
    if (pending.current?.text !== text)
      pending.current = { key: randomUUID(), text, timezone: localZone() }
    try {
      await createCloudReminder(pending.current, authApi, isCurrent)
      if (!isCurrent()) return
      pending.current = null
      setInput('')
      Keyboard.dismiss()
      await onCreated()
    } catch {
      if (isCurrent()) setError(true)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <ComposerDock bottomInset={bottomInset}>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.errorText, padding: 8 }}>
          {t('personal_schedule_create_failed')}
        </Text>
      ) : null}
      <StewardComposerInput
        input={input}
        onChange={(value) => {
          if (!sending.current) setInput(value)
        }}
        inputRef={inputRef}
        onFocus={() => {}}
        onBlur={() => {}}
        colors={colors}
        phase={voice.phase}
        meterLevel={voice.meterLevel}
        actions={
          <HeaderIconButton
            icon="add"
            label={t('personal_add_reminder')}
            onPress={() => {
              if (!sending.current)
                setInput((previous) => previous || t('personal_schedule_add_prompt'))
            }}
          />
        }
        disabled={busy || !accountId}
        canSend={
          !!input.trim() && !!accountId && voice.phase !== 'listening' && voice.phase !== 'refining'
        }
        sending={busy}
        onSend={() => send()}
        onStart={(held) => voice.startRecording(held)}
        onDictationStop={async () => { await voice.stopRecording({ skipRefine: true }) }}
        onRelease={async () => {
          const result = await voice.stopRecording({ skipRefine: true })
          if (result?.draft.trim()) await send(result.draft)
        }}
        onCancel={() => void voice.cancelRecording()}
      />
    </ComposerDock>
  )
}
