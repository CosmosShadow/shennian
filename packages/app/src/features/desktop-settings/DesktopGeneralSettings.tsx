// @arch docs/features/desktop-settings-information-architecture.md
// @arch docs/design/desktop/unified-desktop-control.md#设置页面
// @test ../../__tests__/desktop-general-settings.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useState, type ReactNode } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { ChatFontSize } from '../chat/preferences/chatFontSize'
import { chatFontSizes } from '../chat/preferences/chatFontSize'
import { useChatFontSize } from '../../hooks/useChatFontSize'
import type { useTheme } from '../../hooks/useTheme'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

type Colors = ReturnType<typeof useTheme>['colors']

type Choice<T extends string> = {
  value: T
  label: string
}

type Props = {
  colors: Colors
  currentTheme: 'light' | 'dark' | 'system'
  currentLanguage: 'zh' | 'en'
  onSelectTheme: (theme: 'light' | 'dark' | 'system') => void
  onSelectLanguage: (language: 'zh' | 'en') => void
}

export function DesktopGeneralSettings({
  colors,
  currentTheme,
  currentLanguage,
  onSelectTheme,
  onSelectLanguage,
}: Props) {
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const compact = width < 940
  const { size, setSize, saveFailed } = useChatFontSize()
  const themeChoices: Choice<Props['currentTheme']>[] = [
    { value: 'system', label: t('theme_system') },
    { value: 'light', label: t('theme_light') },
    { value: 'dark', label: t('theme_dark') },
  ]
  const languageChoices: Choice<Props['currentLanguage']>[] = [
    { value: 'zh', label: t('lang_zh') },
    { value: 'en', label: t('lang_en') },
  ]
  const fontChoices: Choice<ChatFontSize>[] = chatFontSizes.map((value) => ({
    value,
    label: t(`chat_font_${value}`),
  }))

  return (
    <View testID="desktop-settings-general" style={[styles.group, { borderColor: colors.border }]}>
      <DesktopSettingRow
        compact={compact}
        first
        label={t('theme')}
        colors={colors}
        borderColor={colors.border}
        control={
          <DesktopSettingSelect
            accessibilityLabel={t('theme')}
            colors={colors}
            choices={themeChoices}
            selected={currentTheme}
            testIDPrefix="desktop-theme"
            onSelect={onSelectTheme}
          />
        }
      />
      <DesktopSettingRow
        compact={compact}
        label={t('language')}
        colors={colors}
        borderColor={colors.border}
        control={
          <DesktopSettingSelect
            accessibilityLabel={t('language')}
            colors={colors}
            choices={languageChoices}
            selected={currentLanguage}
            testIDPrefix="desktop-language"
            onSelect={onSelectLanguage}
          />
        }
      />
      <DesktopSettingRow
        compact={compact}
        label={t('desktop_font_size')}
        colors={colors}
        borderColor={colors.border}
        control={
          <DesktopSettingChoices
            accessibilityLabel={t('desktop_font_size')}
            colors={colors}
            choices={fontChoices}
            selected={size}
            testIDPrefix="desktop-chat-font"
            onSelect={(next) => {
              void setSize(next)
            }}
          />
        }
        error={saveFailed ? t('chat_font_save_failed') : null}
      />
    </View>
  )
}

function DesktopSettingSelect<T extends string>({ accessibilityLabel, colors, choices, selected, testIDPrefix, onSelect }: {
  accessibilityLabel: string; colors: Colors; choices: Choice<T>[]; selected: T; testIDPrefix: string; onSelect(value: T): void
}) {
  return <select aria-label={accessibilityLabel} data-testid={testIDPrefix} value={selected}
    onChange={event => onSelect(event.target.value as T)}
    style={{ width: '100%', minHeight: 36, borderRadius: 8, padding: '6px 12px', border: `1px solid ${colors.textMuted}`, background: colors.bg, color: colors.text, font: 'inherit', fontSize: 14 }}>
    {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
  </select>
}

function DesktopSettingRow({
  compact,
  first = false,
  label,
  colors,
  control,
  description,
  error,
  retry,
  borderColor,
}: {
  compact: boolean
  first?: boolean
  label: string
  colors: Colors
  control: ReactNode
  description?: string
  error?: string | null
  retry?: () => void
  borderColor: string
}) {
  const { t } = useTranslation()
  return (
    <View
      style={[
        styles.row,
        compact && styles.rowCompact,
        first && styles.firstRow,
        { borderTopColor: borderColor },
      ]}
    >
      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        {description ? (
          <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
            {error}
          </Text>
        ) : null}
        {retry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('retry')}
            onPress={retry}
            style={styles.retryButton}
          >
            <Text style={{ color: colors.brand }}>{t('retry')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.control, compact && styles.controlCompact]}>{control}</View>
    </View>
  )
}

function DesktopSettingChoices<T extends string>({
  accessibilityLabel,
  colors,
  choices,
  selected,
  disabled = false,
  testIDPrefix,
  onSelect,
}: {
  accessibilityLabel: string
  colors: Colors
  choices: Choice<T>[]
  selected: T | null
  disabled?: boolean
  testIDPrefix: string
  onSelect: (value: T) => void
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.segmentedControl, { borderColor: colors.border }]}
    >
      {choices.map((choice, index) => (
        <DesktopSettingChoice
          key={choice.value}
          colors={colors}
          first={index === 0}
          label={choice.label}
          selected={selected === choice.value}
          disabled={disabled}
          testID={`${testIDPrefix}-${choice.value}`}
          onPress={() => onSelect(choice.value)}
        />
      ))}
    </View>
  )
}

function DesktopSettingChoice({
  colors,
  first,
  label,
  selected,
  disabled,
  testID,
  onPress,
}: {
  colors: Colors
  first: boolean
  label: string
  selected: boolean
  disabled: boolean
  testID: string
  onPress: () => void
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={Boolean(disabled)}
      accessibilityLabel={label}
      testID={testID}
      onFocus={event => setFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.choice,
        !first && { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth },
        {
          backgroundColor: selected
            ? colors.selectionBackground
            : pressed
              ? colors.surfaceHover
              : colors.bg,
          opacity: disabled ? 0.55 : 1,
        },
        focused && { borderColor: colors.brand, borderWidth: 2 },
      ]}
    >
      {selected ? <Ionicons name="checkmark" size={16} color={colors.textSecondary} /> : null}
      <Text style={[styles.choiceLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  group: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: desktopControlMetrics.radiusContainer,
  },
  retryButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  row: {
    width: '100%',
    minWidth: 0,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 12,
  },
  firstRow: {
    borderTopWidth: 0,
  },
  copy: {
    flex: 1,
    minWidth: 180,
    gap: 5,
  },
  label: {
    maxWidth: '100%',
    flexShrink: 1,
    ...desktopTypography.body,
    fontWeight: '500',
  },
  description: {
    maxWidth: '100%',
    flexShrink: 1,
    ...desktopTypography.metadata,
  },
  error: {
    maxWidth: '100%',
    flexShrink: 1,
    ...desktopTypography.metadata,
  },
  control: {
    width: 384,
    maxWidth: '55%',
  },
  controlCompact: {
    width: '100%',
    maxWidth: '100%',
  },
  segmentedControl: {
    width: '100%',
    maxWidth: '100%',
    minHeight: desktopControlMetrics.standardControlHeight,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: desktopControlMetrics.radiusControl,
  },
  choice: {
    minWidth: 0,
    minHeight: desktopControlMetrics.standardControlHeight,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  choiceLabel: {
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 1,
    ...desktopTypography.control,
    textAlign: 'center',
  },
})
