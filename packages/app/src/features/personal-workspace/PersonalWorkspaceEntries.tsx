// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/remote-folders.test.ts
import { Pressable, Text, View, StyleSheet } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
export function PersonalWorkspaceEntries({ query = '' }: { query?: string } = {}) {
  const router = useRouter(), { t } = useTranslation(), { colors } = useTheme()
  const search = query.trim().toLowerCase()
  return <>{(['diary', 'memory'] as const).map(kind => {
    const title = t(`personal_${kind}`)
    if (search && !title.toLowerCase().includes(search)) return null
    return <Pressable key={kind} testID={`personal-open-${kind}`} accessibilityRole="button" accessibilityLabel={title} onPress={() => router.navigate({ pathname: '/(main)/personal-workspace', params: { kind } })}
      style={({ pressed }) => ({ minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: pressed ? colors.surfaceHover : colors.bg })}>
      <View style={{ width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
        <Ionicons name={kind === 'diary' ? 'book-outline' : 'folder-open-outline'} size={25} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: colors.textMuted }}>{t(`personal_${kind}_body`)}</Text>
      </View>
    </Pressable>
  })}</>
}
