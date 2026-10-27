// @arch docs/design/desktop/unified-desktop-control.md
// @test src/__tests__/desktop-machine-agent-layout.test.ts

import { useState, type RefObject } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { DESKTOP_WORKSPACE_HEADER_HEIGHT } from '../desktop-shell/desktopWorkspaceMetrics'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

type MachineMetadata = {
  os: string
  localLabel?: string
  statusLabel?: string
  statusColor?: string
}

type Props = {
  onBack?: () => void
  name: string
  renameLabel: string
  onRename?: () => void
  renameButtonRef?: RefObject<View | null>
}

export function DesktopMachineDetailHeader({
  onBack,
  name,
  renameLabel,
  onRename,
  renameButtonRef,
}: Props) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [renameFocused, setRenameFocused] = useState(false)
  const [renameHovered, setRenameHovered] = useState(false)
  return (
    <View
      testID="desktop-machine-detail-header"
      style={[styles.header, { borderBottomColor: colors.border }]}
      {...{ dataSet: { desktopDrag: 'true' } }}
    >
      {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={t('back')} onPress={onBack} style={{width: 36, height: 36, justifyContent: 'center', alignItems: 'center'}}><Ionicons name="arrow-back" size={18} color={colors.text} /></Pressable> : null}
      <View style={styles.copy}>
        <View style={styles.identity}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
            numberOfLines={1}
            {...{ title: name }}
          >
            {name}
          </Text>
        </View>
        {onRename ? (
          <Pressable
            ref={renameButtonRef}
            accessibilityRole="button"
            accessibilityLabel={renameLabel}
            onFocus={event => setRenameFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
            onBlur={() => setRenameFocused(false)}
            onHoverIn={() => setRenameHovered(true)}
            onHoverOut={() => setRenameHovered(false)}
            style={({ pressed }) => [
              styles.rename,
              {
                borderColor: renameFocused ? colors.brand : 'transparent',
                backgroundColor: renameHovered || pressed ? colors.surfaceHover : 'transparent',
              },
              pressed && styles.pressed,
            ]}
            onPress={onRename}
          >
            <Ionicons name="pencil-outline" size={15} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

export function DesktopMachineMetadata({ os, localLabel, statusLabel, statusColor }: MachineMetadata) {
  const { colors } = useTheme()
  return <View style={styles.badges}>
    {[localLabel, os].filter(Boolean).map(label => <Text key={label} style={[styles.badgeText, { color: colors.textSecondary }]}>{label}</Text>)}
    {statusLabel ? <View style={styles.status}>
      {statusColor ? <View style={[styles.statusDot, { backgroundColor: statusColor }]} /> : null}
      <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{statusLabel}</Text>
    </View> : null}
  </View>
}

export function DesktopMachineDetailSkeleton({ label }: { label: string }) {
  const { colors } = useTheme()
  return (
    <View
      testID="desktop-machine-detail-loading"
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={styles.skeletonStack}
    >
      {[116, 208, 132].map((height, index) => (
        <View
          key={height}
          style={[
            styles.skeletonCard,
            { height, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={[styles.skeletonTitle, { backgroundColor: colors.surfaceHover }]} />
          {index !== 2 ? (
            <View style={[styles.skeletonLine, { backgroundColor: colors.surfaceHover }]} />
          ) : null}
        </View>
      ))}
    </View>
  )
}

export function DesktopMachineDetailStatePanel({
  kind,
  title,
  body,
  actionLabel,
  onAction,
}: {
  kind: 'forbidden' | 'missing'
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  const { colors } = useTheme()
  return (
    <View
      testID={`desktop-machine-detail-${kind}`}
      style={[styles.statePanel, { backgroundColor: colors.bg, borderColor: colors.border }]}
    >
      <Ionicons
        name={kind === 'forbidden' ? 'lock-closed-outline' : 'desktop-outline'}
        size={26}
        color={kind === 'forbidden' ? colors.error : colors.textTertiary}
      />
      <Text accessibilityRole="header" style={[styles.stateTitle, { color: colors.text }]}>
        {title}
      </Text>
      <Text style={[styles.stateBody, { color: colors.textSecondary }]}>{body}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={onAction}
        style={({ pressed }) => [
          styles.stateAction,
          {
            borderColor: colors.border,
            backgroundColor: pressed ? colors.surfaceHover : colors.bg,
          },
        ]}
      >
        <Text style={[styles.stateActionText, { color: colors.text }]}>{actionLabel}</Text>
      </Pressable>
    </View>
  )
}

export const desktopMachineDetailStyles = StyleSheet.create({
  content: {
    flex: 1,
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 48,
    gap: 16,
  },
  editor: {
    borderWidth: 1,
    borderRadius: desktopControlMetrics.radiusContainer,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  warning: { marginVertical: 12 },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
    paddingVertical: 16,
  },
  row: { minHeight: desktopControlMetrics.standardControlHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 8 },
  rowLabel: { ...desktopTypography.body, flex: 1, minWidth: 0 },
  sectionTitle: { ...desktopTypography.sectionTitle },
  navigationSection: {
    minHeight: 82,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
  },
})

const styles = StyleSheet.create({
  header: {
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  copy: {
    flex: 1,
    maxWidth: 1040,
    minWidth: 0,
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  identity: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 3 },
  title: { minWidth: 0, flexShrink: 1, ...desktopTypography.windowTitle },
  rename: {
    width: desktopControlMetrics.iconButtonSize,
    height: desktopControlMetrics.iconButtonSize,
    borderRadius: desktopControlMetrics.radiusControl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { ...desktopTypography.metadata },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  skeletonStack: { width: '100%', gap: 16 },
  skeletonCard: { borderWidth: 1, borderRadius: 12, padding: 20, gap: 14 },
  skeletonTitle: { width: 140, height: 18, borderRadius: 5 },
  skeletonLine: { width: '48%', maxWidth: 360, height: 12, borderRadius: 4 },
  statePanel: {
    minHeight: 220,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: {
    marginTop: 12,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  stateBody: { maxWidth: 520, marginTop: 6, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  stateAction: {
    minHeight: 44,
    marginTop: 20,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  stateActionText: { fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.62 },
})
