// @covers packages/app/src/features/rooms/RoomWorkspaceScreen.tsx
// @covers packages/app/src/features/desktop-rooms/DesktopRoomWorkspaceScreen.tsx
// @covers packages/app/src/features/chat/screens/ChatScreen.tsx
// @covers packages/app/app/(main)/agents/[agentId]/index.tsx

import { readChatScreenSource } from './chat-screen-source-test-helper'
import { readI18nSource } from './i18n-source-test-helper'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getRoomWorkspaceHeaderDetailsTarget } from '../features/rooms/roomAgentNavigation'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('Room Workspace', () => {
  it.each([
    { desktop: false, desktopWide: false, activeSessionId: null, expected: 'room' },
    { desktop: false, desktopWide: false, activeSessionId: 'agent-one', expected: 'participation' },
    { desktop: false, desktopWide: false, activeSessionId: 'agent-two', expected: 'participation' },
  ])(
    'opens $expected from the visible surface (desktop=$desktop, wide=$desktopWide, session=$activeSessionId)',
    ({ desktop, desktopWide, activeSessionId, expected }) => {
      // Execute the actual click handler: a target-helper test alone missed the
      // unconditional mobile early return that bypassed the Room destination.
      const workspace = read(
        desktop
          ? '../features/desktop-rooms/DesktopRoomWorkspaceScreen.tsx'
          : '../features/rooms/RoomWorkspaceScreen.tsx',
      )
      const handler = workspace.match(
        /const openCurrentSurfaceDetails = \(\) => \{([\s\S]*?)\n {2}\}/,
      )?.[1]
      expect(handler).toBeTruthy()
      const dismiss = vi.fn()
      const openRoomDetails = vi.fn()
      const setParticipationOpen = vi.fn()
      const openAgentDetails = vi.fn()
      const click = new Function(
        'Keyboard',
        'desktop',
        'headerDetailsTarget',
        'setParticipationOpen',
        'openAgentDetails',
        'openRoomDetails',
        handler!,
      )
      click(
        { dismiss },
        desktop,
        getRoomWorkspaceHeaderDetailsTarget(desktopWide, activeSessionId),
        setParticipationOpen,
        openAgentDetails,
        openRoomDetails,
      )
      expect(dismiss).toHaveBeenCalledOnce()
      expect(openRoomDetails).toHaveBeenCalledTimes(expected === 'room' ? 1 : 0)
      expect(setParticipationOpen).toHaveBeenCalledTimes(expected === 'participation' ? 1 : 0)
      expect(openAgentDetails).toHaveBeenCalledTimes(expected === 'agent' ? 1 : 0)
      if (expected === 'participation') expect(setParticipationOpen).toHaveBeenCalledWith(true)
    },
  )

  it('keeps readable spacing around the Agent name in the private composer', () => {
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    expect(zh).toContain("room_workspace_agent_placeholder: '给 {{agent}} 下达内部指令…'")
  })

  it('shows only the public Room stream, with a separate scoped Agent entry', () => {
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')
    expect(workspace).toContain('testID="room-workspace-mobile"')
    expect(workspace).not.toContain('<WorkspaceSwitcher')
    expect(workspace).toContain('count={room ? members.length : null}')
    expect(workspace).not.toContain('room-workspace-pager')
    expect(workspace).not.toContain('pagingEnabled')
    expect(workspace).not.toContain('<GestureDetector')
    expect(workspace).not.toContain('Gesture.Pan()')
    expect(workspace).toContain('const navigation = useNavigation()')
    expect(workspace).toContain('getRoomWorkspaceBackGestureOptions(Platform.OS, scoped ? activeSessionId : null)')
    expect(workspace).toContain('<RoomConversationScreen')
    expect(workspace).toContain('setWorkspaceFocused(true)')
    expect(workspace).toContain('setWorkspaceFocused(false)')
    expect(workspace).toContain("pathname === '/room-workspace'")
    expect(workspace).toContain('workspaceFocused && pathname ===')
    expect(workspace).toContain('sessionIdOverride={agent.sessionId}')
    expect(workspace).toContain('workspaceRoomId={roomId}')
    expect(workspace).toContain('workspaceAgentIdentityId={agent.agentIdentityId}')
    expect(workspace).toContain("member.agentIdentityId || binding.agentIdentityId || ''")
    expect(workspace).toContain('workspaceAgentAvatar={agent.avatar}')
    expect(workspace).toContain('workspaceAgentOwnerAvatar={agent.ownerAvatar}')
    expect(workspace).toContain('scoped ? (displayedAgent ? renderAgentStream(displayedAgent) : null) : roomStream')
    expect(workspace).toContain('const scoped = Boolean(scopedAgentSessionId || scopedAgentIdentityId)')
    expect(workspace).not.toContain('workspaceRouteActive && activeSessionId === agent.sessionId')
    expect(workspace).toContain('value={workspaceRouteActive && !participationOpen}')
    expect(workspace).toContain('ready && !scoped')
    expect(workspace).toContain(
      'readActive={workspaceRouteActive && !participationOpen}',
    )
    expect(workspace).toContain('if (!workspaceRouteActive) return')
    expect(workspace).not.toContain('getRoomWorkspaceSessionIdAtPage')
    expect(workspace).not.toContain('styles.indicator')
  })

  it('ellipsizes only a long Room name while keeping the member count visible', () => {
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')
    const title = read('../features/rooms/components/RoomHeaderTitle.tsx')

    expect(workspace).toContain('<RoomHeaderTitle')
    expect(workspace).toContain('titleText: { ...mobileTypography.navigationTitle }')
    expect(title).toContain('ellipsizeMode="tail"')
    expect(title).toContain("t('spaces_title_with_count', { name: '', count })")
    expect(title).toContain('name: { minWidth: 0, flexShrink: 1 }')
    expect(title).toContain('suffix: { flexShrink: 0 }')
  })

  it('keeps the native workspace in the main stack while preserving the public Room route', () => {
    const nativeRoute = read('../../app/(main)/room-workspace.tsx')
    const desktopRoute = read('../../app/(main)/room-workspace.web.tsx')
    const publicRoute = read('../../app/spaces/[roomId].tsx')
    const layout = read('../../app/(main)/_layout.tsx')

    expect(nativeRoute).toContain('<RoomWorkspaceScreen')
    expect(desktopRoute).toContain('<DesktopRoomWorkspaceScreen')
    expect(desktopRoute).not.toContain("from '../../src/features/rooms/RoomWorkspaceScreen'")
    expect(publicRoute).toContain("pathname: '/(main)/room-workspace'")
    expect(publicRoute).toContain('<ScopedRoomConversationScreen')
    expect(layout).toContain('name="room-workspace"')
    expect(layout).toContain('getRoomWorkspaceBackGestureOptions(Platform.OS, null)')
  })

  it('refreshes membership in place when the workspace regains focus or receives a Room event', () => {
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')

    expect(workspace).toContain('useFocusEffect(')
    expect(workspace).toContain('preserveContent: hasCurrentRoom')
    expect(workspace).toContain('preserveContent')
    expect(workspace).toContain('subscribeRoomEvents((event) =>')
    expect(workspace).toContain("event.event !== 'room.membership.updated'")
    expect(workspace).toContain("event.event !== 'room.binding.updated'")
  })

  it('restores the workspace from the local Room projection before awaiting the network', () => {
    const workspace = read('../features/rooms/useRoomWorkspaceData.native.ts')
    const localRead = workspace.indexOf('db.getRoomSummaries(currentUserId)')
    const localReady = workspace.indexOf("setLoadState('ready')", localRead)
    const remoteRead = workspace.indexOf('roomAccountClient.getRoom(roomId)', localReady)

    expect(workspace).toContain('getRoomListSnapshot(currentUserId ?? null)')
    expect(workspace).toContain("initialLocalSummary ? 'ready' : 'loading'")
    expect(workspace).toContain('db.getRoomMembers(currentUserId, roomId)')
    expect(localRead).toBeGreaterThan(-1)
    expect(localReady).toBeGreaterThan(localRead)
    expect(remoteRead).toBeGreaterThan(localReady)
    expect(workspace).toContain('if (restoredLocal || preserveContent) return')
    expect(workspace).toContain('db.upsertRoomSummary(currentUserId')
    expect(workspace).toContain('db.replaceRoomMembers(')
  })

  it('renders one stable safe-area and header shell before Room data is ready', () => {
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')
    const safeAreaIndex = workspace.indexOf('<SafeAreaView')
    const loadStateIndex = workspace.indexOf(') : !ready ? (')

    expect(safeAreaIndex).toBeGreaterThan(-1)
    expect(loadStateIndex).toBeGreaterThan(safeAreaIndex)
    expect(workspace).toContain("name={room?.name ?? t('workspace_spaces')}")
    expect(workspace).not.toContain(
      "if (loadState !== 'ready' || !room)\n    return <RoomWorkspaceLoadState",
    )
  })

  it('redirects published AI Rooms before mounting the generic Room composer', () => {
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')
    expect(workspace).toContain("room?.conversationKind === 'published_ai'")
    expect(workspace).toContain("pathname: '/(main)/published-conversations/[conversationId]'")
    expect(workspace).toContain("const ready = loadState === 'ready' && room !== null && !isPublishedAi")
    expect(workspace).toContain('{isPublishedAi ? (')
  })

  it('keeps the Desktop public Room surface separate from the native workspace', () => {
    const workspace = read('../features/desktop-rooms/DesktopRoomWorkspaceScreen.tsx')
    const native = read('../features/rooms/RoomWorkspaceScreen.tsx')
    expect(workspace).toContain('<DesktopRoomPublicConversation')
    expect(workspace).toContain('testID="desktop-room-public-surface"')
    expect(workspace).not.toContain('DesktopRoomWorkspaceMode')
    expect(native).not.toContain('DesktopRoomWorkspace')
    expect(native).not.toContain('isDesktopControlSurfaceEnabled')
    expect(workspace).toContain('height: DESKTOP_ROOM_HEADER_HEIGHT')
  })

  it('redirects old Desktop private-session links to the dedicated work conversation', () => {
    const workspace = read('../features/desktop-rooms/DesktopRoomWorkspaceScreen.tsx')
    expect(workspace).toContain('const privateSessionId = scopedAgentSessionId ?? initialAgentSessionId')
    expect(workspace).toContain("pathname: '/(main)/chat/[sessionId]'")
  })

  it('explains inaccessible Rooms without retaining the previously opened workspace', () => {
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')
    const data = read('../features/rooms/useRoomWorkspaceData.native.ts')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')
    expect(workspace).toContain('useRoomWorkspaceData({ roomId, currentUserId })')
    expect(data).toContain('const unavailable = forbidden || isRoomAccountNotFound(error)')
    expect(data).toContain("setLoadState('unavailable')")
    expect(workspace).toContain("testID={unavailable ? 'room-workspace-unavailable'")
    expect(workspace).toContain(
      "t(unavailable ? 'spaces_unavailable_title' : 'spaces_load_failed')",
    )
    expect(workspace).toContain("t('spaces_unavailable_body')")
    expect(data).toContain('setRoom(null)')
    expect(data).toContain('setMembers([])')
    expect(data).toContain('setMembersLoaded(false)')
    expect(data).toContain('const generation = ++loadGenerationRef.current')
    expect(data).toContain('if (generation !== loadGenerationRef.current) return')
    expect(zh).toContain("spaces_unavailable_title: '无法访问这个群聊'")
    expect(zh).toContain('你可能没有查看权限，或群聊不存在、已被删除。')
    expect(en).toContain("spaces_unavailable_title: 'This group chat is unavailable'")
    expect(en).toContain('You may not have access')
  })

  it('opens active Agent assignments only from the Agent index, not from group settings', () => {
    const detail = read('../../app/(main)/agents/[agentId]/index.tsx')
    const roomAgents = read('../features/rooms/components/RoomMyAgentsPanel.tsx')
    const workSettings = read('../features/rooms/components/RoomAgentWorkSettingsSheet.tsx')
    const chat = readChatScreenSource()
    expect(detail).toContain("pathname: '/(main)/room-workspace'")
    expect(detail).toContain('scopedAgentSessionId: session.id')
    expect(detail).not.toContain('agentSessionId: session.id')
    expect(roomAgents).not.toContain("pathname: '/(main)/spaces/[roomId]' as const")
    expect(roomAgents).not.toContain('agentSessionId: sessionId')
    expect(workSettings).toContain('roomAccountClient.updateAgentMode(')
    expect(chat).not.toContain('<LinkedRoomEntry')
    expect(chat).not.toContain('<RoomConversationScreen')
  })

  it('keeps Desktop Room details on the public conversation', () => {
    const workspace = read('../features/desktop-rooms/DesktopRoomWorkspaceScreen.tsx')
    const chat = readChatScreenSource()
    expect(workspace).toContain('<DesktopRoomDetailsDialog')
    expect(workspace).toContain('setRoomDetailsOpen(true)')
    expect(chat).toContain(
      '!embedded && installAgent && isInstallableBuiltinAgentType(installAgent)',
    )
    expect(chat).not.toContain('sessionDetailsRequestKey')
    expect(chat).not.toContain('performManagedSessionRestart')
    expect(chat).not.toContain('room.agent.restart-managed')
    expect(chat).not.toContain('createRoomSession(agentIdentityId')
    expect(chat).not.toContain('onRestart={workspaceRoomId')
    expect(chat).toContain(
      'const effectiveAgentIdentityId = session?.agentIdentityId || workspaceAgentIdentityId',
    )
    expect(chat).toContain('agentIdentityId={effectiveAgentIdentityId}')
    expect(chat).toContain('<SessionDetailsModal')
    expect(chat).toContain('machineName={machineName}')
    expect(chat).toContain('workDir={workDir}')
    expect(workspace).not.toContain('<RoomAgentWorkSettingsSheet')
  })

  it('keeps a dedicated Agent-index route and public Room route', () => {
    const workspace = read('../features/desktop-rooms/DesktopRoomWorkspaceScreen.tsx')
    const route = read('../../app/(main)/room-workspace.tsx')
    const desktopRoute = read('../../app/(main)/room-workspace.web.tsx')
    expect(route).toContain('scopedAgentSessionId={scopedAgentSessionId}')
    expect(desktopRoute).toContain('scopedAgentSessionId={scopedAgentSessionId}')
    expect(workspace).toContain('const privateSessionId = scopedAgentSessionId ?? initialAgentSessionId')
  })
})
