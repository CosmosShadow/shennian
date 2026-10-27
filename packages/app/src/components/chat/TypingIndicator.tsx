import { useEffect, useRef } from 'react'
import { View, StyleSheet, Animated } from 'react-native'
import { useTheme } from '../../hooks/useTheme'

function Dot({ delay, color }: { delay: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -6, duration: 250, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [anim, delay])

  return (
    <Animated.View
      style={[styles.dot, { backgroundColor: color, transform: [{ translateY: anim }] }]}
    />
  )
}

export function TypingIndicator() {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <View style={[styles.bubble, { backgroundColor: colors.surface }]}>
        <Dot delay={0} color={colors.textTertiary} />
        <Dot delay={150} color={colors.textTertiary} />
        <Dot delay={300} color={colors.textTertiary} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  bubble: {
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
})
