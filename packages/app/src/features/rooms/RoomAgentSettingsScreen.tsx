// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-agent-settings.test.ts
import { useCallback, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { roomAccountClient } from './roomAccountClient'
import { selectRoomParticipationAgent } from './agentParticipationNavigation'
import { RoomIdentityAvatar } from './components/RoomIdentityAvatar'
import type { RoomMemberView } from './types'
import { mobileTypography } from '../../theme/mobileTypography'

/** Full-page chooser and compatibility entry. A sole/explicit owned identity opens the canonical detail. */
export function RoomAgentSettingsScreen({ roomId, agentIdentityId }: { roomId: string; agentIdentityId: string; page?: 'overview' | 'mode' }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id)
  const [members, setMembers] = useState<RoomMemberView[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  useFocusEffect(useCallback(() => {
    let active = true
    setState('loading'); setMembers([])
    void roomAccountClient.listMembers(roomId).then((items) => {
      if (!active) return
      const owned = items.filter((item) => item.principalType === 'agent' && item.ownerUserId === accountId && item.agentIdentityId)
      const selected = selectRoomParticipationAgent(owned, accountId, agentIdentityId)
      setMembers(owned); setState('ready')
      if (selected?.agentIdentityId) router.replace({ pathname: '/(main)/agents/[agentId]', params: { agentId: selected.agentIdentityId, contextRoomId: roomId } })
    }).catch(() => { if (active) setState('failed') })
    return () => { active = false }
  }, [accountId, agentIdentityId, attempt, roomId, router]))
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
    <AppPageHeader title={t('agent_participation_title')} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {state === 'loading' ? <ActivityIndicator color={colors.brand} /> : state === 'failed' ?
        <Pressable onPress={() => setAttempt((value) => value + 1)} style={styles.row}><Text style={{ color: colors.error }}>{t('agent_participation_load_failed')} {t('retry')}</Text></Pressable> :
        <><Text style={[styles.notice, { color: colors.textSecondary }]}>{t(members.length ? 'agent_participation_choose' : 'room_workspace_no_agents')}</Text>
          {members.map((member) => <Pressable key={member.id} accessibilityRole="button" style={styles.row}
            onPress={() => router.replace({ pathname: '/(main)/agents/[agentId]', params: { agentId: member.agentIdentityId!, contextRoomId: roomId } })}>
            <RoomIdentityAvatar name={member.displayAlias} avatar={member.avatar} agent size={40} />
            <Text style={[styles.name, { color: colors.text }]}>{member.displayAlias}</Text>
          </Pressable>)}
        </>}
    </ScrollView>
  </SafeAreaView>
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { padding: 16 }, notice: { fontSize: 13, lineHeight: 19, paddingVertical: 12, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 }, name: { fontSize: 17, lineHeight: 22, ...(Platform.OS !== 'web' && mobileTypography.listTitle) } })
