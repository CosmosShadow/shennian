// @test src/__tests__/scheduled-tasks-presentation.test.ts
// @arch docs/features/conversation-schedules.md
// @test src/__tests__/personal-scheduled-tasks.test.ts
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { mobileTypography } from '../../theme/mobileTypography'
import { useTheme } from '../../hooks/useTheme'
export function ScheduleExecutionChoice({
  value,
  onChange,
  disabled,
  detailed = false,
}: {
  detailed?: boolean
  value: 'main' | 'worker'
  onChange: (value: 'main' | 'worker') => void
  disabled: boolean
}) {
  const { t } = useTranslation(),
    { colors } = useTheme()
  if (detailed)
    return (
      <View style={{ gap: 8 }}>
        <Text style={[mobileTypography.secondary, { color: colors.textSecondary }]}>
          {t('schedules_execution')}
        </Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('schedules_execution')}
          style={{ backgroundColor: colors.groupedSurface, borderRadius: 12, overflow: 'hidden' }}
        >
          {(['main', 'worker'] as const).map((mode, index) => (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === mode, disabled }}
              disabled={disabled}
              onPress={() => onChange(mode)}
              style={({ pressed }) => ({
                minHeight: 64,
                paddingHorizontal: 16,
                paddingVertical: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                borderTopWidth: index ? 0.5 : 0,
                borderTopColor: colors.groupedSeparator,
                backgroundColor: pressed ? colors.surfaceHover : colors.groupedSurface,
                opacity: disabled ? 0.5 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[mobileTypography.body, { color: colors.text }]}>
                  {t(`schedules_execution_${mode}`)}
                </Text>
                <Text style={[mobileTypography.metadata, { color: colors.textMutedOnSurface }]}>
                  {t(`schedules_execution_${mode}_hint`)}
                </Text>
              </View>
              <Ionicons
                name={value === mode ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={value === mode ? colors.navigationSelected : colors.textMutedOnSurface}
              />
            </Pressable>
          ))}
        </View>
      </View>
    )
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.textSecondary }}>{t('schedules_execution')}</Text>
      {(['main', 'worker'] as const).map((mode) => (
        <Pressable
          key={mode}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === mode, disabled }}
          disabled={disabled}
          onPress={() => onChange(mode)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: value === mode ? colors.brand : colors.text }}>
            {value === mode ? '✓ ' : ''}
            {t(`schedules_execution_${mode}`)}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}
