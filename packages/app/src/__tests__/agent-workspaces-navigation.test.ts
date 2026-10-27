// @covers packages/app/app/(main)/agents/index.tsx
// @covers packages/app/app/(main)/agents/[agentId]/index.tsx
// @covers packages/app/src/features/agents/screens/AgentEditScreen.tsx
// @covers packages/app/app/(main)/_layout.tsx
// @covers packages/app/src/components/MobileRootTabBar.tsx

import { readI18nSource } from './i18n-source-test-helper'
import { describe, expect, it } from 'vitest'
import { filterProjectSessions, groupSessionsIntoProjects } from '@shennian/shared'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentWorkspaceSession, Machine, NianSession, RoomActivationMode } from '@shennian/wire'
import { resolveAgentCreationAvailability } from '../features/agents/agentCreationAvailability'
import {
  formatAgentRoomParticipationCompact,
  getAgentRoomParticipationSummary,
} from '../features/agents/agentRoomParticipationSummary'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

function machine(input: Partial<Machine> & Pick<Machine, 'id'>): Machine {
  return {
    name: input.id,
    os: 'darwin',
    agentList: [],
    paired: true,
    online: true,
    lastSeen: new Date(0).toISOString(),
    ...input,
    id: input.id,
  }
}

describe('Agent workspace navigation', () => {
  it('separates participating groups from paused and recoverable relationships', () => {
    const session = (
      status: string,
      activationMode: RoomActivationMode,
    ): Pick<AgentWorkspaceSession, 'room'> => ({
      room: {
        bindingId: `${status}-${activationMode}`,
        status,
        roomId: `${status}-${activationMode}`,
        roomName: status,
        activationMode,
      },
    })

    expect(
      getAgentRoomParticipationSummary([
        session('active', 'auto_follow'),
        session('active', 'mention_only'),
        session('paused', 'paused'),
        session('detached', 'auto_follow'),
        session('pending_approval', 'auto_follow'),
        { room: null },
      ]),
    ).toEqual({ active: 3, total: 4 })
    expect(getAgentRoomParticipationSummary([])).toEqual({ active: 0, total: 0 })
  })

  it('keeps healthy group counts compact and reveals paused relationships as a ratio', () => {
    expect(formatAgentRoomParticipationCompact({ active: 4, total: 4 })).toBe('4')
    expect(formatAgentRoomParticipationCompact({ active: 2, total: 4 })).toBe('2/4')
    expect(formatAgentRoomParticipationCompact({ active: 0, total: 4 })).toBe('0/4')
    expect(formatAgentRoomParticipationCompact({ active: 0, total: 0 })).toBe('0')
  })

  it('routes the empty state to the only currently valid setup action', () => {
    expect(resolveAgentCreationAvailability([])).toEqual({ state: 'no-machines' })
    expect(
      resolveAgentCreationAvailability([
        machine({ id: 'one', online: false, agentList: ['codex'] }),
      ]),
    ).toEqual({ state: 'unavailable', machineId: 'one' })
    expect(resolveAgentCreationAvailability([machine({ id: 'one', agentList: [] })])).toEqual({
      state: 'unavailable',
      machineId: 'one',
    })
    expect(
      resolveAgentCreationAvailability([
        machine({ id: 'shared', role: 'granted', permission: 'full', agentList: ['codex'] }),
      ]),
    ).toEqual({ state: 'unavailable', machineId: undefined })
    expect(
      resolveAgentCreationAvailability([machine({ id: 'one', agentList: ['codex'] })]),
    ).toEqual({ state: 'available' })
  })

  it('emphasizes agent list names without changing their reading size', () => {
    const list = read('../../app/(main)/agents/index.tsx')
    expect(list).toContain('name: { flex: 1, minWidth: 0, ...mobileTypography.listTitle }')
    expect(list).toContain(
      'style={[styles.name, { color: unavailable ? colors.textSecondary : colors.text }]}',
    )
  })

  it('aligns embedded room titles and previews with the mobile group list', () => {
    const detail = read('../../app/(main)/agents/[agentId]/index.tsx')
    expect(detail).toContain('testID={`agent-participation-${roomId}`}')
    expect(detail).toContain("pathname: '/(main)/room-workspace', params: { roomId }")
    expect(detail).toContain('RoomGroupAvatar members={room?.avatarMembers ?? []}')
    const row = read('../features/agents/AgentParticipationRoomRow.tsx')
    expect(row).toContain(': mobileTypography.listTitle)')
    expect(row).toContain(': mobileTypography.secondary)')
    expect(row).toContain(': mobileTypography.metadata)')
    expect(row).toContain("Platform.OS === 'web' ? colors.textSecondary : colors.textMuted")
    expect(row).toContain("Platform.OS === 'web' ? colors.textTertiary : colors.textMuted")
    expect(row).toContain('numberOfLines={1}')
    expect(read('../features/agents/AgentParticipationRoomRow.tsx')).toContain(
      "fontSize: 17, lineHeight: 22, fontWeight: '400'",
    )
    expect(read('../features/agents/AgentOverview.tsx')).toContain(
      "...(Platform.OS !== 'web' && mobileTypography.listTitle)",
    )
    expect(detail).not.toContain('sessionInactive ? colors.textTertiary')
  })

  it('uses fixed root tabs while Agent pages remain reachable', () => {
    const tabs = read('../components/MobileRootTabBar.tsx')
    const list = read('../../app/(main)/agents/index.tsx')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    expect(read('../components/mobileRootTabNavigation.ts')).toContain(
      'MobileRootTab',
    )
    expect(read('../components/mobileFeatureRegistry.ts')).toContain("path: '/contacts'")
    expect(read('../components/mobileFeatureRegistry.ts')).toContain("icon: 'person-outline'")
    expect(tabs).not.toContain("key: 'shennian'")
    expect(tabs).not.toContain("href: '/(main)/agents'")
    expect(tabs).not.toContain("icon: 'terminal-outline'")
    expect(zh).toContain("agents_title: '智能体'")
    expect(zh).toContain("agents_empty: '还没有智能体'")
    expect(zh).toContain("agents_empty_no_machine: '添加机器后才能创建智能体'")
    expect(zh).toContain("agents_empty_unavailable: '机器暂时不能创建智能体'")
    expect(zh).toContain("agents_conversations_title: '对话（{{count}}）'")
    expect(zh).toContain("agents_system_prompt: '提示词'")
    expect(list).not.toContain("t('agents_mine')")
    expect(list).toContain('name="cube-outline" size={40}')
  })

  it('registers the folder-backed Agent detail route with its concrete index screen', () => {
    const layout = read('../../app/(main)/_layout.tsx')
    expect(layout).toContain('name="agents/[agentId]/index"')
    expect(layout).not.toContain('name="agents/[agentId]"')
  })

  it('uses the Agent detail as a compact identity and dedicated conversation index', () => {
    const detail = read('../../app/(main)/agents/[agentId]/index.tsx')
    const settings = read('../features/agents/screens/AgentEditScreen.tsx')
    const overview = read('../features/agents/AgentOverview.tsx')
    const list = read('../../app/(main)/agents/index.tsx')
    expect(detail).toContain('const conversations = agent?.sessions ?? []')
    expect(detail).toContain("t('agents_participating_rooms')")
    expect(detail).toContain("pathname: '/(main)/room-workspace'")
    expect(detail).toContain('scopedAgentSessionId: session.id')
    expect(detail).not.toContain('agentSessionId: session.id')
    expect(detail).toContain("pathname: '/(main)/agents/[agentId]/settings'")
    expect(overview).toContain('<RoomIdentityAvatar')
    expect(overview).toContain('getProjectDirName(agent.workDir)')
    const row = read('../features/agents/AgentParticipationRoomRow.tsx')
    expect(row).toContain('session.room!.roomName || session.title')
    expect(row).toContain('<RoomAgentStatusLabel participation={participation} />')
    expect(row).toContain('disabled={!onPress}')
    expect(row).toContain('<RoomGroupAvatar')
    expect(row).toContain('formatSessionClockTime(message?.createdAt)')
    expect(overview).toContain('numberOfLines={1} ellipsizeMode="tail"')
    expect(overview).toContain('name="chevron-forward"')
    expect(overview).toContain(".join(' · ')")
    expect(detail).not.toContain("t('agents_conversation_ended')")
    expect(list).toContain('isAgentRuntimeOffline(agent.availability)')
    expect(list).toContain('useMachinePresentationState(machineOnline, relayPhase)')
    expect(list).not.toContain("t('machine_not_online_named'")
    expect(list).not.toContain("t('machine_reconnecting')")
    expect(list).not.toContain('availabilityLabel')
    expect(list).not.toContain('AgentConfigurationSummary')
    expect(overview).toContain('agent.description')
    expect(list).toContain('getAgentRoomParticipationSummary(agent.sessions)')
    expect(list).toContain('formatAgentRoomParticipationCompact(participation)')
    expect(list).toContain("t('agents_active_room_count_accessibility'")
    expect(list).toContain("fontVariant: ['tabular-nums']")
    expect(list).toContain('colors.warningText')
    expect(list).toContain("t('spaces_agent_status_accessibility'")
    expect(list).not.toContain('showOfflineDot')
    expect(detail).not.toContain('showOfflineDot')
    expect(detail).not.toContain("t('spaces_agent_status_offline')")
    expect(detail).not.toContain("'spaces_agent_set_runtime'")
    expect(detail).toContain("agent.repairAction === 'retry'")
    expect(overview).toContain('testID="agent-detail-summary"')
    expect(overview).toContain('testID="agent-detail-permission-summary"')
    expect(overview).toContain(
      "resolveManagedAgentPermissionPolicy(agent.permissionPolicy, 'legacy')",
    )
    expect(overview).toMatch(/filter\(Boolean\)\s*\.join\(/)
    expect(list).not.toContain('spaces_agent_status_auto')
    expect(list).not.toContain('spaces_agent_status_mention')
    expect(detail).toContain('accessibilityState={{ busy: repairing, disabled: repairing }}')
    expect(detail).not.toContain('/(main)/chat/${session.id}')
    expect(detail).not.toContain('agent.systemPrompt')
    expect(detail).not.toContain('icon="settings-outline"')
    expect(detail).not.toContain('AGENT_DISPLAY_NAME[session.agentType]')
    expect(detail).not.toContain('AgentWorkspaceForm')
    expect(detail).not.toContain("t('agents_system_prompt')")
    expect(detail).not.toContain('start_new_chat')
    expect(settings).toContain('profileAccessory={')
    expect(settings).toContain('<AgentAvatarEditor')
    expect(settings).toContain('<AgentWorkspaceForm')
    expect(settings).toContain("title={t('agents_edit')}")
    expect(settings).toContain('await editor.save(nextDraft)')
    expect(settings).toContain('testID="agent-delete-action"')
    expect(settings).toContain('deleteAgentWorkspace(accountId, agent)')
    expect(settings).toContain("router.dismissTo('/(main)/contacts')")
    expect(settings).toContain("style: 'destructive'")
    expect(settings).not.toContain("method: 'DELETE'")
  })

  it('anchors short Agent detail content to the top on iOS', () => {
    const detail = read('../../app/(main)/agents/[agentId]/index.tsx')
    expect(detail).toContain('centerContent={false}')
    expect(detail).toContain('automaticallyAdjustContentInsets={false}')
    expect(detail).toContain('contentInsetAdjustmentBehavior="never"')
    expect(detail).toContain(
      "content: { flexGrow: 1, justifyContent: 'flex-start', paddingBottom: 32 }",
    )
  })

  it('keeps create and save header actions on one line under dynamic type', () => {
    const create = read('../features/agents/screens/AgentNewScreen.tsx')
    const settings = read('../features/agents/screens/AgentEditScreen.tsx')

    for (const page of [create, settings]) {
      expect(page).toContain('numberOfLines={1}')
      expect(page).toContain('adjustsFontSizeToFit')
      expect(page).toContain('minimumFontScale={0.8}')
    }

    expect(settings).not.toContain("t('agent_participation_shared_config')")
  })

  it('uses a flat identity list with inherited or custom avatars and no redundant badge', () => {
    const list = read('../../app/(main)/agents/index.tsx')
    expect(list).toContain('avatar={agent.avatar}')
    expect(list).toContain("t('agents_room_count'")
    expect(list).toContain("t('agents_active_room_count_accessibility'")
    expect(list).toContain('styles.titleRow')
    expect(list).not.toContain('agent.description')
    expect(list).not.toContain("t('agents_no_description')")
    expect(list).not.toContain('`${agent.description} · `')
    expect(list).toContain('getPressedSurfaceColor(colors, isDark)')
    expect(list).toContain('getPinnedSurfaceColor(colors, isDark)')
    expect(list).not.toContain('chevron-forward')
    expect(list).not.toContain('agent.machineName')
    expect(list).not.toContain('agent.runtimeAdapter')
    expect(list).toContain("import { Swipeable } from 'react-native-gesture-handler'")
    expect(list).toContain("onLongPress={() => setActionsMode('actions')}")
    expect(list).toContain('<ListItemActionsModal')
    expect(list).toContain("t('agents_pin')")
    expect(list).toContain("t('agents_delete')")
    expect(list).toContain("deleteConfirmTitle={t('agents_delete')}")
    expect(list).toContain("t('agents_delete_named_confirm', { name: agent.displayName })")
    expect(list).toContain('onDelete={() => void remove(agent)}')
    const nativeDelete = read('../features/agents/deleteAgentWorkspace.native.ts')
    expect(read('../features/agents/useAgentListModel.native.ts')).toContain(
      'deleteAgentWorkspace(accountId, agent)',
    )
    expect(nativeDelete.indexOf('agentAccountClient.deleteAgent(agent.id)')).toBeLessThan(
      nativeDelete.indexOf('db.removeAgent(accountId, agent.id)'),
    )
  })

  it('renders a local Agent snapshot immediately and announces only a cold first load', () => {
    const list = read('../../app/(main)/agents/index.tsx')
    const model = read('../features/agents/useAgentListModel.native.ts')
    expect(list).toContain('useAgentListModel()')
    expect(model).toContain('agents: getAgentListSnapshot(accountId) ?? []')
    expect(model).toContain('switchAgentListAccount(')
    expect(model).toContain('applyAgentListResult(current, accountId, cached)')
    expect(model).toContain('setAgentListSnapshot(accountId, nextAgents)')
    expect(model).toMatch(/db\s*\.getAgents\(accountId\)/)
    expect(model).toContain('db.replaceAgents(accountId, nextAgents)')
    expect(model).toContain('useFocusEffect(')
    expect(list).toContain("listUiState === 'initial-loading'")
    expect(list).toContain('<ActivityIndicator')
    expect(list).not.toContain('setLoading(')
  })

  it('refreshes Agent detail on focus without clearing a visible snapshot', () => {
    const detail = read('../features/agents/useAgentDetailModel.native.ts')
    expect(detail).toContain('switchAgentDetailAccount(agentDetail, accountId, agentId).agent')
    expect(detail).toContain('const refresh = useCallback(async () => {')
    expect(detail).toContain('applyAgentDetailResult(current, accountId, agentId, cached)')
    expect(detail).toContain('applyAgentDetailResult(current, accountId, agentId, refreshedAgent)')
    expect(detail).toContain('context.current === scope')
    expect(detail).toContain('useFocusEffect(')
    expect(detail).toContain('db.getAgent(accountId, agentId)')
    expect(detail).toContain('db.upsertAgent(accountId, refreshedAgent)')
    expect(detail).toContain('if (!loadedDetailsRef.current.has(scope)) onUnavailable()')
    expect(detail).toContain('if (!isCurrent()) return')
    expect(detail).not.toContain('setAgent(null)')
  })

  it('links a Project session menu to its owning Agent and Room', () => {
    const item = read('../components/SessionItem.tsx')
    expect(item).toContain('`/(main)/agents/${session.agentIdentityId}`')
    expect(item).toMatch(/roomAccountClient\s*\.getSessionBinding\(session\.id\)/)
    expect(item).toContain('setLinkedRoom(binding)')
    expect(item).toContain('`/spaces/${linkedRoom.room.id}`')
    expect(item).toContain("pathname: '/(main)/room-workspace'")
  })

  it('keeps Agent-owned conversations out of Project indexes while retaining Workers', () => {
    const sidebar = read('../features/desktop-shell/DesktopSidebar.tsx')
    const desktopNavigation = read('../features/projects/utils/desktopProjectNavigation.ts')
    const switcher = read('../components/QuickSwitcherSheet.tsx')

    const base = { machineId: 'machine', userId: 'user', workDir: '/project',
      agentType: 'codex', status: 'active', title: 'Test',
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      lastActivityAt: '2026-10-01T00:00:00Z' } as NianSession
    const sessions = [
      { ...base, id: 'ordinary' },
      { ...base, id: 'managed', agentIdentityId: 'agent' },
      { ...base, id: 'sess_worker_child' },
    ]
    expect(filterProjectSessions(sessions).map(session => session.id)).toEqual(['ordinary', 'sess_worker_child'])
    expect(groupSessionsIntoProjects(sessions)[0].sessionCount).toBe(2)
    expect(read('../features/projects/hooks/useProjectSessions.ts')).toContain('filterProjectSessions(store.sessions).filter')
    expect(desktopNavigation).toContain('for (const session of filterProjectSessions(sessions))')
    expect(sidebar).toContain(
      'shouldEnableProjectSessionShortcuts(pathname, sessionsWithMachineNames)',
    )
    expect(sidebar).toContain("{ key: 'j', ignoreWidgets: true }, projectSessionShortcutsEnabled")
    expect(sidebar).toContain("{ key: 'k', ignoreWidgets: true }, projectSessionShortcutsEnabled")
    expect(sidebar).toMatch(
      /\{ key: 'arrowdown', ignoreWidgets: true \},\s*projectSessionShortcutsEnabled/,
    )
    expect(sidebar).toMatch(
      /\{ key: 'arrowup', ignoreWidgets: true \},\s*projectSessionShortcutsEnabled/,
    )
    expect(switcher).toContain('const projectSessions = filterProjectSessions(sessions)')
  })

  it('keeps Agent workspaces reachable from Contacts without a second identity section', () => {
    const sidebar = read('../features/desktop-shell/DesktopSidebar.tsx')
    const treeModel = read('../components/sidebarTreeModel.ts')
    const contacts = read('../features/desktop-conversations/DesktopContactsScreen.tsx')

    expect(sidebar).toMatch(/useDesktopSidebarWindowState\(\s*user\?\.id/)
    expect(sidebar).toContain('testID="sidebar-open-contacts"')
    expect(sidebar.indexOf('testID="sidebar-open-contacts"')).toBeLessThan(sidebar.indexOf('<DesktopNavigationList'))
    expect(treeModel).not.toContain("key: 'section:agents'")
    expect(contacts).toContain('useDesktopAgentSidebarModel()')
    expect(contacts).toContain('agentWorkspaceId')
    expect(contacts).toContain("router.navigate(`/(main)/agents/${contact.agentWorkspaceId}`")
  })
})
