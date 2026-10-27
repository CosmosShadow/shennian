// @arch docs/features/agent-workspaces.md
// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-agent-detail-screen.test.ts
// @test ../../__tests__/agent-workspaces-navigation.test.ts
// @test ../../__tests__/agent-detail-account-state.test.ts

import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { isAgentRuntimeOffline, useMachinesStore } from '@shennian/shared'
import { useTranslation } from 'react-i18next'
import { DesktopRoomWorkspaceScreen } from '../desktop-rooms/DesktopRoomWorkspaceScreen'
import { useDesktopAgentDetailModel } from './useDesktopAgentDetailModel'
import { DesktopSplitResizeHandle, useDesktopSplitWidth, useDesktopAvailableWidth } from '../desktop-shell/DesktopSplitResizeHandle'
import { desktopAgentConversations, resolveDesktopAgentRoom } from './desktopAgentDetailNavigation'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import { useMachinePresentationState } from '../../hooks/useMachinePresentationState'
import { AgentParticipationMutationBoundary, useParticipationActionGuard } from '../../features/rooms/AgentParticipationMutationBoundary'
import { useDesktopRoomListModel } from '../desktop-control/useDesktopRoomListModel'
import { DesktopRoomAgentParticipation } from './DesktopRoomAgentParticipation'
import { DesktopAgentOverview } from './DesktopAgentOverview'
import { DesktopAgentRoomRow } from './DesktopAgentRoomRow'
import {
  DesktopAgentDetailHeader,
  desktopAgentDetailStyles,
} from '../../features/desktop-agents/DesktopAgentDetailLayout'

export default function DesktopAgentDetailRoute() {
  const { agentId = '', contextRoomId = '' } = useLocalSearchParams<{ agentId: string; contextRoomId?: string }>()
  return <DesktopAgentDetailPage agentId={agentId} contextRoomId={contextRoomId} />
}

export function DesktopAgentDetailPage({ agentId, contextRoomId }: {
  agentId: string; contextRoomId: string
}) {
  const accountId = useAuthStore((state) => state.user?.id)
  return <AgentParticipationMutationBoundary key={`${accountId}:${agentId}:${contextRoomId}`}>
    <DesktopAgentDetailContent agentId={agentId} contextRoomId={contextRoomId} />
  </AgentParticipationMutationBoundary>
}
const ignoreRoomOpen = () => {}
function DesktopAgentDetailContent({ agentId, contextRoomId }: { agentId: string; contextRoomId: string }) {
  const { request } = useParticipationActionGuard()
  const { availableWidth, measureRef } = useDesktopAvailableWidth()
  const [roomChoice, setSelectedRoom] = useState<string | undefined>(undefined)
  const { rooms } = useDesktopRoomListModel({ onOpenRoom: ignoreRoomOpen })
  const router = useRouter()
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const user = useAuthStore((state) => state.user)
  const accountId = user?.id ?? null
  const onUnavailable = useCallback(() => router.back(), [router])
  const model = useDesktopAgentDetailModel({ accountId, agentId, onUnavailable })
  const { agent, repairing, refresh } = model
  const machineOnline = useMachinesStore(state => state.machines.find(machine => machine.id === agent?.machineId)?.online ?? null)
  const connectivity = useRelayConnectivitySnapshot()
  const machine = useMachinePresentationState(machineOnline, connectivity?.phase ?? null)

  const visibleConversations = desktopAgentConversations(agent?.sessions ?? [], contextRoomId)
  const selectedRoom = contextRoomId ? null : resolveDesktopAgentRoom(visibleConversations.map(session => session.room!.roomId), roomChoice)
  const splitWidth = useDesktopSplitWidth(accountId ?? '', 'agentNavigationWidth', availableWidth)
  const edit = () => request(() => router.navigate({ pathname: '/(main)/agents/[agentId]/settings', params: { agentId, returnAfterSave: '1' } }))
  const showAgentOverview = () => request(() => router.replace({ pathname: '/(main)/agents/[agentId]', params: { agentId } }))
  const publicationLabel = i18n.language.startsWith('zh')
    ? '发布本机智能体与管理对外对话' : 'Publish local agent and manage external chats'

  if (!agent) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <DesktopAgentDetailHeader title={t('agents_detail_title')}
          backLabel={t('back')} onBack={contextRoomId ? () => request(() => router.back()) : undefined} />
        {model.failed ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Text style={{ color: colors.textSecondary }}>{t('spaces_load_failed')}</Text>
            <Pressable accessibilityRole="button" style={styles.repair} onPress={() => void refresh()}>
              <Text style={{ color: colors.brand }}>{t('retry')}</Text>
            </Pressable>
          </View>
        ) : <ActivityIndicator style={{ flex: 1 }} color={colors.brand} />}
      </View>
    )
  }
  const offline = isAgentRuntimeOffline(agent.availability)
  const runtimeStatus = connectivity?.phase !== 'connected' ? null
    : machine === 'reconnecting' ? t('machine_reconnecting')
      : machine === 'offline' ? t('machine_not_online_named', { machine: agent.machineName || t('agents_machine') })
        : agent.availability === 'recovering' ? t('agents_runtime_recovering')
          : offline ? t(agent.machineId ? 'agents_runtime_needs_attention' : 'agents_runtime_machine_unselected') : null
  const repair = async () => {
    try { await model.repair() }
    catch { if (model.isCurrent()) Alert.alert(t('error'), t('spaces_manage_action_failed')) }
  }

  return (
    <View ref={measureRef} style={{flex: 1, flexDirection: 'row', minWidth: 0}}>
    <View style={[styles.root, { minWidth: 0, backgroundColor: colors.bg }, selectedRoom ? {flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: splitWidth.width} : null]}>
      <DesktopAgentDetailHeader
          title={agent.displayName}
          backLabel={t('back')}
          onBack={contextRoomId ? () => request(() => router.back()) : undefined}
        />
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.content, desktopAgentDetailStyles.content, {paddingHorizontal: 16}]}
        centerContent={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
      >
        <DesktopAgentOverview agent={agent} onEdit={edit} />
        {!contextRoomId ? <Pressable accessibilityRole="button" accessibilityLabel={publicationLabel}
          onPress={() => request(() => router.navigate({
            pathname: '/(main)/agents/[agentId]/publication', params: { agentId },
          }))} style={styles.repair}>
          <Text style={{ color: colors.brand }}>{publicationLabel}</Text>
        </Pressable> : null}
        {runtimeStatus ? <View accessibilityRole={offline ? 'alert' : undefined}
          style={[styles.runtimeStatus, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.runtimeStatusText, { color: colors.textSecondary }]}>{runtimeStatus}</Text>
          {offline && agent.repairAction === 'configure' ? <Pressable accessibilityRole="button"
            accessibilityLabel={t('agents_edit')} onPress={edit} style={styles.runtimeAction}>
            <Text style={{ color: colors.brand }}>{t('agents_edit')}</Text>
          </Pressable> : null}
        </View> : null}
        {model.failed ? <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.repair}>
          <Text accessibilityRole="alert" style={{ color: colors.textSecondary }}>{t('spaces_load_failed')} · {t('retry')}</Text>
        </Pressable> : null}
        {offline && agent.repairAction === 'retry' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('spaces_agent_retry_recovery')}
            accessibilityState={{ busy: repairing, disabled: repairing }} disabled={repairing}
            onPress={() => void repair()} style={styles.repair}>
            <Text style={{ color: colors.brand }}>{t('spaces_agent_retry_recovery')}</Text>
          </Pressable>
        ) : null}
        {!contextRoomId ? <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {t('agents_participating_rooms')}
            <Text testID="agent-participation-count">{'（'}{visibleConversations.length}{'）'}</Text>
          </Text>
        </View> : null}
        {contextRoomId && !visibleConversations.length ? (
          <View accessibilityRole="alert" style={[styles.empty, desktopAgentDetailStyles.empty]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('desktop_agent_relationship_unavailable')}</Text>
            <Pressable accessibilityRole="button" onPress={showAgentOverview} style={styles.repair}>
              <Text style={{ color: colors.brand }}>{t('desktop_agent_return_to_overview')}</Text>
            </Pressable>
          </View>
        ) : contextRoomId ? (
          <View style={styles.relationshipSettings}>
            {/* Main owns the relationship transaction; the Desktop view preserves this Room context. */}
            <DesktopRoomAgentParticipation roomId={contextRoomId} agentIdentityId={agent.id} showOverview={false}
              onUpdated={() => void refresh()} onRemoved={() => router.back()} />
          </View>
        ) : visibleConversations.length ? (
          <View style={styles.roomList}>
            {visibleConversations.map((session, index) => {
              if (!session.room) return null
              const roomId = session.room.roomId
              const roomKey = `${accountId}:${agentId}:${roomId}`
              return (
                <DesktopAgentRoomRow key={roomKey} session={session} room={rooms.find((room) => room.id === roomId)}
                  showSeparator={index < visibleConversations.length - 1 && selectedRoom !== visibleConversations[index + 1]?.room?.roomId}
                  selected={selectedRoom === roomId} onPress={() => request(() => setSelectedRoom(roomId))} />
              )
            })}
          </View>
        ) : (
          <View style={[styles.empty, desktopAgentDetailStyles.empty]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('agents_no_conversations')}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
              {t('agents_no_conversations_hint')}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
    {selectedRoom ? <DesktopSplitResizeHandle key={accountId} {...splitWidth} /> : null}
    {selectedRoom ? <View style={{flex: 1, minWidth: 0, borderLeftWidth: 1, borderLeftColor: colors.border}}>
      <DesktopRoomWorkspaceScreen key={selectedRoom} roomId={selectedRoom} embedded />
    </View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 }, body: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'flex-start', paddingBottom: 32 },
  sectionHeader: { paddingLeft: 0, paddingRight: 0, paddingTop: 24, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  // Selection bleeds 8pt past the 16pt text column (as in the sidebar); row content lines up with that column.
  roomList: { marginHorizontal: -8 },
  relationshipSettings: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 24 },
  repair: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  runtimeStatus: { minHeight: 52, marginTop: 16, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  runtimeStatusText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  runtimeAction: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 160, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  emptyHint: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
})
