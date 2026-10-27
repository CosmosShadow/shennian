// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../__tests__/desktop-room-agent-add-ui.test.ts
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import { selectRoomParticipationAgent } from '../rooms/agentParticipationNavigation'
import type { RoomMemberView } from '../rooms/types'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { desktopRoomManagementClient } from '../desktop-rooms/desktopRoomManagementClient'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

export default function DesktopRoomAgentChooserRoute() {
  const { roomId = '', agentIdentityId = '' } = useLocalSearchParams<{
    roomId: string
    agentIdentityId?: string
  }>()
  return <DesktopRoomAgentChooserScreen roomId={roomId} agentIdentityId={agentIdentityId} />
}
export function DesktopRoomAgentChooserScreen(props: {
  roomId: string
  agentIdentityId: string
  page?: 'overview' | 'mode'
}) {
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  return (
    <Chooser
      key={`${accountId}:${props.roomId}:${props.agentIdentityId}`}
      {...props}
      accountId={accountId}
    />
  )
}
function Chooser({
  roomId,
  agentIdentityId,
  accountId,
}: {
  roomId: string
  agentIdentityId: string
  accountId: string
}) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [members, setMembers] = useState<RoomMemberView[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const open = useCallback(
    (id: string) => {
      if (useAuthStore.getState().user?.id === accountId)
        router.replace({
          pathname: '/(main)/agents/[agentId]',
          params: { agentId: id, contextRoomId: roomId },
        })
    },
    [accountId, roomId, router],
  )
  useKeyboardShortcut({ key: 'escape', allowEditable: true }, true, () => router.back())
  useFocusEffect(
    useCallback(() => {
      let active = true
      const unsubscribe = useAuthStore.subscribe((next, previous) => {
        if (next.user?.id !== previous.user?.id) active = false
      })
      setState('loading')
      setMembers([])
      if (!accountId || !roomId) {
        setState('failed')
        return unsubscribe
      }
      void desktopRoomManagementClient
        .listMembers(roomId)
        .then((items) => {
          if (!active || useAuthStore.getState().user?.id !== accountId) return
          const owned = items.filter(
            (item) =>
              item.principalType === 'agent' &&
              item.ownerUserId === accountId &&
              item.agentIdentityId,
          )
          setMembers(owned)
          setState('ready')
          const selected = selectRoomParticipationAgent(owned, accountId, agentIdentityId)
          if (selected?.agentIdentityId) open(selected.agentIdentityId)
        })
        .catch(() => {
          if (active && useAuthStore.getState().user?.id === accountId) setState('failed')
        })
      return () => {
        active = false
        unsubscribe()
      }
    }, [accountId, roomId, agentIdentityId, attempt, open]),
  )
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <DesktopMachineAction label={t('back')} onPress={() => router.back()} />
        <Text
          accessibilityRole="header"
          style={{ color: colors.text, ...desktopTypography.windowTitle }}
        >
          {t('agent_participation_title')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingVertical: 24, gap: 12 }}>
        {state === 'loading' ? (
          <ActivityIndicator accessibilityLabel={t('loading')} color={colors.brand} />
        ) : state === 'failed' ? (
          <View>
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {t('agent_participation_load_failed')}
            </Text>
            <DesktopMachineAction
              label={t('retry')}
              onPress={() => setAttempt((value) => value + 1)}
            />
          </View>
        ) : (
          <>
            <Text style={{ color: colors.textSecondary }}>
              {t(members.length ? 'agent_participation_choose' : 'room_workspace_no_agents')}
            </Text>
            {members.map((member) => (
              <DesktopMachineAction
                key={member.id}
                label={member.displayAlias}
                onPress={() => open(member.agentIdentityId!)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}
