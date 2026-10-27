// @arch docs/features/personal-modules.md
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'

const entries = [
  { tab: 'reminders', icon: 'calendar-outline' },
  { tab: 'scheduled-tasks', icon: 'time-outline' },
  { tab: 'english', icon: 'language-outline' },
  { tab: 'recording', icon: 'mic-outline' },
] as const

export function PersonalModuleEntries({ query = '' }: { query?: string }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const search = query.trim().toLowerCase()

  return (
    <>
      {entries.map(({ tab, icon }) => {
        const title = t(tab === 'scheduled-tasks' ? 'schedules_title' : `personal_entry_${tab}`)
        if (search && !title.toLowerCase().includes(search)) return null
        return (
          <Pressable
            key={tab}
            accessibilityRole="button"
            testID={`personal-module-entry-${tab}`}
            onPress={() =>
              tab === 'scheduled-tasks'
                ? router.navigate('/(main)/scheduled-tasks')
                : router.navigate({ pathname: '/(main)/personal-modules', params: { tab } })
            }
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <View style={[styles.icon, { backgroundColor: colors.surface }]}>
              <Ionicons name={icon} size={25} color={colors.textSecondary} />
            </View>
            <View style={styles.body}>
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
              <Text style={{ color: colors.textMuted }}>
                {t(
                  tab === 'scheduled-tasks'
                    ? 'schedules_feature_body'
                    : `personal_entry_${tab}_body`,
                )}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '600' },
})
