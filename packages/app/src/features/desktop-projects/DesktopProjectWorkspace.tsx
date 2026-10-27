// @arch docs/design/desktop/unified-desktop-control.md
// @test packages/app/src/__tests__/desktop-main-workspaces.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { ProjectSessionPageStateNotice } from '../projects/components/ProjectSessionPageStateNotice'
import type { ProjectSessionPageSurfaceState } from '../projects/services/projectSessionPageState'
import {
  resolveDesktopProjectDensity,
  resolveDesktopProjectStatePlacement,
} from './desktopProjectLayout'
import {
  DESKTOP_WORKSPACE_COMPACT_HEADER_HEIGHT,
  DESKTOP_WORKSPACE_HEADER_HEIGHT,
} from '../desktop-shell/desktopWorkspaceMetrics'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export type DesktopProjectSessionView = {
  id: string
  title: string
  agentLabel: string
  updatedLabel: string
  active: boolean
  unread: boolean
}

export function DesktopProjectWorkspace({
  title,
  machineName,
  workDir,
  machineState,
  state,
  sessions,
  preserveVisiblePosition,
  onOpenSession,
  onRetry,
  onRepairProject,
  onEndReached,
  onScrollBegin,
  onScroll,
}: {
  title: string
  machineName: string
  workDir: string
  machineState: 'online' | 'reconnecting' | 'offline' | 'unknown'
  state: ProjectSessionPageSurfaceState
  sessions: DesktopProjectSessionView[]
  preserveVisiblePosition: boolean
  canLaunch: boolean
  onStartSession: () => void
  onOpenSession: (sessionId: string) => void
  onRetry: () => void
  onRepairProject: () => void
  onEndReached: () => void
  onScrollBegin: () => void
  onScroll: (offsetY: number) => void
}) {
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  const density = resolveDesktopProjectDensity(workspaceWidth)
  const compact = density === 'compact'
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { fullNotice: showFullPageState, cachedNotice: showCachedNotice } =
    resolveDesktopProjectStatePlacement(state, sessions.length)

  return (
    <View
      style={[styles.root, { backgroundColor: colors.bg }]}
      testID="desktop-project-workspace"
      onLayout={(event) => setWorkspaceWidth(Math.round(event.nativeEvent.layout.width))}
    >
      <View
        {...{ dataSet: { desktopDrag: 'true' } }}
        style={[
          styles.header,
          compact && styles.headerCompact,
          { borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      {machineState === 'reconnecting' || machineState === 'offline' ? (
        <View
          style={[styles.machineNotice, { backgroundColor: colors.surface }]}
          accessibilityLiveRegion="polite"
          testID="desktop-project-machine-state"
        >
          <Ionicons name="desktop-outline" size={16} color={colors.textTertiary} />
          <Text style={[styles.machineNoticeText, { color: colors.textSecondary }]}>
            {machineState === 'reconnecting'
              ? t('machine_reconnecting')
              : t('machine_offline_project_notice', { machine: machineName })}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <DesktopProjectSessionRow session={item} onPress={() => onOpenSession(item.id)} />
        )}
        contentContainerStyle={styles.listContent}
        automaticallyAdjustsScrollIndicatorInsets={false}
        onScrollBeginDrag={onScrollBegin}
        onMomentumScrollBegin={onScrollBegin}
        onScroll={({ nativeEvent }) => onScroll(nativeEvent.contentOffset.y)}
        scrollEventThrottle={100}
        maintainVisibleContentPosition={
          preserveVisiblePosition ? { minIndexForVisible: 0 } : undefined
        }
        onEndReached={sessions.length > 0 ? onEndReached : undefined}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View style={[styles.projectSummary, { borderColor: colors.border }]}>
              <ProjectFact
                icon="desktop-outline"
                label={t('device_auth_machine')}
                value={machineName}
              />
              <View style={[styles.factDivider, { backgroundColor: colors.border }]} />
              <ProjectFact icon="folder-outline" label={t('project_files')} value={workDir} />
            </View>
            {showFullPageState ? (
              <ProjectSessionPageStateNotice
                state={state}
                compact={false}
                onRetry={onRetry}
                onRepair={state === 'forbidden' ? onRepairProject : undefined}
              />
            ) : null}
            {showCachedNotice ? (
              <ProjectSessionPageStateNotice state={state} compact onRetry={onRetry} />
            ) : null}
          </View>
        }
      />
    </View>
  )
}

function DesktopProjectSessionRow({
  session,
  onPress,
}: {
  session: DesktopProjectSessionView
  onPress: () => void
}) {
  const { colors } = useTheme()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={session.title}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.sessionRow,
        {
          backgroundColor: hovered || focused ? colors.surfaceHover : colors.bg,
          borderBottomColor: colors.border,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View style={[styles.sessionIcon, { backgroundColor: colors.brandLight }]}>
        <Ionicons name="chatbubble-outline" size={17} color={colors.brand} />
      </View>
      <View style={styles.sessionCopy}>
        <View style={styles.sessionTitleRow}>
          <Text
            style={[
              styles.sessionTitle,
              { color: colors.text, fontWeight: session.unread ? '700' : '500' },
            ]}
            numberOfLines={1}
          >
            {session.title}
          </Text>
          {session.active ? (
            <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
          ) : null}
        </View>
        <Text style={[styles.sessionMeta, { color: colors.textTertiary }]} numberOfLines={1}>
          {[session.agentLabel, session.updatedLabel].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  )
}

function ProjectFact({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  value: string
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={17} color={colors.textTertiary} />
      <View style={styles.factCopy}>
        <Text style={[styles.factLabel, { color: colors.textTertiary }]}>{label}</Text>
        <Text style={[styles.factValue, { color: colors.text }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  header: {
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCompact: { minHeight: DESKTOP_WORKSPACE_COMPACT_HEADER_HEIGHT, paddingHorizontal: 16 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: desktopTypography.windowTitle,
  startButton: {
    minHeight: desktopControlMetrics.standardControlHeight,
    paddingHorizontal: 12,
    borderRadius: desktopControlMetrics.radiusControl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  startButtonCompact: { width: 40, paddingHorizontal: 0 },
  startButtonText: { color: '#fff', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  machineNotice: {
    minHeight: 40,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  machineNoticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  listContent: { width: '100%', maxWidth: 920, alignSelf: 'center', padding: 20 },
  listHeader: { gap: 8 },
  projectSummary: {
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 12,
  },
  fact: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  factCopy: { flex: 1, minWidth: 0, gap: 2 },
  factLabel: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  factValue: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  factDivider: { width: StyleSheet.hairlineWidth },
  sessionRow: {
    minHeight: 58,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sessionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionCopy: { flex: 1, minWidth: 0, gap: 4 },
  sessionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sessionTitle: { flexShrink: 1, fontSize: 14, lineHeight: 19 },
  sessionMeta: { fontSize: 11, lineHeight: 15 },
  activeDot: { width: 7, height: 7, borderRadius: 4 },
})
