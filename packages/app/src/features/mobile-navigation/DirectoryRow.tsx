// @arch docs/architecture/mobile-navigation.md
import type { ComponentProps, ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTheme } from '../../hooks/useTheme'

export function DirectoryRow({ title, icon, onPress, testID, accessory, subtitle, time, color, conversationStyle = false }: {
  title: string; icon: ComponentProps<typeof Ionicons>['name']; onPress?: () => void
  testID?: string; accessory?: ReactNode; subtitle?: string; time?: string; color?: string; conversationStyle?: boolean
}) {
  const { colors } = useTheme()
  const style = [styles.row, conversationStyle && styles.conversation, { backgroundColor: colors.bg, borderBottomColor: colors.separator }]
  const content = <>
    <View style={conversationStyle ? [styles.avatar, { backgroundColor: color ?? colors.surface }] : undefined}>
      <Ionicons name={icon} size={25} color={conversationStyle ? '#FFFFFF' : colors.navigationSelected} />
    </View>
    <View style={{ flex: 1, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1} style={[styles.title, { flex: 1, color: colors.text }]}>{title}</Text>
        {time ? <Text style={{ fontSize: 13, color: colors.textMuted }}>{time}</Text> : null}
      </View>
      {conversationStyle || subtitle ? <Text numberOfLines={1} style={{ color: colors.textMuted }}>{subtitle || ' '}</Text> : null}
    </View>
    {accessory}
    {!conversationStyle && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
  </>
  return onPress ? <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={[title, subtitle, time].filter(Boolean).join(', ')}
    onPress={onPress} style={({ pressed }) => [...style, pressed && { backgroundColor: colors.surfaceHover }]}>{content}</Pressable>
    : <View testID={testID} style={style}>{content}</View>
}
const styles = StyleSheet.create({
  row: { minHeight: 62, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  conversation: { minHeight: 76, paddingVertical: 10, gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
})
