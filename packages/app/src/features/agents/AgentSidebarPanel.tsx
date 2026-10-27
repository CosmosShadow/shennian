// @arch docs/features/agent-workspaces.md
// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test packages/app/src/__tests__/agent-list-account-state.test.ts

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import type { AgentWorkspace } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { isAgentRuntimeOffline } from '@shennian/shared'
import { useAgentSidebarModel } from './useAgentSidebarModel'
import { useState } from 'react'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import {
  formatAgentRoomParticipationCompact,
  getAgentRoomParticipationSummary,
} from './agentRoomParticipationSummary'
export { useAgentSidebarModel } from './useAgentSidebarModel'

export function useAgentSidebarItems() {
  return useAgentSidebarModel().agents
}

export function AgentSidebarPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useTranslation()
  const { agents, state, retry } = useAgentSidebarModel()
  if (state === 'initial-loading') {
    return (
      <View accessibilityRole="progressbar" style={s.status} testID="sidebar-agents-loading">
        <ActivityIndicator size="small" />
      </View>
    )
  }
  if (state === 'empty') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate('/(main)/agents/new')}
        style={s.status}
        testID="sidebar-agents-empty-action"
      >
        <Text>{t('agents_create')}</Text>
      </Pressable>
    )
  }
  return (
    <View>
      {state === 'recoverable-error' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void retry()}
          style={s.status}
          testID="sidebar-agents-retry"
        >
          <Text>{t('retry')}</Text>
        </Pressable>
      ) : null}
      {agents.map((agent) => (
        <AgentSidebarRow
          key={agent.id}
          agent={agent}
          active={pathname.includes(agent.id)}
          onPress={() => router.navigate(`/(main)/agents/${agent.id}`)}
        />
      ))}
    </View>
  )
}

export function AgentSidebarRow({
  agent,
  active,
  onPress,
  compact = false,
}: {
  agent: AgentWorkspace
  active: boolean
  onPress: () => void
  compact?: boolean
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const offline = isAgentRuntimeOffline(agent.availability)
  const participation = getAgentRoomParticipationSummary(agent.sessions)
  const participationAccessibilityLabel = participation.active === participation.total
    ? t('agents_room_count', { count: participation.total })
    : t('agents_active_room_count_accessibility', participation)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <View style={compact ? { marginHorizontal: 8 } : undefined}>
    <Pressable
      testID={`sidebar-agent-${agent.id}`}
      accessibilityRole="button"
      accessibilityLabel={[
        offline
          ? t('spaces_agent_status_accessibility', {
              name: agent.displayName,
              status: t('spaces_agent_status_offline'),
            })
          : agent.displayName,
        participationAccessibilityLabel,
      ].join(', ')}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={event => setFocused(compact ? (event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false : true)}
      onBlur={() => setFocused(false)}
      style={[
        s.row,
        compact && s.compactRow,
        {
          backgroundColor: active
            ? colors.selectionBackground
            : hovered
              ? colors.surfaceHover
              : 'transparent',
          borderColor: focused ? colors.brand : 'transparent',
        },
      ]}
    >
      <RoomIdentityAvatar
        name={agent.displayName}
        avatar={agent.avatar}
        agent
        ownerName={user?.name}
        ownerAvatar={user?.avatar}
        size={compact ? 20 : 24}
        offline={offline}
      />
      <View style={s.heading}>
        <Text
          style={[
            s.name,
            compact && s.compactName,
            {
              color: offline ? colors.textSecondary : colors.text,
            },
          ]}
          numberOfLines={1}
        >
          {agent.displayName}
        </Text>
        <Text
          style={[
            s.count,
            {
              color: participation.total > 0 && participation.active === 0
                ? colors.warningText
                : colors.textSecondary,
            },
          ]}
          numberOfLines={1}
        >
          {formatAgentRoomParticipationCompact(participation)}
        </Text>
      </View>
    </Pressable>
    </View>
  )
}
const s = StyleSheet.create({
  row: {
    minHeight: 40,
    paddingLeft: 24,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 7,
    borderWidth: 1,
  },
  compactRow: { minHeight: 40, paddingLeft: 12, paddingRight: 8, gap: 7, borderRadius: 9, alignSelf: 'stretch' },
  heading: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '500' },
  compactName: desktopTypography.sidebarRoomTitle,
  count: {
    flexShrink: 0,
    maxWidth: '45%',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    ...desktopTypography.metadata,
  },
  status: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 },
})
