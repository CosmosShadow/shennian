import { useEffect, useRef } from 'react'
import {
  View,
  Animated,
  StyleSheet,
  type DimensionValue,
  type ViewStyle,
} from 'react-native'

export function SkeletonLine({
  width = '100%',
  height = 14,
  style,
}: {
  width?: DimensionValue
  height?: number
  style?: ViewStyle
}) {
  const pulse = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [pulse])

  return (
    <Animated.View
      style={[
        styles.line,
        { width, height, borderRadius: height / 2, opacity: pulse },
        style,
      ]}
    />
  )
}

export function SessionSkeleton() {
  return (
    <View style={styles.session}>
      <SkeletonLine width={40} height={40} style={{ borderRadius: 20 }} />
      <View style={styles.sessionLines}>
        <SkeletonLine width="60%" height={12} />
        <SkeletonLine width="40%" height={10} style={{ marginTop: 6 }} />
      </View>
    </View>
  )
}

export function ChatSkeleton() {
  return (
    <View style={styles.chat}>
      <View style={styles.userSkel}>
        <SkeletonLine
          width="70%"
          height={36}
          style={{ borderRadius: 18, alignSelf: 'flex-end' }}
        />
      </View>
      <View style={styles.agentSkel}>
        <SkeletonLine width="85%" height={60} style={{ borderRadius: 18 }} />
      </View>
      <View style={styles.agentSkel}>
        <SkeletonLine width="50%" height={36} style={{ borderRadius: 18 }} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  line: { backgroundColor: '#e5e5e5' },
  session: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  sessionLines: { flex: 1 },
  chat: { padding: 16, gap: 12 },
  userSkel: { alignItems: 'flex-end', paddingHorizontal: 16 },
  agentSkel: { paddingHorizontal: 16 },
})
