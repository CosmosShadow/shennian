import { DesktopSplitResizeHandle, useDesktopSplitWidth } from '../desktop-shell/DesktopSplitResizeHandle'
// @arch docs/design/desktop/unified-desktop-control.md#群聊工作区本轮推荐方案
// @test ../../__tests__/desktop-room-workspace.test.ts

import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import type { RoomMemberView } from '../rooms/types'
import type { ChatScrollPosition } from '../chat/utils/scrollPositionStorage'
import { desktopShellWindowState } from '../desktop-shell/desktopShellWindowState'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import {
  DESKTOP_ROOM_HEADER_HEIGHT,
  getDesktopRoomPrivateCandidate,
  getDesktopRoomSurfaceState,
  getDesktopRoomWorkspaceMode,
  resolveDesktopRoomAgentSession,
  nextDesktopRoomAgentMenuIndex,
} from './desktopRoomWorkspaceLayout'

export type DesktopRoomWorkspaceAgent = {
  membershipId: string
  agentIdentityId: string
  sessionId: string
  name: string
  avatar: RoomMemberView['avatar']
  ownerAvatar: RoomMemberView['ownerAvatar']
  ownerDisplayName?: string | null
}

export type DesktopRoomAgentViewport = {
  active: boolean
  initialScrollPosition: ChatScrollPosition | null
  onScrollPositionChange: (position: ChatScrollPosition) => void
}

export function DesktopRoomWorkspace({
  viewportWidth,
  singlePane = false,
  roomHeader,
  roomTitle,
  roomStream,
  agents,
  activeSessionId,
  onSelectSurface,
  onOpenRoomDetails,
  onOpenAgentDetails,
  agentDetailsButtonRef,
  renderAgentStream,
}: {
  viewportWidth: number
  singlePane?: boolean
  roomTitle: string
  roomHeader: ReactNode
  roomStream: ReactNode
  agents: DesktopRoomWorkspaceAgent[]
  activeSessionId: string | null
  onSelectSurface: (sessionId: string | null) => void
  onOpenRoomDetails: () => void
  onOpenAgentDetails: () => void
  agentDetailsButtonRef?: RefObject<View | null>
  renderAgentStream: (
    agent: DesktopRoomWorkspaceAgent,
    viewport: DesktopRoomAgentViewport,
  ) => ReactNode
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const lastPrivateSessionIdRef = useRef<string | null>(activeSessionId)
  const sessionIds = agents.map((agent) => agent.sessionId)
  const selectedSessionId = resolveDesktopRoomAgentSession(sessionIds, activeSessionId)
  if (selectedSessionId) lastPrivateSessionIdRef.current = selectedSessionId
  const privateCandidateSessionId = getDesktopRoomPrivateCandidate(
    sessionIds,
    lastPrivateSessionIdRef.current,
  )
  const activeAgent = agents.find((agent) => agent.sessionId === selectedSessionId) ?? null
  const mode = singlePane ? 'single' : getDesktopRoomWorkspaceMode(viewportWidth, agents.length > 0)
  const splitWidth = useDesktopSplitWidth(accountId, 'roomSplitWidth', viewportWidth)
  const split = mode === 'split'
  const privatePaneSelected = selectedSessionId !== null
  const surfaceState = getDesktopRoomSurfaceState(mode, privatePaneSelected)
  const selectPrivatePane = () => {
    if (privateCandidateSessionId) onSelectSurface(privateCandidateSessionId)
  }

  const agentHeader = (
    <View {...{dataSet: {desktopDrag: 'true'}}} style={[styles.agentHeader, {borderBottomColor: colors.border}]}>
      <View testID="desktop-room-agent-tabs" role="tablist" {...{onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
        const next = nextDesktopRoomAgentMenuIndex(event.key, items.indexOf(document.activeElement as HTMLElement), items.length)
        if (next === null) return
        event.preventDefault()
        event.stopPropagation()
        items[next]?.focus()
      }}} style={{flexDirection: 'row', flexShrink: 1, gap: 6, paddingHorizontal: 6, paddingVertical: 7, alignItems: 'center'}}>
        {!split ? <Pressable testID="desktop-room-public-pane" accessibilityRole="tab"
          accessibilityLabel={roomTitle} aria-selected={!privatePaneSelected}
          onPress={() => onSelectSurface(null)}
          style={[styles.agentSelector, !privatePaneSelected && {backgroundColor: colors.bg, borderColor: colors.border, boxShadow: '0 1px 4px rgba(0,0,0,0.14)'}]}>
          <Ionicons name="chatbubbles-outline" size={22} color={colors.brand} />
          {!privatePaneSelected ? <Text numberOfLines={1} style={[styles.agentName, {color: colors.text}]}>{roomTitle}</Text> : null}
        </Pressable> : null}
        {agents.map(agent => <Pressable key={agent.sessionId} accessibilityRole="tab" accessibilityLabel={agent.name}
          {...{title: agent.name}} aria-selected={agent.sessionId === selectedSessionId}
          onPress={() => onSelectSurface(agent.sessionId)}
          style={[styles.agentSelector, {paddingHorizontal: 8}, agent.sessionId === selectedSessionId && {backgroundColor: colors.bg, borderColor: colors.border, boxShadow: '0 1px 4px rgba(0,0,0,0.14)'}]}>
          <RoomIdentityAvatar name={agent.name} avatar={agent.avatar} agent ownerAvatar={agent.ownerAvatar} ownerName={agent.ownerDisplayName} size={24} />
          {agent.sessionId === selectedSessionId ? <Text numberOfLines={1} style={[styles.agentName, {color: colors.text}]}>{agent.name}</Text> : null}
        </Pressable>)}
      </View>
      <View style={{flex: 1}} />
      <Pressable ref={agentDetailsButtonRef} accessibilityRole="button" accessibilityLabel={t('more')}
        onPress={!split && !privatePaneSelected ? onOpenRoomDetails : activeAgent ? onOpenAgentDetails : onOpenRoomDetails}
        style={styles.agentSettings}>
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  )

  return (
    <View testID="room-workspace-desktop" style={styles.root}>
      <View
        {...{ dataSet: { desktopDrag: 'true' } }}
        style={[styles.headerRow, { borderBottomColor: colors.border }]}
      >
        <View style={[styles.roomHeader, split && {flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: splitWidth.width}]}>
          {!split ? agentHeader : roomHeader}
        </View>
        {split ? (
          <View style={[styles.agentHeaderSlot, { borderLeftColor: colors.border }]}>
            {agentHeader}
          </View>
        ) : null}

      </View>

      {split ? <DesktopSplitResizeHandle key={accountId} {...splitWidth} /> : null}
      <View style={[styles.body, split && styles.splitBody]}>
        <View
          testID="desktop-room-public-surface"
          accessibilityElementsHidden={!surfaceState.publicVisible}
          importantForAccessibility={!surfaceState.publicVisible ? 'no-hide-descendants' : 'auto'}
          style={[styles.roomColumn, split && {flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: splitWidth.width}, !surfaceState.publicVisible && styles.hiddenSurface]}
        >
          <View style={styles.stream}>{roomStream}</View>
        </View>

        <View
          testID="desktop-room-private-surface"
          accessibilityElementsHidden={!surfaceState.privateVisible}
          importantForAccessibility={!surfaceState.privateVisible ? 'no-hide-descendants' : 'auto'}
          style={[
            styles.agentColumn,
            { borderLeftColor: colors.border },
            split ? styles.splitAgentColumn : !surfaceState.privateVisible && styles.hiddenSurface,
          ]}
        >
          <View style={styles.stream}>
            {activeAgent ? (
              renderAgentStream(activeAgent, {
                active: surfaceState.privateActive,
                initialScrollPosition: desktopShellWindowState.getReadingPosition(accountId, {
                  kind: 'session',
                  id: activeAgent.sessionId,
                }),
                onScrollPositionChange: (position) => {
                  desktopShellWindowState.setReadingPosition(
                    accountId,
                    { kind: 'session', id: activeAgent.sessionId },
                    position,
                  )
                },
              })
            ) : (
              <DesktopRoomEmptyAgentPanel
                hasAgents={agents.length > 0}
                onChooseAgent={selectPrivatePane}
                onOpenRoomDetails={onOpenRoomDetails}
              />
            )}
          </View>
        </View>
      </View>
    </View>
  )
}

function DesktopRoomEmptyAgentPanel({
  hasAgents,
  onChooseAgent,
  onOpenRoomDetails,
}: {
  hasAgents: boolean
  onChooseAgent(): void
  onOpenRoomDetails(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={styles.emptyAgentPanel}>
      <Ionicons name="sparkles-outline" size={30} color={colors.textTertiary} />
      <Text style={[styles.emptyAgentText, { color: colors.textSecondary }]}>
        {t(hasAgents ? 'room_workspace_choose_agent' : 'room_workspace_no_agents')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(hasAgents ? 'spaces_my_agents' : 'spaces_details_accessibility')}
        onPress={hasAgents ? onChooseAgent : onOpenRoomDetails}
        style={({ pressed }) => [
          styles.emptyAgentAction,
          { backgroundColor: pressed ? colors.surfaceHover : colors.brandLight },
        ]}
      >
        <Text style={[styles.emptyAgentActionText, { color: colors.brand }]}>
          {t(hasAgents ? 'spaces_my_agents' : 'spaces_details_accessibility')}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  headerRow: {
    height: DESKTOP_ROOM_HEADER_HEIGHT,
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  roomHeader: { flex: 1, minWidth: 0 },
  agentHeaderSlot: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, minHeight: 0 },
  splitBody: { flexDirection: 'row' },
  roomColumn: { flex: 1, minWidth: 0 },
  agentColumn: { flex: 1, minWidth: 0 },
  splitAgentColumn: {
    minWidth: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  agentHeader: {
    position: 'relative',
    zIndex: 5,
    height: DESKTOP_ROOM_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  agentSelector: {
    flexShrink: 1,
    minWidth: 0,
    height: 30,
    maxWidth: 260,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  agentName: { flexShrink: 1, minWidth: 0, ...desktopTypography.windowTitle },
  agentSettings: {
    width: DESKTOP_ROOM_HEADER_HEIGHT,
    height: DESKTOP_ROOM_HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stream: { flex: 1, minHeight: 0 },
  emptyAgentPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  emptyAgentText: { maxWidth: 280, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyAgentAction: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 9,
    justifyContent: 'center',
  },
  emptyAgentActionText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  hidden: { display: 'none' },
  hiddenSurface: { display: 'none' },
})
