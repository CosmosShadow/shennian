import Feather from '@expo/vector-icons/Feather'
import { DOWNLOAD_FEEDBACK_MS } from './downloadFeedbackPolicy'
import { useEffect, useRef } from 'react'
import { Animated, Text, StyleSheet, View, type StyleProp, type TextStyle } from 'react-native'

type ToastProps = {
  message: string
  visible: boolean
  type?: 'error' | 'success' | 'info'
  onHide?: () => void
  duration?: number
  textStyle?: StyleProp<TextStyle>
}

export function Toast({ message, visible, type = 'error', onHide, duration = type === 'success' || type === 'info' ? DOWNLOAD_FEEDBACK_MS : 2800, textStyle }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      const animation = Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(duration),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ])
      animation.start(({ finished }) => { if (finished) onHide?.() })
      return () => animation.stop()
    }
  }, [visible, message, duration])

  if (!visible) return null

  const palette = {
    error: { backgroundColor: '#fff1f2', borderColor: '#fecdd3', textColor: '#be123c' },
    success: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', textColor: '#15803d' },
    info: { backgroundColor: '#eef2ff', borderColor: '#c7d2fe', textColor: '#4338ca' },
  }[type]

  return (
    <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="none">
      <View
        style={[
          styles.container,
          {
            backgroundColor: palette.backgroundColor,
            borderColor: palette.borderColor,
          },
        ]}
      >
        <Feather name={type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info'} size={18} color={palette.textColor} />
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.text, textStyle, { color: palette.textColor }]} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
    zIndex: 9999,
  },
  container: {
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  text: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    textAlign: 'center',
  },
})
