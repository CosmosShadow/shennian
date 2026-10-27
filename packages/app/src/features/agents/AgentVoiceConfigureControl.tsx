// @arch docs/features/agent-voice-configuration.md
// @test src/__tests__/agent-workspace-form.test.ts

import { useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import type {
  AgentVoiceConfigurationResponse,
  AgentVoiceTextDraft,
} from './agent-voice-configuration'
import { useAgentVoiceConfiguration } from './useAgentVoiceConfiguration'

export function AgentVoiceConfigureControl(props: {
  disabled?: boolean
  getDraft: () => AgentVoiceTextDraft
  onConfigured: (
    response: AgentVoiceConfigurationResponse,
    baseline: AgentVoiceTextDraft,
  ) => { summary: string; canUndo: boolean }
  onUndo: () => string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const longPressTriggeredRef = useRef(false)
  const [feedback, setFeedback] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const voice = useAgentVoiceConfiguration({
    getDraft: props.getDraft,
    onConfigured: (response, baseline) => {
      const result = props.onConfigured(response, baseline)
      setFeedback(result.summary)
      setCanUndo(result.canUndo)
    },
  })
  const busy = !['idle', 'error'].includes(voice.phase)
  const listening = voice.phase === 'starting' || voice.phase === 'listening'

  const label =
    voice.phase === 'starting'
      ? t('agents_voice_starting')
      : voice.phase === 'listening'
        ? t('agents_voice_release')
        : voice.phase === 'transcribing'
          ? t('agents_voice_transcribing')
          : voice.phase === 'configuring'
            ? t('agents_voice_configuring')
            : t('agents_voice_hold')

  const toggle = () => {
    if (props.disabled) return
    if (listening) void voice.stop()
    else if (!busy) void voice.start()
  }

  return (
    <View style={styles.root}>
      <Pressable
        testID="agent-voice-configure"
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={props.disabled || (busy && !listening)}
        delayLongPress={220}
        onLongPress={() => {
          longPressTriggeredRef.current = true
          if (!props.disabled && !busy) void voice.start()
        }}
        onPressOut={() => {
          if (longPressTriggeredRef.current) void voice.stop()
        }}
        onPress={() => {
          if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false
            return
          }
          toggle()
        }}
        style={({ pressed }) => [
          styles.button,
          {
            borderColor: listening ? colors.brand : colors.border,
            backgroundColor: pressed || listening ? colors.surfaceHover : colors.surface,
          },
          (props.disabled || (busy && !listening)) && styles.disabled,
        ]}
      >
        {busy && !listening ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <Ionicons
            name={listening ? 'mic' : 'mic-outline'}
            size={20}
            color={listening ? colors.brand : colors.textSecondary}
          />
        )}
        <Text style={[styles.label, { color: listening ? colors.brand : colors.text }]}>
          {label}
        </Text>
      </Pressable>
      {voice.transcript ? (
        <Text style={[styles.transcript, { color: colors.textSecondary }]} numberOfLines={1}>
          {voice.transcript}
        </Text>
      ) : null}
      {feedback ? (
        <View style={styles.feedbackRow}>
          <Text style={[styles.feedback, { color: colors.textSecondary }]}>{feedback}</Text>
          {canUndo ? (
            <Pressable
              testID="agent-voice-undo"
              accessibilityRole="button"
              onPress={() => {
                const summary = props.onUndo()
                if (summary) setFeedback(summary)
                setCanUndo(false)
              }}
            >
              <Text style={[styles.undo, { color: colors.brand }]}>{t('agents_voice_undo')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {voice.phase === 'error' ? (
        <Pressable onPress={voice.clearError} accessibilityRole="button">
          <Text style={[styles.error, { color: colors.error }]}>
            {voice.error === 'permission'
              ? t('agents_voice_permission_error')
              : voice.error === 'empty'
                ? t('agents_voice_empty_error')
                : t('agents_voice_failed')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 7 },
  button: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  transcript: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  feedbackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 4 },
  feedback: { flex: 1, fontSize: 13, lineHeight: 18 },
  undo: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  error: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  disabled: { opacity: 0.45 },
})
