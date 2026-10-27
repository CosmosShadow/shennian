import { useOwnerDirectUnread } from '../../../src/features/published-agents/useOwnerDirectUnread'
import { useContextualSteward } from '../../../src/features/steward/ContextualStewardContext'
import { useMobileModuleBack } from '../../../src/components/useMobileModuleBack'
// @arch docs/features/agent-workspaces.md
// @test ../../../src/__tests__/agent-workspaces-navigation.test.ts
// @test ../../../src/__tests__/agent-list-account-state.test.ts

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Swipeable } from 'react-native-gesture-handler'
import { useRouter } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import Feather from '@expo/vector-icons/Feather'
import {
  hasSessionUnread,
  isAgentRuntimeOffline,
  useMachinesStore,
  useSessionsStore,
  useSheetsStore,
} from '@shennian/shared'
import type { AgentWorkspace, Machine, RelayConnectivityPhase } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useAgentListModel } from '../../../src/features/agents/useAgentListModel'
import { useTheme } from '../../../src/hooks/useTheme'
import { mobileTypography } from '../../../src/theme/mobileTypography'
import { RoomIdentityAvatar } from '../../../src/features/rooms/components/RoomIdentityAvatar'
import { useAuthStore } from '../../../src/config/auth'
import { AppPageHeader, HeaderIconButton } from '../../../src/components/ConnectedAppPageHeader'
import {
  getPinnedSurfaceColor,
  getPressedSurfaceColor,
} from '../../../src/features/session-list/pinnedPalette'
import {
  ListItemActionsModal,
  type ListItemActionsMode,
} from '../../../src/components/ListItemActionsModal'
import { useRelayConnectivitySnapshot } from '../../../src/hooks/useAppConnectivityStatus'
import { useMachinePresentationState } from '../../../src/hooks/useMachinePresentationState'
import { resolveAgentCreationAvailability } from '../../../src/features/agents/agentCreationAvailability'
import {
  formatAgentRoomParticipationCompact,
  getAgentRoomParticipationSummary,
} from '../../../src/features/agents/agentRoomParticipationSummary'

export default function AgentsRoute() {
  const ownerDirectUnread = useOwnerDirectUnread()
  const contextual = useContextualSteward()
  const moduleBack = useMobileModuleBack()
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const user = useAuthStore((state) => state.user)
  const sessions = useSessionsStore((state) => state.sessions)
  const machines = useMachinesStore((state) => state.machines)
  const openAddMachine = useSheetsStore((state) => state.openAddMachine)
  const relayConnectivity = useRelayConnectivitySnapshot()
  const unreadSessionIds = new Set(sessions.filter(hasSessionUnread).map((session) => session.id))
  const { agents, listUiState, load, togglePin, remove } = useAgentListModel()
  const creationAvailability = useMemo(
    () => resolveAgentCreationAvailability(machines),
    [machines],
  )
  const openCreationDestination = useCallback(() => {
    if (contextual) { contextual.draft(t('context_create_agent_request')); return }
    if (creationAvailability.state === 'no-machines') {
      openAddMachine()
      return
    }
    if (creationAvailability.state === 'unavailable') {
      if (creationAvailability.machineId) {
        router.navigate({
          pathname: '/(main)/machine/[machineId]',
          params: { machineId: creationAvailability.machineId },
        })
      } else {
        router.navigate('/(main)/machines')
      }
      return
    }
    router.navigate('/(main)/agents/new')
  }, [contextual, creationAvailability, openAddMachine, router, t])
  const emptyTitleKey = creationAvailability.state === 'no-machines'
    ? 'agents_empty_no_machine'
    : creationAvailability.state === 'unavailable'
      ? 'agents_empty_unavailable'
      : 'agents_empty'
  const emptyActionKey = creationAvailability.state === 'no-machines'
    ? 'add_machine'
    : creationAvailability.state === 'unavailable'
      ? 'agents_view_machine'
      : 'agents_create'
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader
        title={t('mobile_my_agents')}
        onBack={moduleBack}
        showsConnectivityStatus
        trailing={
          <HeaderIconButton
            icon="add"
            label={t(emptyActionKey)}
            onPress={openCreationDestination}
            testID="agent-create"
          />
        }
      />
      <ScrollView style={styles.body} contentContainerStyle={styles.content}>
        {listUiState === 'initial-loading' ? (
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('loading')}
            testID="agents-initial-loading"
            style={styles.center}
          >
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : listUiState === 'recoverable-error' && agents.length === 0 ? (
          <View accessibilityRole="alert" style={styles.center}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('spaces_agents_load_failed')}</Text>
            <Pressable accessibilityRole="button" testID="agents-retry" onPress={() => void load()}>
              <Text style={[styles.emptyAction, { color: colors.brand }]}>{t('retry')}</Text>
            </Pressable>
          </View>
        ) : listUiState === 'empty' ? (
          <View style={styles.center}>
            <Ionicons name="cube-outline" size={40} color={colors.textTertiary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t(emptyTitleKey)}</Text>
            <Pressable
              accessibilityRole="button"
              testID="agents-empty-action"
              onPress={openCreationDestination}
            >
              <Text style={[styles.emptyAction, { color: colors.brand }]}>{t(emptyActionKey)}</Text>
            </Pressable>
          </View>
        ) : (
          agents.map((agent) => (
            <AgentListRow
              key={agent.id}
              agent={agent}
              ownerName={user?.name}
              ownerAvatar={user?.avatar}
              onPress={() => router.navigate(`/(main)/agents/${agent.id}`)}
              onTogglePin={() => void togglePin(agent)}
              onDelete={() => void remove(agent)}
              hasUnread={(ownerDirectUnread[agent.id] ?? 0) > 0 || agent.sessions.some((session) => unreadSessionIds.has(session.id))}
              machine={machines.find((machine) => machine.id === agent.machineId)}
              relayPhase={relayConnectivity?.phase ?? null}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function AgentListRow({
  agent,
  ownerName,
  ownerAvatar,
  onPress,
  onTogglePin,
  onDelete,
  hasUnread,
  machine,
  relayPhase,
}: {
  agent: AgentWorkspace
  ownerName?: string | null
  ownerAvatar?: Parameters<typeof RoomIdentityAvatar>[0]['ownerAvatar']
  onPress: () => void
  onTogglePin: () => void
  onDelete: () => void
  hasUnread: boolean
  machine: Machine | undefined
  relayPhase: RelayConnectivityPhase | null
}) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const swipeRef = useRef<Swipeable>(null)
  const pinned = Boolean(agent.pinnedAt)
  const machineOnline = machine?.online ?? null
  const machineState = useMachinePresentationState(machineOnline, relayPhase)
  const runtimeUnavailable = isAgentRuntimeOffline(agent.availability)
  const unavailable =
    relayPhase === 'connected' &&
    (machineState === 'reconnecting' || machineState === 'offline' || runtimeUnavailable)
  const [actionsMode, setActionsMode] = useState<ListItemActionsMode | null>(null)
  const participation = getAgentRoomParticipationSummary(agent.sessions)
  const participationLabel = formatAgentRoomParticipationCompact(participation)
  const participationAccessibilityLabel = participation.active === participation.total
    ? t('agents_room_count', { count: participation.total })
    : t('agents_active_room_count_accessibility', participation)
  const [pressed, setPressed] = useState(false)
  const confirmDelete = useCallback(() => {
    swipeRef.current?.close()
    setActionsMode('delete')
  }, [])
  const renderRightActions = useCallback(
    (
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>,
    ) => {
      const scale = dragX.interpolate({
        inputRange: [-80, 0],
        outputRange: [1, 0.5],
        extrapolate: 'clamp',
      })
      return (
        <Pressable
          style={styles.deleteAction}
          onPress={confirmDelete}
          accessibilityLabel={t('agents_delete')}
        >
          <Animated.View style={{ transform: [{ scale }] }}>
            <Feather name="trash-2" size={18} color="#fff" />
          </Animated.View>
        </Pressable>
      )
    },
    [confirmDelete, t],
  )
  const content = (
    <View
      style={[
        styles.row,
        {
          borderBottomColor: colors.border,
          backgroundColor: pressed
            ? getPressedSurfaceColor(colors, isDark)
            : pinned
              ? getPinnedSurfaceColor(colors, isDark)
              : colors.bg,
        },
      ]}
    >
      <View style={styles.avatar}>
        <RoomIdentityAvatar
          name={agent.displayName}
          avatar={agent.avatar}
          agent
          ownerName={ownerName}
          ownerAvatar={ownerAvatar}
          size={44}
          offline={unavailable}
        />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.name, { color: unavailable ? colors.textSecondary : colors.text }]}
            numberOfLines={1}
          >
            {agent.displayName}
          </Text>
          <Text style={[styles.count, {
            color: participation.total > 0 && participation.active === 0
              ? colors.warningText
              : colors.textSecondary,
          }]}>
            {participationLabel}
          </Text>
          {hasUnread ? (
            <View
              testID={`agent-list-${agent.id}-unread`}
              style={[styles.unreadDot, { backgroundColor: colors.error }]}
            />
          ) : null}
        </View>
      </View>
      <Pressable
        testID={`agent-list-item-${agent.id}`}
        style={styles.rowPrimaryAction}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onLongPress={() => setActionsMode('actions')}
        accessibilityRole="button"
        accessibilityLabel={[
          unavailable
            ? t('spaces_agent_status_accessibility', {
                name: agent.displayName,
                status: t('spaces_agent_status_offline'),
              })
            : agent.displayName,
          participationAccessibilityLabel,
          hasUnread ? t('agents_unread') : null,
        ].filter(Boolean).join(', ')}
      />
    </View>
  )
  const item = (
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderRightActions}
        overshootRight={false}
        friction={2}
        rightThreshold={28}
      >
        {content}
      </Swipeable>
    )
  return (
    <>
      {item}
      <ListItemActionsModal
        visible={actionsMode !== null}
        mode={actionsMode ?? 'actions'}
        title={agent.displayName}
        pinLabel={pinned ? t('agents_unpin') : t('agents_pin')}
        deleteLabel={t('agents_delete')}
        deleteConfirmTitle={t('agents_delete')}
        deleteMessage={t('agents_delete_named_confirm', { name: agent.displayName })}
        cancelLabel={t('cancel')}
        onClose={() => setActionsMode(null)}
        onTogglePin={onTogglePin}
        onDelete={onDelete}
      />
    </>
  )
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  content: { paddingBottom: 24 },
  row: {
    minHeight: 68,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  rowPrimaryAction: { ...StyleSheet.absoluteFillObject },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 13,
  },
  copy: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1, minWidth: 0, ...mobileTypography.listTitle },
  count: { flexShrink: 0, textAlign: 'right', fontVariant: ['tabular-nums'], ...mobileTypography.secondary },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  emptyText: { ...mobileTypography.secondary, textAlign: 'center' },
  emptyAction: { ...mobileTypography.compactAction },
  center: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10 },
  deleteAction: {
    width: 76,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
