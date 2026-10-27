import { useEffect, useRef } from 'react'
import { Animated, View, StyleSheet } from 'react-native'

export function ReplyDots({ color, label }: {
  color: string; label: string
}) {
  const phases = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current
  useEffect(() => {
    const animation = Animated.loop(Animated.stagger(160, phases.map((opacity) => Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]))))
    animation.start()
    return () => animation.stop()
  }, [phases])
  return <View accessibilityLabel={label} accessibilityRole="progressbar"
    style={styles.indicator}>
    {phases.map((phase, index) => <Animated.View key={index} style={[styles.dot, {
      backgroundColor: color, opacity: phase.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
    }]} />)}
  </View>
}
const styles = StyleSheet.create({
  indicator: { alignSelf: 'flex-start', flexDirection: 'row', gap: 5,
    height: 40, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3 },
})
