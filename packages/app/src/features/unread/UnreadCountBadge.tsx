// @arch docs/features/unread-notification-center.md
// @test src/__tests__/unread-navigation.test.ts

import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'

export function UnreadCountBadge({ count, testID }: { count: number; testID?: string }) {
  const { colors } = useTheme()
  if (count <= 0) return null
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: colors.error }]}>
      <Text style={styles.text}>{count > 99 ? '99+' : String(count)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
})
