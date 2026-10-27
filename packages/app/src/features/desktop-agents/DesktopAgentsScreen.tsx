// @arch docs/features/agent-workspaces.md
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-agents-screen.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import Ionicons from '@expo/vector-icons/Ionicons'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import {
  hasSessionUnread,
  isAgentRuntimeOffline,
  useMachinesStore,
  useSessionsStore,
} from '@shennian/shared'
import type { AgentWorkspace } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import { useMachinePresentationState } from '../../hooks/useMachinePresentationState'
import {
  ListItemActionsModal,
  type ListItemActionsMode,
} from '../../components/ListItemActionsModal'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { useDesktopAgentSidebarModel } from '../desktop-control/useDesktopAgentSidebarModel'
import { createDesktopAgentListActions } from '../agents/desktopAgentListActions'
import {
  formatAgentRoomParticipationCompact,
  getAgentRoomParticipationSummary,
} from '../agents/agentRoomParticipationSummary'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { DESKTOP_WORKSPACE_HEADER_HEIGHT } from '../desktop-shell/desktopWorkspaceMetrics'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { desktopAgentPort } from './desktopAgentPort'

export default function DesktopAgentsScreen() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return accountId ? <DesktopAccountAgents key={accountId} accountId={accountId} /> : null
}

function DesktopAccountAgents({ accountId }: { accountId: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const model = useDesktopAgentSidebarModel()
  const [error, setError] = useState<string | null>(null)
  const actions = useMemo(
    () =>
      createDesktopAgentListActions({
        isCurrent: () => useAuthStore.getState().user?.id === accountId,
        client: desktopAgentPort,
        onError: (action) =>
          setError(t(action === 'pin' ? 'agents_pin_failed' : 'agents_delete_failed')),
      }),
    [accountId, t],
  )
  useEffect(() => {
    actions.start()
    let previousAccountId: string | null = accountId
    const unsubscribe = useAuthStore.subscribe((state) => {
      const nextAccountId = state.user?.id ?? null
      if (nextAccountId === previousAccountId) return
      previousAccountId = nextAccountId
      if (nextAccountId === accountId) actions.start()
      else actions.stop()
    })
    return () => {
      actions.stop()
      unsubscribe()
    }
  }, [actions, accountId])
  return (
    <View testID="desktop-agents-screen" style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {t('agents_title')}
        </Text>
        <DesktopMachineAction
          compact
          primary
          label={t('agents_create')}
          onPress={() => router.navigate('/(main)/agents/new')}
        />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <View
            accessibilityRole="alert"
            style={[
              styles.inlineError,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
            <Text style={[styles.inlineErrorText, { color: colors.error }]}>{error}</Text>
          </View>
        ) : null}
        {model.state === 'initial-loading' ? (
          <AgentListState loading icon="sparkles-outline" title={t('loading')} />
        ) : null}
        {model.state === 'offline' ? (
          <AgentListState
            alert
            icon="cloud-offline-outline"
            title={t('machines_offline_title')}
            onRetry={() => void model.retry()}
          />
        ) : null}
        {model.state === 'recoverable-error' ? (
          <AgentListState
            alert
            icon="alert-circle-outline"
            title={t('spaces_agents_load_failed')}
            onRetry={() => void model.retry()}
          />
        ) : null}
        {model.state === 'empty' ? (
          <AgentListState icon="sparkles-outline" title={t('agents_empty')} />
        ) : null}
        {model.agents.length ? (
          <View style={[styles.list, { borderColor: colors.border }]}>
            {model.agents.map((agent, index) => (
              <DesktopAgentRow
                key={agent.id}
                agent={agent}
                last={index === model.agents.length - 1}
                onOpen={() => router.navigate(`/(main)/agents/${agent.id}`)}
                onPin={() => {
                  setError(null)
                  void actions.togglePin(agent)
                }}
                onDelete={() => {
                  setError(null)
                  void actions.remove(agent)
                }}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

function AgentListState({
  title,
  icon,
  loading = false,
  alert = false,
  onRetry,
}: {
  title: string
  icon: keyof typeof Ionicons.glyphMap
  loading?: boolean
  alert?: boolean
  onRetry?: () => void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  return (
    <View
      accessibilityRole={alert ? 'alert' : loading ? 'progressbar' : undefined}
      style={[styles.stateCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel={title} color={colors.brand} />
      ) : (
        <Ionicons name={icon} size={30} color={colors.textTertiary} />
      )}
      <Text style={[styles.stateTitle, { color: colors.textSecondary }]}>{title}</Text>
      {onRetry ? <DesktopMachineAction compact label={t('retry')} onPress={onRetry} /> : null}
    </View>
  )
}

function DesktopAgentRow({
  agent,
  last,
  onOpen,
  onPin,
  onDelete,
}: {
  agent: AgentWorkspace
  last: boolean
  onOpen(): void
  onPin(): void
  onDelete(): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const owner = useAuthStore((state) => state.user)
  const boundMachine = useMachinesStore(
    (state) => state.machines.find((machine) => machine.id === agent.machineId),
  )
  const machineOnline = boundMachine?.online ?? null
  const unread = useSessionsStore((state) =>
    agent.sessions.some((link) =>
      state.sessions.some((session) => session.id === link.id && hasSessionUnread(session)),
    ),
  )
  const connectivity = useRelayConnectivitySnapshot()
  const machine = useMachinePresentationState(machineOnline, connectivity?.phase ?? null)
  const unavailable =
    connectivity?.phase === 'connected' &&
    (machine === 'reconnecting' ||
      machine === 'offline' ||
      isAgentRuntimeOffline(agent.availability))
  const participation = getAgentRoomParticipationSummary(agent.sessions)
  const participationAccessibilityLabel = participation.active === participation.total
    ? t('agents_room_count', { count: participation.total })
    : t('agents_active_room_count_accessibility', participation)
  const [mode, setMode] = useState<ListItemActionsMode | null>(null)
  const actionRef = useRef<View>(null)
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [moreFocused, setMoreFocused] = useState(false)
  const [moreHovered, setMoreHovered] = useState(false)
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.rowInner}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[
            unavailable
              ? t('spaces_agent_status_accessibility', {
                  name: agent.displayName,
                  status: t('spaces_agent_status_offline'),
                })
              : agent.displayName,
            participationAccessibilityLabel,
            unread ? t('agents_unread') : null,
          ].filter(Boolean).join(', ')}
          onPress={onOpen}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          style={({ pressed }) => [
            styles.rowPrimary,
            {
              borderColor: focused ? colors.brand : 'transparent',
              backgroundColor:
                pressed || hovered || agent.pinnedAt ? colors.surfaceHover : 'transparent',
            },
          ]}
        >
          <RoomIdentityAvatar
            name={agent.displayName}
            avatar={agent.avatar}
            agent
            ownerName={owner?.name}
            ownerAvatar={owner?.avatar}
            size={40}
            offline={unavailable}
          />
          <View style={styles.rowHeading}>
            <Text
              numberOfLines={1}
              style={[
                styles.rowTitle,
                { color: unavailable ? colors.textSecondary : colors.text },
              ]}
            >
              {agent.displayName}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.rowCount,
                {
                  color: participation.total > 0 && participation.active === 0
                    ? colors.warningText
                    : colors.textSecondary,
                },
              ]}
            >
              {formatAgentRoomParticipationCompact(participation)}
            </Text>
            {unread ? <View style={[styles.unreadDot, { backgroundColor: colors.error }]} /> : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('more')} · ${agent.displayName}`}
          ref={actionRef}
          onPress={() => setMode('actions')}
          onFocus={() => setMoreFocused(true)}
          onBlur={() => setMoreFocused(false)}
          onHoverIn={() => setMoreHovered(true)}
          onHoverOut={() => setMoreHovered(false)}
          style={({ pressed }) => [
            styles.moreButton,
            {
              borderColor: moreFocused ? colors.brand : 'transparent',
              backgroundColor: pressed || moreHovered ? colors.surfaceHover : 'transparent',
              opacity: pressed ? 0.68 : 1,
            },
          ]}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={desktopControlMetrics.iconGlyphSize}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
      <ListItemActionsModal
        anchorRef={actionRef}
        visible={mode !== null}
        mode={mode ?? 'actions'}
        title={agent.displayName}
        pinLabel={agent.pinnedAt ? t('agents_unpin') : t('agents_pin')}
        deleteLabel={t('agents_delete')}
        deleteConfirmTitle={t('agents_delete_title', { name: agent.displayName })}
        deleteMessage={t('agents_delete_confirm')}
        cancelLabel={t('cancel')}
        onClose={() => setMode(null)}
        onTogglePin={onPin}
        onDelete={onDelete}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  header: {
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: { flex: 1, minWidth: 0, ...desktopTypography.windowTitle },
  content: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    paddingBottom: 48,
    gap: 12,
  },
  inlineError: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  inlineErrorText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  stateCard: {
    minHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stateTitle: { maxWidth: 520, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  list: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  row: { minHeight: 60 },
  rowInner: { minHeight: 60, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowPrimary: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    margin: 4,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowHeading: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  rowCount: {
    flexShrink: 0,
    maxWidth: '45%',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    ...desktopTypography.metadata,
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  moreButton: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
