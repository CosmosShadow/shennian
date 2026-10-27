// @arch docs/architecture/app/chat-voice-draft.md
// @test src/__tests__/room-conversation-screen.test.ts

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ComposerIconButton } from './ComposerIconButton'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../../hooks/useTheme'
import type { VoiceComposerPhase } from '../utils/voice'
import { DesktopComposerIconButton } from '../../desktop-chat/DesktopComposerIconButton'

type Props = {
  phase: VoiceComposerPhase
  onStart: () => void | Promise<unknown>
  onStop: () => void | Promise<unknown>
  disabled: boolean
  meterLevel?: number
  colors: Colors
  desktop?: boolean
}

export function ComposerVoiceControl({
  phase,
  onStart,
  onStop,
  disabled,
  meterLevel = 0,
  colors,
  desktop = false,
}: Props) {
  const { t } = useTranslation()
  const listening = phase === 'listening'
  const refining = phase === 'refining'
  const busy = refining
  const error = phase === 'error'
  const bars = [0.14, 0.2, 0.3, 0.46, 0.68, 0.9, 1, 0.84, 0.58, 0.38, 0.24, 0.16]
  const amplitude = Math.max(0, Math.min(1, meterLevel))

  if (listening) {
    return (
      <Pressable
        testID="voice-listening-indicator"
        accessibilityState={{ busy: false }}
        style={styles.listeningIndicator}
        hitSlop={8}
        onPress={() => void onStop()}
      >
        <View style={styles.waveRail}>
          {bars.map((weight, index) => (
            <View
              key={`voice-wave-${index}`}
              style={[
                styles.waveBar,
                {
                  height: 6 + Math.round(weight * 3) + Math.round(amplitude * (10 + weight * 18)),
                  opacity: Math.min(1, 0.3 + weight * 0.28 + amplitude * 0.34),
                  backgroundColor: colors.brand,
                },
              ]}
            />
          ))}
        </View>
      </Pressable>
    )
  }

  if (refining) {
    return (
      <Pressable
        testID="voice-refining-indicator"
        accessibilityRole="button"
        accessibilityLabel={t('voice_optimizing_continue')}
        accessibilityState={{ busy: true, disabled }}
        disabled={disabled}
        onPress={() => void onStart()}
        style={({ pressed }) => [
          styles.listeningIndicator,
          styles.refiningIndicator,
          pressed ? { backgroundColor: colors.surfaceHover } : null,
        ]}
      >
        <Text style={[styles.refiningText, { color: colors.textSecondary }]}>
          {t('voice_optimizing_inline')}
        </Text>
      </Pressable>
    )
  }

  if (desktop) {
    return (
      <DesktopComposerIconButton
        testID="voice-btn"
        icon="mic"
        variant="neutral"
        colors={colors}
        disabled={disabled || busy}
        accessibilityLabel={t('voice_input')}
        onPress={() => void onStart()}
      />
    )
  }

  return <ComposerIconButton testID="voice-btn" icon="mic" colors={colors}
    error={error} disabled={disabled || busy} accessibilityLabel={t('voice_input')}
    onPress={() => void onStart()} />
}

const styles = StyleSheet.create({
  listeningIndicator: {
    width: 104,
    height: 44,
    marginLeft: 8,
    marginRight: 4,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refiningIndicator: { borderRadius: 10 },
  waveRail: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  waveBar: { width: 4, minHeight: 4, borderRadius: 999 },
  refiningText: { fontSize: 13, lineHeight: 17, fontWeight: '500' },
})
