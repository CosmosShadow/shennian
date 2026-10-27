// @arch docs/features/machine-onboarding.md
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { copySetupText } from '../utils/setupClipboard'
import { mobileTypography } from '../../../theme/mobileTypography'

export function SetupText({ children, title = false }: { children: ReactNode; title?: boolean }) {
  const { colors, isDark } = useTheme()
  const secondaryText = Platform.OS === 'web' && !isDark ? '#4b4b4b' : colors.textSecondary
  return (
    <Text
      selectable
      style={{
        ...(title ? mobileTypography.sectionTitle : mobileTypography.body),
        color: title ? colors.text : secondaryText,
      }}
    >
      {children}
    </Text>
  )
}
export function SetupRow({
  title,
  detail,
  onPress,
  icon = 'chevron-forward',
  disabled = false,
}: {
  title: string
  detail?: string
  onPress: () => void
  icon?: keyof typeof Ionicons.glyphMap
  disabled?: boolean
}) {
  const { colors, isDark } = useTheme()
  const secondaryText = Platform.OS === 'web' && !isDark ? '#4b4b4b' : colors.textSecondary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceHover : colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ ...mobileTypography.body, color: colors.text }}>{title}</Text>
        {detail ? (
          <Text style={{ ...mobileTypography.secondary, color: secondaryText }}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Ionicons name={icon} size={20} color={secondaryText} />
    </Pressable>
  )
}
export function SetupCopy({
  value,
  label,
  collapsible = false,
  showValue = true,
}: {
  value: string
  label: string
  collapsible?: boolean
  showValue?: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const inFlight = useRef(false)
  const currentValue = useRef(value)
  currentValue.current = value
  useEffect(() => {
    setStatus('idle')
    setExpanded(false)
  }, [value])
  const copy = async () => {
    if (inFlight.current) return
    inFlight.current = true
    const result = await copySetupText(value, Clipboard.setStringAsync)
    if (currentValue.current === value) setStatus(result)
    inFlight.current = false
  }
  return (
    <View style={{ gap: 8 }}>
      {showValue ? (
        <Text
          selectable
          numberOfLines={collapsible && !expanded && status !== 'failed' ? 3 : undefined}
          style={{ ...mobileTypography.secondary, color: colors.text }}
        >
          {value}
        </Text>
      ) : null}
      {showValue && collapsible ? (
        <SetupRow
          title={t(expanded ? 'collapse' : 'setup_show_full_prompt')}
          icon={expanded ? 'chevron-up' : 'chevron-down'}
          onPress={() => setExpanded((value) => !value)}
        />
      ) : null}
      <SetupRow
        title={status === 'copied' ? t('copied') : label}
        icon={status === 'copied' ? 'checkmark' : 'copy-outline'}
        onPress={() => {
          void copy()
        }}
      />
      {status === 'failed' ? (
        <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
          {t('setup_copy_failed')}
        </Text>
      ) : null}
    </View>
  )
}
