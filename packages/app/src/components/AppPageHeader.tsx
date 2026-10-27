import { normalizeDisplayText } from './headEllipsis'
// @arch docs/features/free-growth-phase.md#3-客户端信息架构
// @arch docs/design/components.md#2-返回键
// @test src/__tests__/app-page-header.test.ts

import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../hooks/useTheme'
import type { AppConnectivityStatus } from '../hooks/appConnectivityState'
import { ActionIconButton } from './ActionIconButton'
import { mobileTypography } from '../theme/mobileTypography'

export function AppPageHeader({
  title: incomingTitle,
  subtitle,
  onBack,
  leading,
  trailing,
  compact = false,
  showsConnectivityStatus = false,
  connectivityStatus,
  backTestID,
  backgroundColor,
  hideDivider = false,
  sideWidth = 48,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  leading?: ReactNode
  trailing?: ReactNode
  compact?: boolean
  showsConnectivityStatus?: boolean
  connectivityStatus?: AppConnectivityStatus
  backTestID?: string
  backgroundColor?: string
  hideDivider?: boolean
  sideWidth?: number
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const title = normalizeDisplayText(incomingTitle)
  const visibleTitle =
    showsConnectivityStatus && connectivityStatus === 'disconnected'
      ? t('app_header_disconnected', { title })
      : title
  return (
    <View
      testID="app-page-header"
      style={[
        styles.header,
        subtitle ? styles.headerWithSubtitle : null,
        {
          backgroundColor: backgroundColor ?? colors.bg,
          borderBottomColor: hideDivider ? 'transparent' : (colors.separator ?? colors.border),
        },
      ]}
    >
      <View style={[styles.side, { width: sideWidth, alignItems: 'flex-start' }]}>
        {onBack ? <HeaderBackButton testID={backTestID} onPress={onBack} /> : leading}
      </View>
      <View style={styles.heading}>
      <Text
        style={[compact ? styles.compactTitle : styles.title, { color: colors.text }]}
        numberOfLines={1}
      >
        {visibleTitle}
      </Text>
      {subtitle ? <Text numberOfLines={1} style={[mobileTypography.metadata, { color: colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.side, { width: sideWidth, alignItems: 'flex-end' }]}>{trailing}</View>
    </View>
  )
}

export function HeaderBackButton({
  onPress,
  testID,
  badge,
  accessibilityLabel,
}: {
  onPress: () => void
  testID?: string
  badge?: ReactNode
  accessibilityLabel?: string
}) {
  const { t } = useTranslation()
  return (
    <ActionIconButton
      icon="back"
      label={accessibilityLabel ?? t('back')}
      testID={testID}
      onPress={onPress}
    >
      {badge ? (
        <View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.backBadge}
        >
          {badge}
        </View>
      ) : null}
    </ActionIconButton>
  )
}

export function HeaderIconButton({
  icon,
  label,
  onPress,
  onLongPress,
  accessibilityHint,
  testID,
  destructive = false,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  onPress: () => void
  onLongPress?: () => void
  accessibilityHint?: string
  testID?: string
  destructive?: boolean
  disabled?: boolean
}) {
  const { colors } = useTheme()
  return (
    <ActionIconButton
      icon={icon}
      label={label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityHint={accessibilityHint}
      color={destructive ? colors.error : colors.text}
    />
  )
}

const styles = StyleSheet.create({
  heading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  headerWithSubtitle: { height: 60 },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  backBadge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 32,
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  title: { textAlign: 'center', ...mobileTypography.navigationTitle },
  compactTitle: { textAlign: 'center', fontSize: 14, lineHeight: 19, fontWeight: '600' },
})
