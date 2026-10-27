// @arch docs/features/voice-shennian.md
// @test packages/app/src/__tests__/voice-chief-floating.test.ts
// @test packages/app/src/__tests__/voice-chief-overlay-geometry.test.ts

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useVoiceChiefController } from './VoiceChiefCallContext'
import { useAppIsActive } from './useAppIsActive'
import {
  VOICE_CHIEF_COLLAPSED_SIZE,
  clampVoiceChiefOverlayPosition,
  getDefaultVoiceChiefOverlayPosition,
  getVoiceChiefOverlaySize,
  snapVoiceChiefOverlayPosition,
} from './overlayGeometry'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function VoiceChiefFloatingHost() {
  const controller = useVoiceChiefController()
  const {
    call,
    mode,
    clearCall,
    floatingPosition,
    setFloatingPosition,
    restoreCall,
  } = controller
  const appIsActive = useAppIsActive()
  const { colors } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const overlayMode = 'collapsed'
  const overlaySize = getVoiceChiefOverlaySize({ width, height })
  const position = useRef(new Animated.ValueXY({ x: 18, y: 80 })).current
  const buttonPulse = useRef(new Animated.Value(0)).current
  const meter = useRef(new Animated.Value(0.18)).current
  const dragStartRef = useRef({ x: 18, y: 80 })
  const floatingVisible = Boolean(call) && mode === 'floating'
  const animateVisuals = floatingVisible && overlayMode === 'collapsed' && appIsActive

  useEffect(() => {
    if (!call || call.state !== 'ended') return
    clearCall()
  }, [call?.state, clearCall])

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(buttonPulse, { toValue: 1, duration: 520, useNativeDriver: false }),
        Animated.timing(buttonPulse, { toValue: 0, duration: 620, useNativeDriver: false }),
      ]),
    )
    if (animateVisuals) loop.start()
    else buttonPulse.setValue(0)
    return () => loop.stop()
  }, [animateVisuals, buttonPulse])

  useEffect(() => {
    if (!animateVisuals) {
      meter.stopAnimation()
      meter.setValue(0.18)
      return
    }
    Animated.timing(meter, {
      toValue: clamp(call?.meterLevel ?? 0, 0.08, 1),
      duration: 120,
      useNativeDriver: false,
    }).start()
  }, [animateVisuals, call?.meterLevel, meter])

  useEffect(() => {
    const viewport = { width, height }
    const stored = floatingPosition || getDefaultVoiceChiefOverlayPosition(viewport, overlaySize)
    const next = clampVoiceChiefOverlayPosition(stored, viewport, overlaySize)
    position.setValue(next)
    dragStartRef.current = next
    if (floatingPosition && (next.x !== floatingPosition.x || next.y !== floatingPosition.y)) {
      setFloatingPosition(next)
    }
  }, [
    floatingPosition,
    height,
    overlaySize.height,
    overlaySize.width,
    position,
    setFloatingPosition,
    width,
  ])

  const commitPosition = useCallback(
    (point: { x: number; y: number }, snap: boolean) => {
      const viewport = { width, height }
      const next = snap
        ? snapVoiceChiefOverlayPosition(point, viewport, overlaySize)
        : clampVoiceChiefOverlayPosition(point, viewport, overlaySize)
      setFloatingPosition(next)
      position.setValue(next)
      dragStartRef.current = next
      return next
    },
    [height, overlaySize.height, overlaySize.width, position, setFloatingPosition, width],
  )

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          position.stopAnimation((value) => {
            dragStartRef.current = value
          })
        },
        onPanResponderMove: (_, gesture) => {
          position.setValue(
            clampVoiceChiefOverlayPosition(
              { x: dragStartRef.current.x + gesture.dx, y: dragStartRef.current.y + gesture.dy },
              { width, height },
              overlaySize,
            ),
          )
        },
        onPanResponderRelease: (_, gesture) => {
          const snapped = commitPosition(
            { x: dragStartRef.current.x + gesture.dx, y: dragStartRef.current.y + gesture.dy },
            true,
          )
          Animated.spring(position, {
            toValue: snapped,
            useNativeDriver: false,
            bounciness: 4,
          }).start()
        },
        onPanResponderTerminate: () => {
          position.stopAnimation((value) => commitPosition(value, false))
        },
      }),
    [commitPosition, height, overlaySize.height, overlaySize.width, position, width],
  )

  if (!call || mode !== 'floating') return null

  const activeColor =
    call.state === 'error'
      ? colors.error
      : call.state === 'speaking'
        ? colors.brand
        : call.state === 'thinking' || call.state === 'connecting'
          ? colors.warning
          : colors.success

  const restore = () => {
    restoreCall()
    router.navigate('/(main)/voice-chief')
  }
  return (
    <Animated.View
      testID="voice-chief-overlay"
      {...panResponder.panHandlers}
      style={[
        styles.root,
        styles.collapsedRoot,
        {
          width: overlaySize.width,
          height: overlaySize.height,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.text,
          transform: [
            ...position.getTranslateTransform(),
            ...(overlayMode === 'collapsed'
              ? [
                  {
                    translateY: buttonPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -2],
                    }),
                  },
                  {
                    scale: buttonPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.045],
                    }),
                  },
                ]
              : []),
          ],
        },
      ]}
    >
      {(
        <Pressable
          testID="voice-chief-overlay-restore"
          accessibilityRole="button"
          accessibilityLabel={t('voice_chief_floating_restore')}
          onPress={restore}
          style={styles.restoreButton}
        >
          <View
            style={[
              styles.waveCircle,
              { backgroundColor: `${activeColor}14`, borderColor: `${activeColor}44` },
            ]}
          >
            {[0.42, 0.78, 1, 0.72, 0.48].map((gain, index) => (
              <Animated.View
                key={index}
                style={[
                  styles.waveBar,
                  {
                    height: meter.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12 + index * 1.5, 16 + 26 * gain],
                    }),
                    backgroundColor: activeColor,
                    opacity: index === 2 ? 0.96 : 0.7,
                  },
                ]}
              />
            ))}
          </View>
        </Pressable>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 1000,
    elevation: 24,
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    overflow: 'hidden',
  },
  collapsedRoot: { borderRadius: VOICE_CHIEF_COLLAPSED_SIZE / 2 },
  restoreButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  waveCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  waveBar: { width: 5, borderRadius: 3 },
})
