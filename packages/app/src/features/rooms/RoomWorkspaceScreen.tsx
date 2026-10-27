import { ActionIconButton } from '../../components/ActionIconButton'
// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-workspace.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { HeaderBackButton } from '../../components/AppPageHeader'
import { useFocusEffect, useNavigation, usePathname, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { NianSession } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { useTheme } from '../../hooks/useTheme'
import { useGoBack } from '../../hooks/useGoBack'
import { mobileTypography } from '../../theme/mobileTypography'
import ChatScreen from '../chat/screens/ChatScreen'
import { RoomAgentParticipationEntry } from './components/RoomAgentParticipationEntry'
import { resolveScopedAgentIdentity } from './agentParticipationNavigation'
import { RoomWorkspaceActivityContext } from './RoomWorkspaceActivityContext'
import { RoomAgentModeContext } from './components/RoomAgentModePicker'
import { getRoomWorkspaceBackGestureOptions } from '../chat/utils/navigation'
import { RoomConversationScreen } from './RoomConversationScreen'
import { RoomHeaderTitle } from './components/RoomHeaderTitle'
import { subscribeRoomEvents } from './roomEvents'
import { getRoomWorkspaceHeaderDetailsTarget } from './roomAgentNavigation'
import { useRoomWorkspaceData } from './useRoomWorkspaceData'
import type { WorkspaceLoadState } from './useRoomWorkspaceData.types'
import type { RoomMemberView } from './types'

type AgentSurface = {
  membershipId: string
  agentIdentityId: string
  sessionId: string
  name: string
  avatar: RoomMemberView['avatar']
  ownerAvatar: RoomMemberView['ownerAvatar']
  ownerDisplayName?: string | null
}

const WORKSPACE_HEADER_HEIGHT = 48

export function RoomWorkspaceScreen({
  roomId,
  scopedAgentSessionId,
  scopedAgentIdentityId,
}: {
  roomId: string
  initialAgentSessionId?: string
  scopedAgentSessionId?: string
  scopedAgentIdentityId?: string
}) {
  const router = useRouter()
  const goBack = useGoBack('/(main)/spaces')
  const pathname = usePathname()
  const navigation = useNavigation()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const currentUserId = useAuthStore((state) => state.user?.id)
  const { room, members, membersLoaded, loadState, setMembers, load, cancelLoad, hasCurrentRoom } =
    useRoomWorkspaceData({ roomId, currentUserId })
  const isPublishedAi = room?.conversationKind === 'published_ai'
  const scoped = Boolean(scopedAgentSessionId || scopedAgentIdentityId)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(scopedAgentSessionId ?? null)
  const [participationOpen, setParticipationOpen] = useState(false)
  const scopeKey = `${currentUserId}:${roomId}:${scopedAgentSessionId ?? ''}:${scopedAgentIdentityId ?? ''}`
  const scopeIdentityRef = useRef({ key: scopeKey, id: scopedAgentIdentityId ?? null as string | null })
  if (scopeIdentityRef.current.key !== scopeKey) scopeIdentityRef.current = { key: scopeKey, id: scopedAgentIdentityId ?? null }
  const selectionContextRef = useRef(`${currentUserId}:${roomId}`)
  const selectedAgentIdentityRef = useRef<string | null>(null)
  if (selectionContextRef.current !== `${currentUserId}:${roomId}`) {
    selectionContextRef.current = `${currentUserId}:${roomId}`
    selectedAgentIdentityRef.current = null
  }
  useEffect(() => { setParticipationOpen(false) }, [currentUserId, roomId])
  const [workspaceFocused, setWorkspaceFocused] = useState(false)
  const workspaceRouteActive = workspaceFocused && pathname === '/room-workspace'
  const useKeyboardAvoider = Platform.OS === 'ios' || Platform.OS === 'android'
  const keyboardAvoidingBehavior = Platform.OS === 'android' ? 'height' : 'padding'
  useFocusEffect(
    useCallback(() => {
      setWorkspaceFocused(true)
      void load({ preserveContent: hasCurrentRoom })
      return () => {
        setWorkspaceFocused(false)
        cancelLoad()
      }
    }, [cancelLoad, hasCurrentRoom, load]),
  )

  useEffect(() => {
    if (!workspaceRouteActive || !isPublishedAi) return
    router.replace({
      pathname: '/(main)/published-conversations/[conversationId]',
      params: { conversationId: roomId },
    })
  }, [isPublishedAi, roomId, router, workspaceRouteActive])

  useEffect(() => {
    if (!workspaceRouteActive) return
    return subscribeRoomEvents((event) => {
      if (event.event === 'room.replica.updated') {
        if (event.roomId === null || event.roomId === roomId) {
          void load({ preserveContent: hasCurrentRoom })
        }
        return
      }
      if (
        !('roomId' in event) ||
        event.roomId !== roomId ||
        (event.event !== 'room.membership.updated' && event.event !== 'room.binding.updated')
      )
        return
      void load({ preserveContent: hasCurrentRoom })
    })
  }, [hasCurrentRoom, load, roomId, workspaceRouteActive])

  const allAgents = useMemo<AgentSurface[]>(
    () =>
      members.reduce<AgentSurface[]>((result, member) => {
        const binding = member.ownBinding
        if (
          member.principalType !== 'agent' ||
          member.ownerUserId !== currentUserId ||
          !binding?.nianSessionId ||
          (binding.status !== 'active' && binding.status !== 'paused')
        )
          return result
        result.push({
          membershipId: member.id,
          agentIdentityId: member.agentIdentityId || binding.agentIdentityId || '',
          sessionId: binding.nianSessionId,
          name: member.displayAlias,
          avatar: member.avatar,
          ownerAvatar: member.ownerAvatar,
          ownerDisplayName: member.ownerDisplayName,
        })
        return result
      }, []),
    [currentUserId, members],
  )
  const resolvedScopeIdentity = resolveScopedAgentIdentity(allAgents, scopedAgentSessionId, scopedAgentIdentityId ?? scopeIdentityRef.current.id ?? undefined)
  if (resolvedScopeIdentity) scopeIdentityRef.current.id = resolvedScopeIdentity
  const agents = useMemo(
    () => scoped
      ? allAgents.filter((agent) => resolvedScopeIdentity
        ? agent.agentIdentityId === resolvedScopeIdentity : agent.sessionId === scopedAgentSessionId)
      : [],
    [allAgents, resolvedScopeIdentity, scopedAgentSessionId, scoped],
  )

  useEffect(() => {
    setActiveSessionId(scopedAgentSessionId ?? null)
  }, [currentUserId, roomId, scopedAgentSessionId, scopedAgentIdentityId])

  useEffect(() => {
    if (!workspaceRouteActive || participationOpen || !activeSessionId || !agents.some((agent) => agent.sessionId === activeSessionId)) return
    void accountRuntime.markSessionRead(activeSessionId, new Date().toISOString()).catch(() => {})
  }, [activeSessionId, agents, participationOpen, workspaceRouteActive])

  useEffect(() => {
    const selected = agents.find((agent) => agent.sessionId === activeSessionId)
    if (selected) selectedAgentIdentityRef.current = selected.agentIdentityId
    if (
      membersLoaded &&
      activeSessionId &&
      !agents.some((agent) => agent.sessionId === activeSessionId)
    ) {
      const replacement = agents.find((agent) => agent.agentIdentityId === selectedAgentIdentityRef.current)
      setActiveSessionId(replacement?.sessionId ?? null)
    }
  }, [activeSessionId, agents, membersLoaded])

  useEffect(() => {
    navigation.setOptions(getRoomWorkspaceBackGestureOptions(Platform.OS, scoped ? activeSessionId : null))
  }, [activeSessionId, navigation, scoped])

  const handleManagedSessionRestarted = useCallback(
    (previousSessionId: string, replacement: NianSession) => {
      setMembers((current) =>
        current.map((member) =>
          member.ownBinding?.nianSessionId === previousSessionId
            ? {
                ...member,
                ownBinding: { ...member.ownBinding, nianSessionId: replacement.id },
              }
            : member,
        ),
      )
      setActiveSessionId((current) => current === previousSessionId ? replacement.id : current)
    },
    [setMembers],
  )

  const displayedAgent = scoped ? agents.find((agent) => agent.sessionId === activeSessionId) : undefined
  const headerDetailsTarget = getRoomWorkspaceHeaderDetailsTarget(false, displayedAgent?.sessionId ?? null)
  const ready = loadState === 'ready' && room !== null && !isPublishedAi
  // Mobile pages are heavyweight: both RoomConversationScreen and ChatScreen
  // own network, SQLite and rendering lifecycles. Keep only the visible page
  // mounted. Keep the selected Room mounted under pushed settings pages;
  // focus gates its activity/read receipts, not its rendering lifetime.
  const roomStream =
    ready && !scoped ? (
      <RoomConversationScreen
        key={roomId}
        roomId={roomId}
        embedded
        hideHeader
        readActive={workspaceRouteActive && !participationOpen}
      />
    ) : null
  const renderAgentStream = (agent: AgentSurface) => (
    <RoomWorkspaceActivityContext.Provider key={agent.sessionId} value={workspaceRouteActive && !participationOpen}>
    <RoomAgentModeContext.Provider key={agent.sessionId} value={agent.agentIdentityId ? {
      roomId, roomName: room?.name ?? '', agentIdentityId: agent.agentIdentityId,
      sessionId: agent.sessionId,
      activationMode: members.find((member) => member.ownBinding?.nianSessionId === agent.sessionId)?.ownBinding?.activationMode,
    } : null}>
    <ChatScreen
      key={agent.sessionId}
      sessionIdOverride={agent.sessionId}
      workspaceRoomId={roomId}
      workspaceAgentIdentityId={agent.agentIdentityId}
      workspaceAgentName={agent.name}
      workspaceAgentAvatar={agent.avatar}
      workspaceAgentOwnerAvatar={agent.ownerAvatar}
      workspaceAgentOwnerName={agent.ownerDisplayName}
      embedded
      hideHeader
    />
    </RoomAgentModeContext.Provider>
    </RoomWorkspaceActivityContext.Provider>
  )
  const openRoomDetails = () => {
    Keyboard.dismiss()
    router.navigate({ pathname: '/(main)/spaces/details', params: { roomId } })
  }
  const openCurrentSurfaceDetails = () => {
    Keyboard.dismiss()
    if (headerDetailsTarget === 'agent') {
      setParticipationOpen(true)
      return
    }
    openRoomDetails()
  }
  const participationIdentity = agents.find((agent) => agent.sessionId === activeSessionId)?.agentIdentityId
    || resolvedScopeIdentity || selectedAgentIdentityRef.current
  const workspaceHeader = (
    <View style={[styles.header, { borderBottomColor: colors.separator ?? colors.border }]}>
      <HeaderBackButton testID="room-workspace-back" onPress={goBack} />
      <Pressable testID="room-workspace-room-info" onPress={openCurrentSurfaceDetails} style={styles.title}
        disabled={!ready} accessibilityRole="button" accessibilityLabel={t(scoped ? 'agent_participation_title' : 'spaces_details_accessibility')}>
        {displayedAgent ? (
          <Text style={[styles.titleText, { color: colors.text }]} numberOfLines={1}>{displayedAgent.name}</Text>
        ) : (
          <RoomHeaderTitle name={room?.name ?? t('workspace_spaces')} count={room ? members.length : null}
            style={styles.title} textStyle={styles.titleText} />
        )}
      </Pressable>
      <ActionIconButton icon="more" color={colors.text}
        testID="room-workspace-details"
        style={styles.headerButton}
        onPress={openCurrentSurfaceDetails}
        disabled={!ready}
        label={t(
          headerDetailsTarget === 'agent'
            ? 'agent_participation_title'
            : 'spaces_details_accessibility',
        )}
       />
    </View>
  )

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      {workspaceHeader}

      {isPublishedAi ? (
        <RoomWorkspaceLoadState state="loading" retry={() => load({ preserveContent: false })} onBack={goBack} />
      ) : !ready ? (
        <RoomWorkspaceLoadState
          state={loadState}
          retry={() => load({ preserveContent: false })}
          onBack={goBack}
        />
      ) : useKeyboardAvoider ? (
        <KeyboardAvoidingView behavior={keyboardAvoidingBehavior} style={styles.mobileBody}>
          <View testID="room-workspace-mobile" style={styles.mobileBody}>
            {scoped ? (displayedAgent ? renderAgentStream(displayedAgent) : null) : roomStream}
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View testID="room-workspace-mobile" style={styles.mobileBody}>
          {scoped ? (displayedAgent ? renderAgentStream(displayedAgent) : null) : roomStream}
        </View>
      )}
      <RoomAgentParticipationEntry roomId={roomId} members={members.filter((member) =>
        !resolvedScopeIdentity || member.agentIdentityId === resolvedScopeIdentity)}
        agentIdentityId={participationIdentity} visible={participationOpen} loading={!membersLoaded}
        onClose={() => setParticipationOpen(false)} onUpdated={() => void load({ preserveContent: true })}
        onRestarted={handleManagedSessionRestarted} />
    </SafeAreaView>
  )
}

function RoomWorkspaceLoadState({
  state,
  retry,
  onBack,
}: {
  state: WorkspaceLoadState
  retry: () => Promise<void>
  onBack: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (state === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    )
  }
  const unavailable = state === 'unavailable'
  return (
    <View
      testID={unavailable ? 'room-workspace-unavailable' : 'room-workspace-load-failed'}
      style={[styles.center, styles.loadState, { backgroundColor: colors.bg }]}
    >
      <Ionicons
        name={unavailable ? 'lock-closed-outline' : 'cloud-offline-outline'}
        size={38}
        color={colors.textTertiary}
      />
      <Text style={[styles.loadTitle, { color: colors.text }]}>
        {t(unavailable ? 'spaces_unavailable_title' : 'spaces_load_failed')}
      </Text>
      {unavailable ? (
        <Text style={[styles.loadBody, { color: colors.textSecondary }]}>
          {t('spaces_unavailable_body')}
        </Text>
      ) : null}
      <Pressable onPress={unavailable ? onBack : () => void retry()}>
        <Text style={[styles.loadAction, { color: colors.brand }]}>
          {t(unavailable ? 'back' : 'retry')}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  header: {
    height: WORKSPACE_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
  },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1 },
  titleText: { ...mobileTypography.navigationTitle },
  mobileBody: { flex: 1, minHeight: 0 },
  loadState: { padding: 30 },
  loadTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  loadBody: { maxWidth: 360, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  loadAction: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
})
