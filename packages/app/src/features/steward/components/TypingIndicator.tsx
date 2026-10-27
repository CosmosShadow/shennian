// @arch docs/tasks/20260929-1455_神念管家本机入口.md
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useTheme } from '../../../hooks/useTheme'

function Dot({ delay, color }: { delay: number; color: string }) {
  const opacity = useRef(new Animated.Value(0.3)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 350, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [delay, opacity])
  return <Animated.View style={[styles.dot, { backgroundColor: color, opacity }]} />
}

/** A quiet three-dot bubble while the steward is thinking, before any reply text exists. */
export function TypingIndicator() {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <View style={[styles.bubble, { backgroundColor: colors.surfaceHover }]}>
        <Dot delay={0} color={colors.textTertiary} />
        <Dot delay={150} color={colors.textTertiary} />
        <Dot delay={300} color={colors.textTertiary} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  bubble: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
