// @arch docs/features/voice-shennian.md

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useVoiceChiefCall } from './useVoiceChiefCall'
import { useVoiceChiefController } from './VoiceChiefCallContext'
import { useAppIsActive } from './useAppIsActive'
import { normalizeVoiceChiefTranscriptDisplay } from './transcript'
import { mobileTypography } from '../../theme/mobileTypography'
import { useAuthStore } from '../../config/auth'
import { requestAiDataConsent } from '../privacy/aiDataConsent'

function useReduceMotionEnabled() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setEnabled(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return enabled
}

export function VoiceChiefScreen({
  projectHint,
  incomingCallId,
  initialPrompt,
  reason,
}: {
  projectHint?: string
  incomingCallId?: string
  initialPrompt?: string
  reason?: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const router = useRouter()
  const hangingUpRef = useRef(false)
  const startRequestedRef = useRef(false)
  const transcriptScrollRef = useRef<ScrollView>(null)
  const keepTranscriptAtBottomRef = useRef(true)
  const reduceMotionEnabled = useReduceMotionEnabled()
  const controller = useVoiceChiefController()
  const { startCall, minimizeCall: setFloatingCall, clearCall } = controller
  const call = controller.call
  const statusText = call?.error
    ? t(call.error)
    : t(`voice_chief_status_${call?.state || 'connecting'}`)
  const visibleTranscripts = useMemo(
    () => call?.transcripts.filter((item) => item.text.trim()) || [],
    [call?.transcripts],
  )
  const dismissCall = useCallback(() => {
    router.replace('/(main)')
  }, [router])

  useEffect(() => {
    if (controller.active || startRequestedRef.current || hangingUpRef.current) return
    startRequestedRef.current = true
    let cancelled = false
    void requestAiDataConsent({
      accountId,
      kind: 'voice',
      title: t('ai_consent_voice_title'),
      message: t('ai_consent_voice_body'),
      allowLabel: t('ai_consent_allow_voice'),
      declineLabel: t('ai_consent_not_now'),
      privacyLabel: t('ai_consent_privacy'),
    }).then((consented) => {
      if (cancelled) return
      if (!consented) {
        dismissCall()
        return
      }
      startCall({ projectHint, incomingCallId, initialPrompt, reason })
    })
    return () => { cancelled = true }
  }, [accountId, controller.active, dismissCall, incomingCallId, initialPrompt, projectHint, reason, startCall, t])

  useEffect(() => {
    if (call?.state !== 'ended' || hangingUpRef.current) return
    hangingUpRef.current = true
    clearCall()
    dismissCall()
  }, [call?.state, clearCall, dismissCall])

  const hangUp = async () => {
    if (hangingUpRef.current) return
    hangingUpRef.current = true
    try {
      await call?.end({ feedback: true })
    } finally {
      clearCall()
      dismissCall()
    }
  }

  const minimizeCall = () => {
    setFloatingCall()
    dismissCall()
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel={t('voice_chief_minimize')}
          onPress={minimizeCall}
          style={({ pressed }) => [styles.minimizeButton, { opacity: pressed ? 0.65 : 1 }]}
          accessibilityRole="button"
        >
          <Ionicons name="contract-outline" size={21} color={colors.text} />
        </Pressable>
        <View style={styles.titleLockup}>
          <Text style={[styles.title, { color: colors.text }]}>{t('voice_chief_title')}</Text>
        </View>
      </View>

      <View
        style={[
          styles.hero,
          call?.subtitles ? styles.heroWithSubtitles : styles.heroWithoutSubtitles,
        ]}
      >
        <CallStateOrb
          state={call?.state || 'connecting'}
          statusText={statusText}
          colors={colors}
          compact={call?.subtitles}
          reduceMotionEnabled={reduceMotionEnabled}
        />
      </View>

      <ScrollView
        ref={transcriptScrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={50}
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent
          keepTranscriptAtBottomRef.current =
            contentOffset.y + layoutMeasurement.height >= contentSize.height - 48
        }}
        onContentSizeChange={() => {
          if (keepTranscriptAtBottomRef.current) {
            transcriptScrollRef.current?.scrollToEnd({ animated: !reduceMotionEnabled })
          }
        }}
      >
        {call?.subtitles && (
          <View style={styles.transcriptSurface}>
            {visibleTranscripts.length === 0 ? (
              <Text style={[styles.emptyTranscript, { color: colors.textTertiary }]}>
                {t('voice_chief_subtitle_waiting')}
              </Text>
            ) : (
              visibleTranscripts.map((item) => (
                <Text key={item.id} style={[styles.transcriptLine, { color: colors.text }]}>
                  <Text
                    style={[
                      styles.role,
                      { color: item.role === 'chief' ? colors.brand : colors.textSecondary },
                    ]}
                  >
                    {item.role === 'chief'
                      ? t('voice_chief_role_chief')
                      : t('voice_chief_role_you')}
                  </Text>
                  {normalizeVoiceChiefTranscriptDisplay(item.text)}
                </Text>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.controls}>
        <CallControl
          icon={call?.muted ? 'mic-off' : 'mic'}
          label={call?.muted ? t('voice_chief_unmute') : t('voice_chief_mute')}
          active={call?.muted}
          onPress={() => call?.toggleMute()}
          colors={colors}
        />
        <CallControl
          icon={call?.outputRoute === 'speaker' ? 'volume-high' : 'volume-medium-outline'}
          label={t('voice_chief_audio_route')}
          disabled={!call?.supportsOutputRoute}
          active={call?.outputRoute === 'speaker'}
          onPress={() =>
            void call?.setOutputRoute(call.outputRoute === 'speaker' ? 'system' : 'speaker')
          }
          colors={colors}
        />
        <CallControl
          icon={call?.subtitles ? 'text' : 'text-outline'}
          label={t('voice_chief_subtitles')}
          active={call?.subtitles}
          onPress={() => call?.setSubtitles(!call.subtitles)}
          colors={colors}
        />
        <CallControl
          icon="call"
          label={t('voice_chief_hang_up')}
          destructive
          onPress={hangUp}
          colors={colors}
        />
      </View>
    </SafeAreaView>
  )
}

export function CallStateOrb({
  state,
  statusText,
  colors,
  compact,
  reduceMotionEnabled,
}: {
  state: ReturnType<typeof useVoiceChiefCall>['state']
  statusText: string
  colors: ReturnType<typeof useTheme>['colors']
  compact?: boolean
  reduceMotionEnabled?: boolean
}) {
  const pulse = useRef(new Animated.Value(0)).current
  const appIsActive = useAppIsActive()
  const isListening = state === 'listening'
  const isThinking = state === 'thinking' || state === 'connecting' || state === 'reconnecting'
  const isSpeaking = state === 'speaking'
  const isError = state === 'error'
  const activeColor = isError
    ? colors.error
    : isSpeaking
      ? colors.brand
      : isThinking
        ? colors.warning
        : colors.success

  useEffect(() => {
    pulse.stopAnimation()
    pulse.setValue(0)
    if (!appIsActive || reduceMotionEnabled) return
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: isSpeaking ? 740 : isListening ? 1100 : 1450,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: isSpeaking ? 740 : isListening ? 1100 : 1450,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    pulseLoop.start()
    return () => {
      pulseLoop.stop()
    }
  }, [appIsActive, isListening, isSpeaking, pulse, reduceMotionEnabled])

  const outerScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, isSpeaking ? 1.16 : 1.08],
  })
  const outerOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, isSpeaking ? 0.42 : 0.32],
  })
  const bars = isSpeaking
    ? [26, 44, 32, 52, 36]
    : isThinking
      ? [18, 30, 42, 30, 18]
      : isListening
        ? [24, 30, 36, 30, 24]
        : [18, 18, 18, 18, 18]
  return (
    <View
      style={[styles.orbStage, compact ? styles.orbStageCompact : null]}
      accessibilityLabel={statusText}
      accessibilityRole="text"
      accessible
    >
      <View style={[styles.orbVisual, compact ? styles.orbVisualCompact : null]}>
        <Animated.View
          style={[
            styles.orbRing,
            compact ? styles.orbRingCompact : null,
            {
              borderColor: `${activeColor}55`,
              opacity: reduceMotionEnabled ? 0.28 : outerOpacity,
              ...(reduceMotionEnabled ? {} : { transform: [{ scale: outerScale }] }),
            },
          ]}
        />
        <View
          style={[
            styles.orbCore,
            compact ? styles.orbCoreCompact : null,
            { backgroundColor: `${activeColor}14`, borderColor: `${activeColor}34` },
          ]}
        />
        <View style={[styles.orbBars, compact ? styles.orbBarsCompact : null]}>
          {bars.map((height, index) => (
            <Animated.View
              key={`${state}-${index}`}
              style={[
                styles.orbBar,
                compact ? styles.orbBarCompact : null,
                {
                  height: compact ? Math.round(height * 0.78) : height,
                  backgroundColor: activeColor,
                  opacity: isListening
                    ? index === 2
                      ? 0.9
                      : 0.38
                    : isThinking
                      ? 0.42 + index * 0.08
                      : 0.62 + (index % 2) * 0.26,
                  ...(reduceMotionEnabled
                    ? {}
                    : {
                        transform: [
                          {
                            scaleY: pulse.interpolate({
                              inputRange: [0, 1],
                              outputRange: [index % 2 ? 0.78 : 1, index % 2 ? 1.2 : 0.88],
                            }),
                          },
                        ],
                      }),
                },
              ]}
            />
          ))}
        </View>
      </View>
      {!compact && (
        <Text style={[styles.status, { color: isError ? colors.error : colors.textSecondary }]}>
          {statusText}
        </Text>
      )}
    </View>
  )
}

export function CallControl({
  icon,
  label,
  active,
  destructive,
  onPress,
  colors,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name']
  label: string
  active?: boolean
  destructive?: boolean
  onPress(): void
  colors: ReturnType<typeof useTheme>['colors']
  disabled?: boolean
}) {
  const background = destructive ? colors.error : active ? colors.brandLight : colors.surface
  const foreground = destructive ? '#fff' : active ? colors.brand : colors.text
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlWrap,
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: 0.68 },
      ]}
    >
      <View
        style={[
          styles.control,
          { backgroundColor: background, borderColor: destructive ? colors.error : colors.border },
        ]}
      >
        <Ionicons name={icon} size={24} color={foreground} />
      </View>
      <Text style={[styles.controlLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { height: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  minimizeButton: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleLockup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  title: { textAlign: 'center', ...mobileTypography.navigationTitle },
  hero: { alignItems: 'center', paddingHorizontal: 24 },
  heroWithoutSubtitles: { paddingTop: 86, paddingBottom: 24 },
  heroWithSubtitles: {
    minHeight: 84,
    justifyContent: 'center',
    paddingVertical: 0,
  },
  orbStage: {
    width: 166,
    minHeight: 192,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  orbStageCompact: { width: 78, minHeight: 78, marginBottom: 0 },
  orbVisual: { width: 166, height: 166, alignItems: 'center', justifyContent: 'center' },
  orbVisualCompact: { width: 78, height: 78 },
  orbRing: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 1.5 },
  orbRingCompact: { width: 70, height: 70, borderRadius: 35 },
  orbCore: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbCoreCompact: { width: 44, height: 44, borderRadius: 22 },
  orbBars: {
    position: 'absolute',
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  orbBarsCompact: { height: 32, gap: 3 },
  orbBar: { width: 8, borderRadius: 4 },
  orbBarCompact: { width: 5, borderRadius: 2.5 },
  status: { ...mobileTypography.secondary, marginTop: 4, textAlign: 'center' },
  content: { flex: 1 },
  contentInner: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 2, paddingBottom: 8 },
  transcriptSurface: { gap: 16 },
  emptyTranscript: { ...mobileTypography.secondary, textAlign: 'left', paddingTop: 4 },
  transcriptLine: { ...mobileTypography.body, lineHeight: 27 },
  role: { fontWeight: '600' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 6,
  },
  controlWrap: { flex: 1, minWidth: 0, minHeight: 83, alignItems: 'center', gap: 7 },
  control: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlLabel: { ...mobileTypography.metadata, textAlign: 'center' },
})
