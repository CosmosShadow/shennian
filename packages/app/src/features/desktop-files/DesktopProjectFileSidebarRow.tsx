// @arch docs/features/desktop-project-files-opaque-protocol.md
// @test src/__tests__/project-files-sidebar.test.ts

import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import type { ProjectFileSidebarRow as Row } from './model/desktopProjectFilesUiState'
import { useDesktopProjectFilesController } from './DesktopProjectFilesController'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export function DesktopProjectFileSidebarRow({ row, machineId }: { row: Row; machineId: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const workspace = useDesktopProjectFilesController()
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const target = { projectId: row.projectId, machineId }

  if (row.kind === 'toggle') {
    return (
      <View
        style={[
          styles.row,
          styles.toggleRow,
          {
            borderColor: focused ? colors.brand : 'transparent',
          },
        ]}
      >
        <Pressable
          testID={`project-files-toggle-${row.projectId}`}
          style={({ pressed }) => [
            styles.toggleMain,
            { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
          ]}
          hitSlop={2}
          onPress={() => workspace.toggleFiles(target)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityRole="button"
          accessibilityLabel={t('project_files')}
          accessibilityState={{ expanded: row.expanded }}
        >
          <Ionicons
            name={row.expanded ? 'chevron-down' : 'chevron-forward'}
            size={13}
            color={colors.textTertiary}
          />
          <Ionicons name="documents-outline" size={15} color={colors.textSecondary} />
          <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('project_files')}
          </Text>
        </Pressable>
        {row.expanded ? (
          <Pressable
            testID={`project-files-refresh-${row.projectId}`}
            style={({ pressed }) => [
              styles.refresh,
              { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
            ]}
            onPress={() => workspace.refresh(target)}
            accessibilityRole="button"
            accessibilityLabel={t('refresh')}
          >
            <Ionicons name="refresh" size={16} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
    )
  }

  if (row.kind === 'status') {
    const copy = statusCopy(row.status)
    return (
      <View
        style={[styles.statusRow, { paddingLeft: indent(row.depth) }]}
        accessibilityLiveRegion="polite"
      >
        {row.status === 'loading' ? <ActivityIndicator size="small" color={colors.brand} /> : null}
        <Text style={[styles.statusText, { color: colors.textTertiary }]}>{t(copy)}</Text>
        {row.retryable ? (
          <Pressable
            style={({ pressed }) => [
              styles.retry,
              { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
            ]}
            hitSlop={6}
            onPress={() => workspace.retry(target, row.target)}
            accessibilityRole="button"
            accessibilityLabel={`${t(copy)}，${t('retry')}`}
          >
            <Text style={[styles.retryText, { color: colors.brand }]}>{t('retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  if (row.kind === 'more') {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.row,
          {
            paddingLeft: indent(row.depth),
            backgroundColor: pressed ? colors.surfaceHover : 'transparent',
          },
        ]}
        hitSlop={2}
        disabled={row.loading}
        onPress={() => workspace.loadMore(target, row.directoryHandle)}
        accessibilityRole="button"
        accessibilityLabel={t('project_files_load_more')}
        accessibilityState={{ disabled: row.loading, busy: row.loading }}
      >
        {row.loading ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : (
          <Ionicons
            name="ellipsis-horizontal"
            size={desktopControlMetrics.compactIconGlyphSize}
            color={colors.textTertiary}
          />
        )}
        <Text style={[styles.label, { color: colors.brand }]}>{t('project_files_load_more')}</Text>
      </Pressable>
    )
  }

  const testID = `project-file-${row.projectId}-${row.entry.handle}`
  return (
    <Pressable
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        {
          paddingLeft: indent(row.depth),
          backgroundColor: row.selected
            ? colors.selectionBackground
            : pressed
              ? colors.surfaceHover
              : hovered
                ? colors.surfaceHover
                : 'transparent',
          borderColor: focused ? colors.brand : 'transparent',
        },
      ]}
      hitSlop={2}
      onPress={() => {
        if (row.entry.kind === 'directory') {
          workspace.toggleDirectory(target, row.entry.handle)
        } else {
          workspace.openFile(target, row.entry, testID)
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={row.entry.name}
      accessibilityState={
        row.entry.kind === 'directory' ? { expanded: row.expanded } : { selected: row.selected }
      }
    >
      {row.entry.kind === 'directory' ? (
        <Ionicons
          name={row.expanded ? 'chevron-down' : 'chevron-forward'}
          size={12}
          color={colors.textTertiary}
        />
      ) : (
        <View style={styles.chevronSpacer} />
      )}
      <Ionicons
        name={row.entry.kind === 'directory' ? 'folder-outline' : 'document-outline'}
        size={15}
        color={colors.textSecondary}
      />
      <Text style={[styles.label, { color: colors.text }]} numberOfLines={1} ellipsizeMode="middle">
        {row.entry.name}
      </Text>
    </Pressable>
  )
}

function statusCopy(status: Extract<Row, { kind: 'status' }>['status']) {
  switch (status) {
    case 'loading':
      return 'project_files_loading'
    case 'empty':
      return 'project_files_empty'
    case 'offline':
      return 'project_files_offline'
    case 'permission':
      return 'project_files_permission'
    case 'unavailable':
      return 'project_files_unavailable'
    case 'error':
      return 'project_files_error'
  }
}

function indent(depth: number): number {
  return 26 + Math.max(0, depth - 1) * 16
}

const styles = StyleSheet.create({
  row: {
    minHeight: desktopControlMetrics.compactControlHeight,
    marginRight: 8,
    paddingRight: 8,
    borderRadius: desktopControlMetrics.radiusSmall,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toggleRow: { paddingLeft: 0, paddingRight: 0 },
  toggleMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    paddingLeft: 25,
    paddingRight: 4,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refresh: {
    width: 42,
    height: 42,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, minWidth: 0, ...desktopTypography.sidebarItem },
  chevronSpacer: { width: 12 },
  statusRow: {
    minHeight: 44,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: { flexShrink: 1, fontSize: 12, lineHeight: 17 },
  retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 8 },
  retryText: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
})
