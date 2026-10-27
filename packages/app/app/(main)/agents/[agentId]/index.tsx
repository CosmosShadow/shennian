import { useOwnerDirectUnread } from '../../../../src/features/published-agents/useOwnerDirectUnread'
import { UnreadCountBadge } from '../../../../src/features/unread/UnreadCountBadge'
import { routeString } from '../../../../src/utils/runtimeValues'
// @arch docs/features/agent-workspaces.md
// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test ../../../../src/__tests__/agent-workspaces-navigation.test.ts
// @test ../../../../src/__tests__/agent-detail-account-state.test.ts

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { getAgentDisplayName, getProjectDirName, isAgentRuntimeOffline, useMachinesStore, useSessionsStore } from '@shennian/shared'
import * as Crypto from 'expo-crypto'
import { agentAccountClient } from '../../../../src/features/agents/agentAccountClient.native'
import { accountRuntime } from '../../../../src/features/account-runtime/accountRuntime'
import { createAgentConversationStarter } from '../../../../src/features/agents/startAgentConversation'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../../../src/components/AppPageHeader'
import { useAgentDetailModel } from '../../../../src/features/agents/useAgentDetailModel'
import { useAuthStore } from '../../../../src/config/auth'
import { useTheme } from '../../../../src/hooks/useTheme'
import { authApi } from '../../../../src/config/api'
import { AgentParticipationMutationBoundary, useParticipationActionGuard } from '../../../../src/features/rooms/AgentParticipationMutationBoundary'
import { useRoomListModel } from '../../../../src/features/rooms/components/RoomListPanel'
import { AgentOverview } from '../../../../src/features/agents/AgentOverview'
import { RoomAgentParticipation } from '../../../../src/features/rooms/components/RoomAgentParticipation'
import { RoomIdentityAvatar } from '../../../../src/features/rooms/components/RoomIdentityAvatar'
import { mobileTypography } from '../../../../src/theme/mobileTypography'
import { getMachineAgentModels, getModelDisplayName } from '../../../../src/utils/models'
import { roomActivationModeToParticipation } from '../../../../src/features/rooms/components/roomAgentStatusPresentation'
import { RoomGroupAvatar } from '../../../../src/features/rooms/components/RoomGroupAvatar'
import { formatSessionClockTime } from '../../../../src/features/session-list/display'
import { getRoomBodyPreview } from '../../../../src/features/rooms/roomListCache'
import { readAgentPlazaListedCache, writeAgentPlazaListedCache } from '../../../../src/features/agents/agentPublicationStatusCache'

export default function AgentDetailRoute() {
  const { agentId = '', contextRoomId = '' } = useLocalSearchParams<{ agentId: string; contextRoomId?: string }>()
  return <AgentDetailPage agentId={routeString(agentId)} contextRoomId={routeString(contextRoomId)} />
}

export function AgentDetailPage({ agentId, contextRoomId }: {
  agentId: string; contextRoomId: string
}) {
  const accountId = useAuthStore((state) => state.user?.id)
  return <AgentParticipationMutationBoundary key={`${accountId}:${agentId}:${contextRoomId}`}>
    <AgentDetailContent agentId={agentId} contextRoomId={contextRoomId} />
  </AgentParticipationMutationBoundary>
}
const ignoreRoomOpen = () => {}
function AgentDetailContent({ agentId, contextRoomId }: { agentId: string; contextRoomId: string }) {
  const { request } = useParticipationActionGuard()
  const { rooms } = useRoomListModel({ onOpenRoom: ignoreRoomOpen })
  const router = useRouter()
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const machines = useMachinesStore((state) => state.machines)
  const user = useAuthStore((state) => state.user)
  const accountId = user?.id ?? null
  const onUnavailable = useCallback(() => router.back(), [router])
  const model = useAgentDetailModel({ accountId, agentId, onUnavailable })
  const { agent, repairing, refresh } = model
  const zh = i18n.language.startsWith('zh')
  const cardLabel = zh ? 'AI 名片' : 'AI card'
  const [plazaListed, setPlazaListed] = useState<boolean | null>(null)
  const [visitorConversations, setVisitorConversations] = useState<Array<{
    id: string; visitorName?: string; unreadCount?: number; lastActivityAt: string
  }>>([])
  const [visitorCount, setVisitorCount] = useState(0)
  const ownerDirectUnread = useOwnerDirectUnread()
  const plazaListedFor = useRef<string | null>(null)
  useFocusEffect(useCallback(() => {
    let current = true
    if (plazaListedFor.current !== `${accountId ?? ''}:${agentId}`) {
      plazaListedFor.current = `${accountId ?? ''}:${agentId}`
      setPlazaListed(null)
      setVisitorConversations([])
      setVisitorCount(0)
      if (accountId && agentId) void readAgentPlazaListedCache(accountId, agentId).then((cached) => {
        if (current && plazaListedFor.current === `${accountId}:${agentId}`) setPlazaListed(cached)
      })
    }
    if (accountId && agentId) void authApi<{ publication: { plazaListed: boolean; status: string; publicId?: string } | null }>(
      `/agents/${encodeURIComponent(agentId)}/publication`,
    ).then((result) => {
      const listed = result.publication?.status !== 'revoked' && result.publication?.plazaListed === true
      if (current) {
        setPlazaListed(listed)
      }
      void writeAgentPlazaListedCache(accountId, agentId, listed)
    }).catch(() => {})
    const loadVisitors = () => { if (accountId && agentId) void authApi<{ conversations: Array<{
      id: string; visitorName?: string; unreadCount?: number; lastActivityAt: string
    }>; summary?: { conversationCount: number } }>(`/agents/${encodeURIComponent(agentId)}/publication/conversations`).then((result) => {
      if (current) {
        setVisitorConversations(result.conversations)
        setVisitorCount(result.summary?.conversationCount ?? result.conversations.length)
      }
    }).catch(() => {}) }
    loadVisitors()
    const timer = setInterval(loadVisitors, 10_000)
    return () => { current = false; clearInterval(timer) }
  }, [accountId, agentId]))
  const [creatingConversation, setCreatingConversation] = useState(false)
  const startConversation = useMemo(() => createAgentConversationStarter({
    newIntent: () => `conversation:${Crypto.randomUUID()}`,
    create: (intentId) => agentAccountClient.createConversationSession(agentId, intentId),
    persist: async (session) => {
      await accountRuntime.persistSession(session)
      if (model.isCurrent()) useSessionsStore.getState().upsertSession(session)
    },
    open: (sessionId) => router.navigate({ pathname: '/(main)/chat/[sessionId]', params: { sessionId } }),
    isCurrent: model.isCurrent,
    setBusy: setCreatingConversation,
  }), [agentId, model.isCurrent, router])
  const sendMessage = () => request(() => {
    void startConversation().catch(() => {
      if (model.isCurrent()) Alert.alert(t('error'), t('spaces_manage_action_failed'))
    })
  })
  const detailTitle = i18n.language.startsWith('zh') ? 'AI 详情' : 'AI details'

  const conversations = agent?.sessions ?? []
  const visibleConversations = conversations.filter((session) => session.room && (!contextRoomId || session.room.roomId === contextRoomId))
  const personalConversations = conversations.filter((session) => !session.room)
  const machine = machines.find((item) => item.id === agent?.machineId)
  const runtimeLabel = agent?.runtimeAdapter ? getAgentDisplayName(agent.runtimeAdapter) : t('agents_unconfigured')
  const modelLabel = agent?.runtimeAdapter
    ? getModelDisplayName(getMachineAgentModels(machine, agent.runtimeAdapter), agent.modelId) ?? agent.modelId ?? t('agents_default_model')
    : t('agents_default_model')
  const runtimeSummary = [runtimeLabel, modelLabel, agent?.machineName || machine?.name, agent?.workDir && getProjectDirName(agent.workDir)].filter(Boolean).join(' · ')
  const edit = () => request(() => router.navigate({ pathname: '/(main)/agents/[agentId]/settings', params: { agentId, returnAfterSave: '1' } }))

  if (!agent) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
        {model.failed ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Text style={{ color: colors.textSecondary }}>{t('spaces_load_failed')}</Text>
            <Pressable accessibilityRole="button" style={styles.repair} onPress={() => void refresh()}>
              <Text style={{ color: colors.brand }}>{t('retry')}</Text>
            </Pressable>
          </View>
        ) : <ActivityIndicator style={{ flex: 1 }} color={colors.brand} />}
      </SafeAreaView>
    )
  }
  const offline = isAgentRuntimeOffline(agent.availability)
  const repair = async () => {
    try { await model.repair() }
    catch { if (model.isCurrent()) Alert.alert(t('error'), t('spaces_manage_action_failed')) }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader title={contextRoomId ? agent.displayName : detailTitle} onBack={() => router.back()} />
      <ScrollView
        style={[styles.body, { backgroundColor: colors.groupedBackground }]}
        contentContainerStyle={[styles.content, !contextRoomId && styles.globalContent]}
        centerContent={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
      >
        {contextRoomId ? <AgentOverview agent={agent} onEdit={edit} /> : <>
          <Pressable testID="agent-detail-summary" accessibilityRole="button" accessibilityLabel={zh ? '编辑 AI 身份' : 'Edit AI identity'}
            onPress={edit} style={[styles.globalCard, { backgroundColor: colors.groupedSurface }]}>
            <View style={styles.globalIdentity}>
              <RoomIdentityAvatar name={agent.displayName} avatar={agent.avatar} agent size={48} />
              <View style={styles.globalIdentityCopy}>
                <Text style={[styles.globalName, { color: colors.text }]} numberOfLines={1}>{agent.displayName}</Text>
                <Text style={[styles.globalDescription, { color: colors.textSecondary }]} numberOfLines={1}>{agent.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </View>
            <View style={[styles.globalDivider, { backgroundColor: colors.border }]} />
            <Text testID="agent-detail-runtime-summary" style={[styles.globalRuntime, { color: colors.textSecondary }]} numberOfLines={1}>{runtimeSummary}</Text>
          </Pressable>
          <Pressable testID="agent-detail-chat" accessibilityRole="button"
            onPress={sendMessage} disabled={creatingConversation}
            accessibilityState={{ busy: creatingConversation, disabled: creatingConversation }}
            style={[styles.globalCard, { backgroundColor: colors.groupedSurface,
              padding: 16, alignItems: 'center', marginTop: 12 }]}>
            {creatingConversation ? <ActivityIndicator color={colors.brand} /> :
              <Text style={{ color: colors.brand, fontSize: 16, fontWeight: '600' }}>
                {zh ? '发消息' : 'Message'}
              </Text>}
          </Pressable>
          <Text style={[styles.globalSectionTitle, { color: colors.textSecondary }]}>{zh ? '管理' : 'Manage'}</Text>
          <View style={[styles.globalCard, styles.globalManageCard, { backgroundColor: colors.groupedSurface }]}>
            <Pressable testID="agent-card-entry" accessibilityRole="button" accessibilityLabel={cardLabel}
              onPress={() => router.navigate({ pathname: '/(main)/agents/[agentId]/publication', params: { agentId } })}
              style={styles.globalCardRow}>
              <View style={styles.globalCardCopy}>
                <Text style={[styles.globalManageTitle, { color: colors.text }]}>{cardLabel}</Text>
                <Text style={[styles.globalConversationHint, { color: colors.textSecondary }]}>
                  {zh ? '二维码、邀请链接与对外展示' : 'QR code, invite link, and visibility'}
                </Text>
              </View>
              {plazaListed !== null ? <Text testID="agent-card-plaza-status"
                style={[styles.globalCardStatus, { color: plazaListed ? colors.brand : colors.textTertiary }]}>
                {plazaListed ? (zh ? '已公开到广场' : 'Public in Discover')
                  : (zh ? '未展示' : 'Not listed')}
              </Text> : null}
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        </>}
        {offline && agent.repairAction === 'retry' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('spaces_agent_retry_recovery')}
            accessibilityState={{ busy: repairing, disabled: repairing }} disabled={repairing}
            onPress={() => void repair()} style={styles.repair}>
            <Text style={{ color: colors.brand }}>{t('spaces_agent_retry_recovery')}</Text>
          </Pressable>
        ) : null}
        {!contextRoomId && visitorConversations.length ? <>
          <Text style={[styles.globalSectionTitle, { color: colors.textSecondary }]}>
            {zh ? '访客对话' : 'Visitor chats'}（{visitorCount}）
          </Text>
          <View style={[styles.globalCard, { backgroundColor: colors.groupedSurface }]}>
            {visitorConversations.slice(0, 5).map((conversation, index) => <View key={conversation.id}>
              {index ? <View style={[styles.globalDivider, { backgroundColor: colors.border }]} /> : null}
              <Pressable accessibilityRole="button" style={styles.globalConversationRow}
                onPress={() => router.navigate({ pathname: '/(main)/published-conversations/[conversationId]',
                  params: { conversationId: conversation.id, perspective: 'owner' } })}>
                <RoomIdentityAvatar name={conversation.visitorName || (zh ? '访客' : 'Visitor')} size={44} />
                <View style={styles.globalConversationCopy}>
                  <Text style={[styles.globalRowTitle, { color: colors.text }]} numberOfLines={1}>
                    {conversation.visitorName || (zh ? '访客' : 'Visitor')}
                  </Text>
                  <Text style={[styles.globalConversationTime, { color: colors.textSecondary }]}>
                    {formatSessionClockTime(conversation.lastActivityAt)}
                  </Text>
                </View>
                <UnreadCountBadge count={conversation.unreadCount ?? 0} />
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Pressable>
            </View>)}
            {visitorCount > 5 ? <Pressable accessibilityRole="button"
              style={styles.globalConversationRow}
              onPress={() => router.navigate({ pathname: '/(main)/agents/[agentId]/publication', params: { agentId } })}>
              <Text style={{ color: colors.brand }}>{zh ? '查看全部' : 'See all'}</Text>
              <UnreadCountBadge count={Math.max(0, (ownerDirectUnread[agentId] ?? 0) - visitorConversations.slice(0, 5).filter((row) => (row.unreadCount ?? 0) > 0).length)} />
            </Pressable> : null}
          </View>
        </> : null}
        {!contextRoomId && personalConversations.length ? <>
          <Text style={[styles.globalSectionTitle, { color: colors.textSecondary }]}>
            {t('agents_conversations_title', { count: personalConversations.length })}
          </Text>
          <View style={[styles.globalCard, { backgroundColor: colors.groupedSurface }]}>
            {personalConversations.map((session, index) => <View key={session.id}>
              {index ? <View style={[styles.globalDivider, { backgroundColor: colors.border }]} /> : null}
              <Pressable testID={`agent-conversation-${session.id}`} accessibilityRole="button"
                style={styles.globalConversationRow}
                onPress={() => router.navigate({ pathname: '/(main)/chat/[sessionId]', params: { sessionId: session.id } })}>
                <RoomIdentityAvatar name={agent.displayName} avatar={agent.avatar} agent size={44} />
                <View style={styles.globalConversationCopy}>
                  <Text style={[styles.globalRowTitle, { color: colors.text }]} numberOfLines={1}>{session.title || agent.displayName}</Text>
                  <Text style={[styles.globalConversationTime, { color: colors.textSecondary }]}>
                    {formatSessionClockTime(session.lastActivityAt)}
                  </Text>
                </View>
              </Pressable>
            </View>)}
          </View>
        </> : null}
        {!contextRoomId ? <Text style={[styles.globalSectionTitle, { color: colors.textSecondary }]}>
          {t('agents_participating_rooms')}
          <Text testID="agent-participation-count">{'（'}{visibleConversations.length}{'）'}</Text>
        </Text> : null}
        {contextRoomId ? (
          <View style={styles.relationshipSettings}>
            {visibleConversations.length ? <>
              <Text style={[styles.contextSectionTitle, { color: colors.textSecondary }]}>{t('mobile_agent_work')}</Text>
              {visibleConversations.map((session) => <Pressable key={session.id} accessibilityRole="button"
                testID="agent-internal-work-chat" style={[styles.internalChat, { backgroundColor: colors.groupedSurface }]}
                onPress={() => router.navigate({ pathname: '/(main)/room-workspace', params: {
                  roomId: contextRoomId, scopedAgentSessionId: session.id, scopedAgentIdentityId: agent.id,
                } })}>
                <RoomIdentityAvatar name={agent.displayName} avatar={agent.avatar} agent size={40} />
                <View style={styles.internalCopy}>
                  <Text style={[styles.internalTitle, { color: colors.text }]}>{t('mobile_internal_work_chat')}</Text>
                  <Text style={[styles.internalHint, { color: colors.textSecondary }]} numberOfLines={1}>{t('mobile_internal_work_chat_hint')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Pressable>)}
            </> : null}
            <Text style={[styles.contextSectionTitle, { color: colors.textSecondary }]}>{t('mobile_conversation_settings')}</Text>
            <RoomAgentParticipation roomId={contextRoomId} agentIdentityId={agent.id} showOverview={false}
              onUpdated={() => void refresh()} onRemoved={() => router.back()} />
          </View>
        ) : visibleConversations.length ? (
          <View style={[styles.globalCard, styles.globalConversationsCard, { backgroundColor: colors.groupedSurface }]}>
            {visibleConversations.map((session, index) => {
              if (!session.room) return null
              const roomId = session.room.roomId
              const participation = roomActivationModeToParticipation(session.room.activationMode)
              const room = rooms.find((item) => item.id === roomId)
              const roomName = room?.name || session.room.roomName || session.title
              const latest = room?.latestMessage
              const latestBody = latest && accountId ? getRoomBodyPreview(accountId, roomId, latest) : undefined
              const message = latestBody ?? latest
              const preview = message?.text?.trim()
                ? `${message.author.displayName}: ${message.text.trim()}`
                : t(`spaces_agent_status_${participation}`)
              const time = room ? formatSessionClockTime(latest?.createdAt ?? room.updatedAt) : ''
              return <View key={`${accountId}:${agentId}:${roomId}`}>
                {index > 0 ? <View style={[styles.globalDivider, { backgroundColor: colors.border }]} /> : null}
                <Pressable testID={`agent-participation-${roomId}`} accessibilityRole="button"
                  accessibilityLabel={`${roomName}, ${preview}`}
                  onPress={() => router.navigate({ pathname: '/(main)/room-workspace', params: { roomId } })}
                  style={styles.globalConversationRow}>
                  <RoomGroupAvatar members={room?.avatarMembers ?? []} />
                  <View style={styles.globalConversationCopy}>
                    <View style={styles.globalConversationTitleRow}>
                      <Text style={[styles.globalRowTitle, { flex: 1, color: colors.text }]} numberOfLines={1}>{roomName}</Text>
                      {time ? <Text style={[styles.globalConversationTime, { color: colors.textSecondary }]}>{time}</Text> : null}
                    </View>
                    <Text style={[styles.globalConversationHint, { color: colors.textSecondary }]} numberOfLines={1}>
                      {preview}
                    </Text>
                  </View>
                </Pressable>
              </View>
            })}
          </View>
        ) : !personalConversations.length ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('agents_no_conversations')}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
              {zh ? '点击“发消息”新建对话，也可以把这个智能体添加到群聊。'
                : 'Tap Message to start a conversation, or add this AI to a group chat.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 }, body: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'flex-start', paddingBottom: 32 },
  globalContent: { paddingHorizontal: 16, paddingTop: 18, gap: 0 },
  globalCard: { borderRadius: 16, overflow: 'hidden', paddingHorizontal: 16 },
  globalIdentity: { flexDirection: 'row', alignItems: 'center', minHeight: 86, gap: 12 },
  globalIdentityCopy: { flex: 1, minWidth: 0, gap: 4 },
  globalName: { ...mobileTypography.listTitle },
  globalDescription: { ...mobileTypography.secondary },
  globalDivider: { height: StyleSheet.hairlineWidth },
  globalRuntime: { ...mobileTypography.secondary, minHeight: 48, paddingTop: 14 },
  globalSectionTitle: { ...mobileTypography.secondary, marginTop: 22, marginBottom: 10, paddingHorizontal: 4 },
  globalManageCard: { paddingHorizontal: 16 },
  globalCardRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10 },
  globalCardCopy: { flex: 1, minWidth: 0, gap: 4 },
  globalRowTitle: { ...mobileTypography.listTitle },
  globalManageTitle: { ...mobileTypography.listTitle },
  globalCardStatus: { ...mobileTypography.metadata, flexShrink: 1, maxWidth: '35%' },
  globalRowValue: { ...mobileTypography.secondary },
  globalConversationsCard: { paddingHorizontal: 12 },
  globalConversationRow: { minHeight: 74, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  globalConversationCopy: { flex: 1, minWidth: 0, gap: 4 },
  globalConversationTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  globalConversationTime: { ...mobileTypography.metadata },
  globalConversationHint: { ...mobileTypography.secondary },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { flexShrink: 1, ...mobileTypography.sectionTitle },
  assignment: { borderBottomWidth: StyleSheet.hairlineWidth },
  mode: { fontSize: 13, lineHeight: 19, textAlign: 'right' },
  relationshipSettings: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  contextSectionTitle: { fontSize: 13, paddingTop: 20, paddingBottom: 8 },
  internalChat: { minHeight: 72, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  internalCopy: { flex: 1, minWidth: 0, gap: 3 }, internalTitle: { fontSize: 16, fontWeight: '600' }, internalHint: { fontSize: 13 },
  scopeButton: { minHeight: 44, justifyContent: 'center' },
  repair: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  publication: { minHeight: 48, paddingHorizontal: 16, justifyContent: 'center' },
  empty: { minHeight: 160, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...mobileTypography.sectionTitle },
  emptyHint: { ...mobileTypography.secondary, textAlign: 'center', marginTop: 8 },
})
