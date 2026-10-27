// @arch docs/features/manager-agent.md
// @test src/__tests__/session-mode-ui.test.ts

import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import type { SessionMode } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { confirmChoice } from '../../agents/confirmChoice'
import { machineStyles } from '../styles'
import { requestSessionMode } from './sessionModeChoice'

export function SessionModeSelector(props: {
  value: SessionMode
  managerAvailable: boolean
  disabled?: boolean
  embedded?: boolean
  desktop?: boolean
  onChange: (mode: SessionMode) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (!props.managerAvailable) return null
  // Delegated work may be unstable: warn before leaving "work independently"; cancel keeps the current mode.
  const chooseMode = (mode: SessionMode) =>
    requestSessionMode(
      props.value,
      mode,
      (proceed) =>
        confirmChoice(
          {
            title: t('session_mode_manager_confirm_title'),
            message: t('session_mode_manager_confirm_message'),
            confirmLabel: t('session_mode_manager_confirm_action'),
            cancelLabel: t('cancel'),
          },
          proceed,
        ),
      props.onChange,
    )
  return (
    <View style={[styles.section, props.embedded && styles.embedded]}>
      <Text accessibilityRole="header" style={[machineStyles.launchSectionTitle, { color: colors.text }]}>
        {t('session_work_mode')}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('session_work_mode')}>
        {(['standard', 'manager'] as const).map((mode) => {
          const selected = props.value === mode
          const label = t(mode === 'manager' ? 'session_mode_manager' : 'session_mode_standard')
          const description = t(mode === 'manager' ? 'session_mode_manager_hint' : 'session_mode_standard_hint')
          return (
            <Pressable
              key={mode}
              testID={`session-mode-${mode}`}
              accessibilityRole="radio"
              accessibilityLabel={`${label}\n${description}`}
              accessibilityState={{ checked: selected, disabled: Boolean(props.disabled) }}
              {...(props.desktop ? { 'aria-checked': selected, 'aria-disabled': Boolean(props.disabled) } : {})}
              onPress={() => chooseMode(mode)}
              disabled={props.disabled}
              style={({ pressed }) => [
                styles.option,
                props.desktop && { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 8, backgroundColor: selected ? colors.selectionBackground : colors.bg },
                props.disabled && styles.disabled,
                pressed && { backgroundColor: colors.surface },
              ]}
            >
              {!props.desktop ? <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? colors.brand : colors.textSecondary}
                style={styles.radio}
                accessible={false}
                aria-hidden
              /> : null}
              <View style={styles.copy}>
                <Text style={[styles.optionTitle, { color: colors.text }]}>{label}</Text>
                <Text style={[styles.description, { color: colors.textSecondary }]}>
                  {description}
                </Text>
              </View>
              {props.desktop && selected ? <Ionicons name="checkmark" size={16} color={colors.textSecondary} /> : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 16 },
  embedded: { marginTop: 0 },
  option: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    gap: 10,
    borderRadius: 8,
  },
  radio: { marginTop: 1 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  optionTitle: { fontSize: 14, lineHeight: 20, fontWeight: '400', ...(Platform.OS !== 'web' && mobileTypography.body) },
  description: { fontSize: 13, lineHeight: 19, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  disabled: { opacity: 0.55 },
})
