// @arch docs/features/network-rooms/ui.md#七智能体内部对话与群聊的平级切换
// @test src/__tests__/room-management-panel.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { Swipeable } from 'react-native-gesture-handler'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import type { RoomDetailView, RoomMemberView } from '../types'
import { RoomAgentParticipationEntry } from './RoomAgentParticipationEntry'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'
import { RoomMemberRemovalConfirmModal } from './RoomMemberRemovalConfirmModal'
import { useAuthStore } from '../../../config/auth'
import { removeRoomAgent } from '../removeRoomAgent'
import { getRoomMemberParticipation } from '../roomPresentation'
import { roomAccountClient } from '../roomAccountClient'
import { RoomAgentStatusLabel } from './RoomAgentStatusLabel'
import { isRoomAgentIdentityDimmed } from './roomAgentStatusPresentation'

export function RoomMyAgentsPanel({
  roomId,
  members,
  currentUserId,
  onMembersUpdated,
  editable = true,
}: {
  roomId: string
  room: RoomDetailView
  members: RoomMemberView[]
  currentUserId?: string | null
  onMembersUpdated: (members: RoomMemberView[]) => void
  editable?: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [removalTarget, setRemovalTarget] = useState<RoomMemberView | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeFailed, setRemoveFailed] = useState(false)
  const alive = useRef(true)
  const inFlight = useRef<object | null>(null)
  const current = useRef({ roomId, currentUserId, members, editable, removalTarget })
  current.current = { roomId, currentUserId, members, editable, removalTarget }
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    inFlight.current = null
    setSelectedAgentId(null)
    setRemovalTarget(null)
    setRemoving(false)
    setRemoveFailed(false)
  }, [roomId, currentUserId])
  const isSameContext = () => alive.current && current.current.roomId === roomId
    && current.current.currentUserId === currentUserId
    && Boolean(currentUserId) && useAuthStore.getState().user?.id === currentUserId
  const agents = members.filter(
    (member) => member.principalType === 'agent' && member.ownerUserId === currentUserId,
  )
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null
  const requestRemove = (agent: RoomMemberView) => {
    setSelectedAgentId(null)
    setRemoveFailed(false)
    setRemovalTarget(agent)
  }

  const confirmRemove = async () => {
    if (!removalTarget || removing || inFlight.current || !currentUserId || !editable || !isSameContext()) return
    const agent = removalTarget
    const currentMember = current.current.members.find((member) => member.id === agent.id)
    if (currentMember?.principalType !== 'agent' || currentMember.ownerUserId !== currentUserId
      || currentMember.agentIdentityId !== agent.agentIdentityId
      || currentMember.ownBinding?.nianSessionId !== agent.ownBinding?.nianSessionId) return
    const isCurrent = () => isSameContext() && current.current.editable
      && current.current.removalTarget?.id === agent.id
    const ticket = {}
    inFlight.current = ticket
    setRemoving(true)
    setRemoveFailed(false)
    try {
      await removeRoomAgent({ accountId: currentUserId, roomId, membershipId: agent.id,
        agentId: agent.agentIdentityId, sessionId: agent.ownBinding?.nianSessionId }, isCurrent)
      if (!isCurrent()) return
      onMembersUpdated(current.current.members.filter((member) => member.id !== agent.id))
      setRemovalTarget(null)
    } catch {
      if (isCurrent()) setRemoveFailed(true)
    } finally {
      if (inFlight.current === ticket) {
        inFlight.current = null
        if (isSameContext()) setRemoving(false)
      }
    }
  }


  return (
    <View
      testID="room-my-agents-inline"
      style={[styles.panel, { backgroundColor: colors.groupedSurface }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.groupedSeparator }]}>
        <Text style={[styles.title, { color: colors.text }]}>{t(Platform.OS === 'web' ? 'spaces_my_agents' : 'mobile_my_ai')}</Text>
      </View>
      {agents.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          {t('spaces_my_agents_empty')}
        </Text>
      ) : (
        agents.map((agent, index) => (
          <RoomAgentRow
            key={agent.id}
            agent={agent}
            showSeparator={index < agents.length - 1}
            editable={editable}
            onOpenSettings={() => setSelectedAgentId(agent.id)}
            onRemove={() => requestRemove(agent)}
          />
        ))
      )}
      <RoomAgentParticipationEntry roomId={roomId} members={agents}
        agentIdentityId={selectedAgent?.agentIdentityId} visible={Boolean(selectedAgent)}
        onClose={() => setSelectedAgentId(null)}
        onUpdated={() => void roomAccountClient.listMembers(roomId).then((updated) => {
          if (isSameContext()) onMembersUpdated(updated)
        }).catch(() => {})} />
      <RoomMemberRemovalConfirmModal
        member={removalTarget}
        visible={Boolean(removalTarget)}
        removing={removing}
        failed={removeFailed}
        onClose={() => {
          if (removing) return
          setRemovalTarget(null)
          setRemoveFailed(false)
        }}
        onConfirm={() => void confirmRemove()}
      />
    </View>
  )
}

function RoomAgentRow({
  agent,
  showSeparator,
  editable,
  onOpenSettings,
  onRemove,
}: {
  agent: RoomMemberView
  showSeparator: boolean
  editable: boolean
  onOpenSettings: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const swipeRef = useRef<Swipeable>(null)
  const requestRemove = useCallback(() => {
    swipeRef.current?.close()
    onRemove()
  }, [onRemove])
  const renderRightActions = useCallback(
    (
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>,
    ) => {
      const translateX = dragX.interpolate({
        inputRange: [-132, 0],
        outputRange: [0, 24],
        extrapolate: 'clamp',
      })
      return (
        <Pressable
          testID={`room-remove-own-agent-${agent.id}`}
          style={[styles.swipeRemove, { backgroundColor: colors.error }]}
          onPress={requestRemove}
          accessibilityRole="button"
          accessibilityLabel={t('spaces_remove_own_agent')}
        >
          <Animated.Text style={[styles.swipeRemoveText, { transform: [{ translateX }] }]}>
            {t('spaces_remove_own_agent')}
          </Animated.Text>
        </Pressable>
      )
    },
    [agent.id, colors.error, requestRemove, t],
  )
  const participation = getRoomMemberParticipation(agent)
  const offline = isRoomAgentIdentityDimmed(participation)
  const status = participation ? t(`spaces_agent_status_full_${participation}`) : null
  const content = (
    <Pressable
      testID={`room-agent-settings-${agent.id}`}
      disabled={!editable}
      onPress={onOpenSettings}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          ...(showSeparator ? { borderBottomWidth: 1, borderBottomColor: colors.groupedSeparator } : {}),
        },
      ]}
    >
      <RoomIdentityAvatar
        name={agent.displayAlias}
        avatar={agent.avatar}
        agent
        ownerAvatar={agent.ownerAvatar}
        ownerName={agent.ownerDisplayName}
        size={40}
        offline={offline}
      />
      <Text
        style={[styles.name, { color: offline ? (Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary) : colors.text }]}
        numberOfLines={1}
      >
        {agent.displayAlias}
      </Text>
      {status && participation ? (
        <RoomAgentStatusLabel participation={participation} label={status} style={styles.modeStatus} />
      ) : null}
      {editable ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
    </Pressable>
  )
  if (!editable || Platform.OS === 'web') return content
  return (
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
}

const styles = StyleSheet.create({
  panel: { marginTop: 12, borderRadius: 12, overflow: 'hidden' },
  header: {
    minHeight: 52,
    paddingLeft: 18,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '400', ...(Platform.OS !== 'web' && mobileTypography.body) },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingLeft: 16,
    paddingRight: 14,
    ...(Platform.OS !== 'web' && { paddingVertical: 12 }),
  },
  name: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '400', ...(Platform.OS !== 'web' && mobileTypography.body) },
  modeStatus: { flexShrink: 1, maxWidth: Platform.OS === 'web' ? 132 : '45%' },
  swipeRemove: {
    width: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  swipeRemoveText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  empty: { textAlign: 'center', paddingHorizontal: 18, paddingVertical: 24, fontSize: 14 },
})
