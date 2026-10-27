// @arch docs/features/personal-modules.md
import { Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { styles } from '../profile/styles'
import { useScheduleDisplay } from './useScheduleDisplay'

export default function ScheduleDisplayScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const { display, ready, error, update } = useScheduleDisplay()
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <AppPageHeader title={t('personal_schedule_display')} onBack={() => router.back()} />
      <ScrollView
        style={{ backgroundColor: isDark ? colors.bg : colors.surfaceHover }}
        contentContainerStyle={[styles.scrollContent, { paddingTop: 20, gap: 20 }]}
      >
        {(['mode', 'range'] as const).map((field) => (
          <View key={field} style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              {t(field === 'mode' ? 'personal_schedule_view' : 'personal_schedule_range')}
            </Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.groupedSurface }]}>
              {(field === 'mode'
                ? (['todo', 'calendar'] as const)
                : (['all', 'today'] as const)
              ).map((value, index) => (
                <Pressable
                  key={value}
                  disabled={!ready}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: display[field] === value, disabled: !ready }}
                  style={[
                    styles.subRow,
                    { borderTopColor: colors.border, borderTopWidth: index ? undefined : 0 },
                  ]}
                  onPress={() =>
                    void update(
                      field === 'mode'
                        ? { ...display, mode: value as 'todo' | 'calendar' }
                        : { ...display, range: value as 'all' | 'today' },
                    )
                  }
                >
                  <Text style={[styles.rowLabel, { color: colors.text }]}>
                    {t(`personal_schedule_${value}`)}
                  </Text>
                  {display[field] === value ? (
                    <Ionicons name="checkmark" size={22} color={colors.brand} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.generalHint, { color: colors.errorText }]}>
            {t('personal_action_failed')}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
