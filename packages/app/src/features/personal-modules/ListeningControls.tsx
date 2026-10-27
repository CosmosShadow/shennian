// @arch docs/features/listening.md
// @test src/__tests__/listening-controls.test.ts
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { showListeningMenu } from './listeningMenu'
import { styles as settingsStyles } from '../profile/styles'
import type { ListeningPreferences } from './types'
export type ListeningSettingsProps = {
  preferences: ListeningPreferences
  busy: boolean
  englishEnabled: boolean | null
  save: (next: ListeningPreferences) => void
  setEnglish: (value: boolean) => void
  analysisProvider?: 'none' | 'decision' | 'fallback'
  section?: 'quick' | 'advanced'
}
export function ListeningControls({
  preferences,
  busy,
  englishEnabled,
  save,
  setEnglish,
  analysisProvider,
  section = 'quick',
}: ListeningSettingsProps) {
  const { t } = useTranslation(),
    { colors } = useTheme()
  const row = { ...settingsStyles.subRow, borderTopColor: colors.border }
  const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
    listening_mode_assist: 'sparkles-outline',
    listening_english: 'school-outline',
    listening_feedback: 'volume-medium-outline',
    listening_trigger: 'flash-outline',
    listening_context: 'chatbubbles-outline',
  }
  const label = { ...mobileTypography.body, color: colors.text, flex: 1 }
  const toggle = (
    key: string,
    value: boolean | null,
    change: (value: boolean) => void,
    disabled = busy,
  ) => (
    <View style={row}>
      <Ionicons name={icons[key]} size={20} color={colors.textSecondary} />
      <Text style={label}>{t(key)}</Text>
      {value === null ? <ActivityIndicator accessibilityLabel={t(key)} /> : <Switch
        accessibilityLabel={t(key)}
        disabled={disabled}
        value={value}
        onValueChange={change}
      />}
    </View>
  )
  const choice = (
    key: string,
    value: string,
    options: string[],
    change: (index: number) => void,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t(key)}, ${t(value)}`}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={() =>
        showListeningMenu(
          t(key),
          options.map((option) => `${option === value ? '✓ ' : ''}${t(option)}`),
          t('cancel'),
          change,
        )
      }
      style={({ pressed }) => ({ ...row, opacity: busy ? 0.5 : pressed ? 0.7 : 1 })}
    >
      <Ionicons name={icons[key]} size={20} color={colors.textSecondary} />
      <Text style={label}>{t(key)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <Text style={{ ...mobileTypography.body, color: colors.textSecondary, flexShrink: 1 }}>
          {t(value)}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </View>
    </Pressable>
  )
  return (
    <View
      style={[
        settingsStyles.settingsGroup,
        {
          backgroundColor: colors.groupedSurface,
          marginTop: section === 'quick' ? 24 : 0,
          marginBottom: 24,
        },
      ]}
    >
      {section === 'quick' ? (
        <>
          {toggle('listening_mode_assist', preferences.mode === 'assist', (value) =>
            save({ ...preferences, mode: value ? 'assist' : 'transcribe' }),
          )}
          {toggle(
            'listening_english',
            englishEnabled === null ? null : preferences.mode === 'assist' && englishEnabled,
            setEnglish,
            busy || preferences.mode !== 'assist',
          )}
          {preferences.mode === 'assist' ? (
            <>
              {choice(
                'listening_feedback',
                `listening_feedback_${preferences.feedback}`,
                [
                  'listening_feedback_silent',
                  'listening_feedback_balanced',
                  'listening_feedback_active',
                ],
                (index) =>
                  save({
                    ...preferences,
                    feedback: (['silent', 'balanced', 'active'] as const)[index]!,
                  }),
              )}
              {choice(
                'listening_trigger',
                `listening_trigger_${preferences.trigger ?? 'contextual'}`,
                ['listening_trigger_contextual', 'listening_trigger_name'],
                (index) => save({ ...preferences, trigger: index === 1 ? 'name' : 'contextual' }),
              )}
            </>
          ) : null}
        </>
      ) : (
        <>
          {toggle('listening_context', preferences.agentContext, (value) => {
            if (!value) save({ ...preferences, agentContext: false })
            else
              Alert.alert(t('listening_context'), t('listening_context_consent'), [
                { text: t('cancel'), style: 'cancel' },
                {
                  text: t('personal_confirm'),
                  onPress: () => save({ ...preferences, agentContext: true }),
                },
              ])
          })}
          <Pressable
            accessibilityRole="button"
            onPress={() => Alert.alert(t('listening_privacy'), t('personal_recording_hint'))}
            style={({ pressed }) => ({ ...row, opacity: pressed ? 0.7 : 1 })}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} />
            <Text style={label}>{t('listening_privacy')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
          {analysisProvider && analysisProvider !== 'none' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(
                  t('listening_analysis_status'),
                  t(
                    analysisProvider === 'decision'
                      ? 'listening_decision_used'
                      : 'listening_decision_fallback',
                  ),
                )
              }
              style={({ pressed }) => ({ ...row, opacity: pressed ? 0.7 : 1 })}
            >
              <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
              <Text style={label}>{t('listening_analysis_status')}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  )
}
