// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
import { Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
export function ContentEntry({ query = '' }: { query?: string }) {
  const { t } = useTranslation(), { colors } = useTheme(), router = useRouter()
  if (query && !t('content_entry').toLowerCase().includes(query.toLowerCase())) return null
  return <Pressable accessibilityRole="button" accessibilityLabel={t('content_entry')} testID="interactive-content-entry" onPress={() => router.navigate('/(main)/content')}
    style={{ minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
    <View style={{ width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
      <Ionicons name="code-slash-outline" size={25} color={colors.brand} accessible={false} />
    </View>
    <View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{t('content_entry')}</Text>
      <Text style={{ color: colors.textMuted }}>{t('content_entry_body')}</Text></View>
  </Pressable>
}
