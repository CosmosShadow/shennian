// @covers packages/app/src/features/rooms/components/RoomRenameModal.tsx
// @covers packages/app/src/features/rooms/components/RoomShareContent.tsx
// @covers packages/app/src/features/rooms/components/ScopedRoomDialogs.tsx
// @covers packages/app/src/features/rooms/RoomSettingsScreen.tsx
// @covers packages/app/src/features/rooms/components/RoomInfoPanel.tsx
// @covers packages/app/src/features/rooms/components/RoomAdminPanel.tsx
// @covers packages/app/src/features/rooms/components/RoomInvitePanel.tsx
// @covers packages/app/src/features/rooms/components/RoomShareLink.tsx
// @covers packages/app/src/features/rooms/components/RoomInviteQr.tsx
// @covers packages/app/src/features/rooms/components/roomInviteQrTitle.ts
// @covers packages/app/src/features/rooms/components/RoomMyAgentsPanel.tsx
// @covers packages/app/src/features/rooms/components/RoomAgentWorkSettingsSheet.tsx
// @covers packages/app/src/features/rooms/components/RoomMembersPanel.tsx
// @covers packages/app/src/features/rooms/components/RoomMemberRemovalConfirmModal.tsx
// @covers packages/app/src/features/rooms/components/RoomBrowserLoginModal.tsx
// @covers packages/app/src/components/BottomSheet.tsx

import { readI18nSource } from './i18n-source-test-helper'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import enTranslations from '../../../../open-source/packages/shared/src/i18n/en'
import zhTranslations from '../../../../open-source/packages/shared/src/i18n/zh'
import { fitInviteQrTitle } from '../features/rooms/components/roomInviteQrTitle'
import {
  roomNotificationModeFromPreferences,
  roomNotificationPreferencesForMode,
} from '../features/rooms/roomNotificationPreference'

function read(path: string) {
  return readFileSync(resolve(__dirname, path), 'utf8')
}

describe('Room management panel', () => {
  it('uses short member-list states and full owner-facing work-mode copy in both languages', () => {
    const members = read('../features/rooms/components/RoomMembersPanel.tsx')
    const profile = read('../features/rooms/components/RoomMemberProfileSheet.tsx')
    const agents = read('../features/rooms/components/RoomMyAgentsPanel.tsx')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')

    expect(members).toContain('spaces_agent_status_${participation}')
    expect(profile).toContain('spaces_agent_status_full_${participation}')
    expect(profile).toContain("<ProfileField label={t('spaces_agent_work_mode')} value={status} />")
    expect(profile).toContain('style={styles.identityHeader}')
    expect(profile).toContain('size={56}')
    expect(profile).toContain("content: { alignItems: 'stretch'")
    expect(profile).toContain("flexDirection: 'row'")
    expect(profile).toContain('size={32}')
    expect(profile).not.toContain('name="sparkles"')
    expect(profile).not.toContain("t('spaces_agent_description_empty')")
    expect(profile.indexOf("label={t('agents_public_description')}")).toBeLessThan(
      profile.indexOf("<ProfileField label={t('spaces_agent_work_mode')} value={status} />"),
    )
    expect(
      profile.indexOf("<ProfileField label={t('spaces_agent_work_mode')} value={status} />"),
    ).toBeLessThan(profile.indexOf("t('spaces_member_owner')"))
    expect(agents).toContain('spaces_agent_status_full_${participation}')
    expect(zh).toContain("spaces_agent_status_auto: '自动跟进'")
    expect(zh).toContain("spaces_agent_status_mention: '触发响应'")
    expect(zh).toContain("spaces_agent_status_paused: '暂停工作'")
    expect(zh).toContain("spaces_agent_status_full_auto: '自动跟进'")
    expect(zh).toContain("spaces_agent_status_full_mention: '触发响应'")
    expect(zh).toContain("spaces_agent_status_full_offline: '暂时无法工作'")
    expect(zh).toContain("spaces_agent_status_full_paused: '暂停工作'")
    expect(zh).toContain("spaces_agent_work_mode: '群聊工作方式'")
    expect(en).toContain("spaces_agent_status_auto: 'Auto follow'")
    expect(en).toContain("spaces_agent_status_full_auto: 'Auto follow'")
    expect(en).toContain("spaces_agent_status_full_mention: 'Mention to respond'")
    expect(en).toContain("spaces_agent_status_full_offline: 'Temporarily unavailable'")
    expect(en).toContain("spaces_agent_status_full_paused: 'Pause work'")
    expect(en).toContain("spaces_agent_work_mode: 'Group chat work mode'")
  })

  it('exposes management only to the creator-owner and keeps archived Rooms read-only', () => {
    const info = read('../features/rooms/components/RoomInfoPanel.tsx')
    const settings = read('../features/rooms/RoomSettingsScreen.tsx')
    expect(info).toContain("const isOwner = ownHuman?.role === 'owner'")
    expect(info).not.toContain("ownHuman?.role === 'admin'")
    expect(info).toContain('isOwner && !readOnly')
    expect(info).toContain("room.status !== 'active'")
    expect(info).toContain("'spaces_archived_title'")
    expect(info).toContain("'spaces_archived_history_hint'")
    expect(info).not.toContain('name="archive-outline"')
    expect(zhTranslations.spaces_archived_title).toBe('群聊已解散')
    expect(zhTranslations.spaces_archived_history_hint).toBe(
      '你仍可查看聊天记录，但无法再发送消息。',
    )
    expect(enTranslations.spaces_archived_title).toBe('Group chat dissolved')
    expect(enTranslations.spaces_archived_history_hint).toBe(
      'You can still view the chat history, but you can no longer send messages.',
    )
    expect(info).not.toContain('<RoomMemberGrid')
    expect(settings).toContain('isRoomAccountForbidden(error) || isRoomAccountNotFound(error)')
    expect(settings).toContain("testID={unavailable ? 'room-settings-unavailable' : undefined}")
    expect(settings).toContain("t('spaces_unavailable_title')")
    expect(settings).toContain("t('spaces_unavailable_body')")
    expect(settings).toContain("router.replace('/(main)/spaces')")
    expect(info).toContain("t('mobile_manage_conversation')")
    expect(info).toContain('<RoomMyAgentsPanel')
    expect(info).toContain('testID="room-all-members-row"')
    expect(info).not.toContain('testID="room-browser-sessions-row"')
    expect(info).toContain("t('mobile_members_count', { count: visibleMembers.length })")
    expect(info.indexOf('testID="room-all-members-row"')).toBeLessThan(
      info.indexOf('<RoomMyAgentsPanel'),
    )
    expect(info.indexOf('<RoomMyAgentsPanel')).toBeLessThan(
      info.indexOf("t('mobile_manage_conversation')"),
    )
    expect(info).toContain('editable={!readOnly}')
    expect(info).toContain('testID="room-leave-action"')
    expect(info).toContain('testID="room-leave-clear-checkbox"')
    expect(info).toContain('setClearOnLeave(true)')
    expect(info).toContain("accessibilityState={{ checked: clearOnLeave, disabled: recordActionBusy }}")
    expect(info).toContain("runRecordAction(recordAction === 'leave' ? clearOnLeave : true)")
    expect(info).toContain('testID="room-remove-record-action"')
    expect(info).toContain('t(!readOnly')
    expect(info).toContain("? 'spaces_delete_active_record_confirm'")
    expect(info).toContain('roomAccountClient.deleteRoomRecord(roomId)')
  })

  it('unifies native sharing and redirects old computer bookmarks without disabling closed Rooms', () => {
    const settings = read('../features/rooms/RoomSettingsScreen.tsx')
    const info = read('../features/rooms/components/RoomInfoPanel.tsx')
    const details = read('../features/rooms/components/RoomDetailsPanel.tsx')
    const computerRoute = read('../../app/(main)/spaces/open-on-computer.tsx')
    const agents = read('../features/rooms/components/RoomMyAgentsPanel.tsx')
    expect(settings).toContain("pathname: '/(main)/spaces/invite'")
    expect(settings).toContain('onOpenShare={openShare}')
    expect(settings).toContain("t('mobile_invite_conversation')")
    expect(settings).toContain("pathname: '/(main)/spaces/member-add'")
    expect(settings).not.toContain('RoomOpenOnComputerPanel')
    expect(settings).not.toContain('onOpenComputer')
    expect(settings).toContain('onInviteClosed={setRoom}')
    expect(details).toContain('onInviteClosed={onRoomUpdated}')
    expect(details).toContain("onOpenShare={() => onPageChange?.('invite')}")
    expect(computerRoute).toContain('<Redirect')
    expect(computerRoute).toContain("pathname: '/(main)/spaces/invite'")
    expect(info).toContain('testID="room-share-row"')
    expect(info).toContain('onPress={onOpenShare}')
    expect(info).toContain('testID="room-preview-add-member"')
    expect(info).toContain('onPress={onOpenAddMembers}')
    expect(info).toContain("label={t('mobile_invite_conversation')}")
    expect(info).toContain("subtitle={t('mobile_invite_conversation_hint')}")
    expect(info).toContain('ownHuman && !readOnly')
    expect(info).not.toContain('room-invite-members-row')
    expect(info).not.toContain('room-open-on-computer-row')
    expect(info).not.toContain('invitationsClosed')
    expect(info.indexOf('testID="room-share-row"')).toBeLessThan(info.indexOf('<RoomMyAgentsPanel'))
    expect(agents).toContain('testID="room-my-agents-inline"')
    expect(agents).not.toContain('testID="room-add-agent"')
    expect(settings).toContain('useFocusEffect(')
    expect(settings).toContain('backTestID="room-settings-back"')
    expect(settings).toContain("pathname: '/(main)/spaces/members'")
    expect(settings).toContain("pathname: '/(main)/spaces/manage'")
    expect(settings).not.toContain("pathname: '/(main)/spaces/continue'")
    expect(settings).not.toContain("pathname: '/(main)/spaces/browser-sessions'")
    expect(settings).not.toContain("pathname: '/(main)/spaces/agents'")
    expect(settings).not.toContain('testID="room-settings-remove-member"')
    expect(settings).not.toContain('testID="room-add-agent"')
    expect(settings).not.toContain('canManageMembers=')
    expect(settings).not.toContain('onRemoveMember=')
    expect(agents).not.toContain('embedded?: boolean')
    expect(info).not.toContain('canManageMembers')
    expect(info).not.toContain('onRemoveMember')
    expect(info).toContain('testID="room-rename-row"')
    expect(info).toContain('<RoomRenameModal')
    expect(info).not.toContain('testID="room-continue-elsewhere-row"')
    const layout = read('../../app/(main)/_layout.tsx')
    for (const route of [
      'details',
      'manage',
      'members',
      'invite',
      'open-on-computer',
      'agents',
      'agent-add',
      'browser-sessions',
    ]) {
      expect(layout).toContain(`name="spaces/${route}"`)
    }
    expect(layout).not.toContain('name="spaces/continue"')
    const legacyAgentsRoute = read('../../app/(main)/spaces/agents.tsx')
    expect(legacyAgentsRoute).toContain('<Redirect')
    expect(legacyAgentsRoute).toContain("pathname: '/(main)/spaces/details'")
  })

  it('renames only through explicit modal confirmation and preserves failed drafts', () => {
    const info = read('../features/rooms/components/RoomInfoPanel.tsx')
    const modal = read('../features/rooms/components/RoomRenameModal.tsx')
    expect(info).not.toContain('<TextInput')
    expect(info).toContain('editingName && !readOnly')
    expect(modal).not.toContain('onBlur=')
    expect(modal).not.toContain('onSubmitEditing=')
    expect(modal).toContain('if (!next || pending.current) return')
    expect(modal).toContain('onPress={() => void confirm()}')
    expect(modal).toContain('onPress={close}')
    expect(modal).toContain('setFailed(true)')
    expect(modal).not.toContain('setDraft(name)')
    expect(modal).toContain('KeyboardAvoidingView')
    expect(modal).toContain('useWebModalFocus')
  })

  it('shows only active web access in native group details and manages it in place', () => {
    const settings = read('../features/rooms/RoomSettingsScreen.tsx')
    const info = read('../features/rooms/components/RoomInfoPanel.tsx')
    const details = read('../features/rooms/components/RoomDetailsPanel.tsx')
    const modal = read('../features/rooms/components/RoomBrowserLoginModal.tsx')
    const route = read('../../app/(main)/spaces/browser-sessions.tsx')

    expect(settings).not.toContain('onOpenBrowserSessions')
    expect(info).toContain("Platform.OS !== 'web' && ownHuman && roomBrowserAuthorizations.length")
    expect(info).toContain("label={t('spaces_browser_session')}")
    expect(info).toContain("value={t('spaces_browser_session_count'")
    expect(info).not.toContain("'spaces_browser_session_inactive'")
    expect(info).toContain('onPress={() => setBrowserModalOpen(true)}')
    expect(info).toContain('<RoomBrowserLoginModal')
    expect(info).not.toContain("pathname: '/(main)/spaces/browser-sessions'")
    expect(details).not.toContain("pathname: '/(main)/spaces/browser-sessions'")
    expect(details).not.toContain('onOpenBrowserSessions')
    expect(route).toContain("pathname: '/(main)/spaces/details'")
    expect(modal).toContain('roomAccountClient.listBrowserSessions(roomId)')
    expect(modal).toContain('roomAccountClient.revokeBrowserSession(roomId, sessionId)')
    expect(modal).toContain('Promise.all')
    expect(modal).toContain("t('spaces_browser_login_started'")
    expect(modal).toContain("t('spaces_browser_login_auto_logout'")
    expect(modal).toContain("t('spaces_browser_session_last_active'")
    expect(modal).toContain("t('spaces_browser_session_revoke_all')")
    expect(modal).toContain('onPress={() => void revoke([session])}')
    expect(modal).toContain('Alert.alert')
    expect(modal).not.toContain('tokenHash')
    expect(modal).not.toContain('accessToken')
  })

  it('selects a stable Agent and creates a fresh conversation for the Room', () => {
    const add = read('../features/rooms/screens/RoomAgentAddScreen.tsx')
    expect(add).toContain('agentAccountClient.listAgents()')
    expect(add).toContain('roomAccountClient.listMembers(roomId)')
    expect(add).not.toContain('authApi')
    expect(add).not.toContain('/agent-invite-link')
    expect(add).toContain('const addLock = useRef(false)')
    expect(add).toContain('if (addLock.current) return')
    expect(add).toContain('assignmentIntentIds.current.get(agent.id)')
    expect(add).toContain('agentAccountClient.createRoomSession(agent.id, assignmentIntentId)')
    expect(add).toContain('accountRuntime.requestMachine(')
    expect(add).toContain('accountRuntime.getConnectivitySnapshot()')
    expect(add).not.toContain("method: 'chat.send'")
    expect(add).not.toContain('MANAGED_AGENT_BOOTSTRAP_TEXT')
    expect(add).not.toContain("t('spaces_agent_join_configured_prompt'")
    expect(add).toContain("'room.agent.bind-managed'")
    expect(add).toContain('agentIdentityId: agent.id')
    expect(add).toContain('nianSessionId: session.id')
    expect(add).toContain('activationMode,')
    expect(add).toContain('assignmentIntentId,')
    expect(add).toContain('agentType: session.agentType')
    expect(add).toContain('activationMode,')
    expect(add).toContain(
      "const WORK_MODES: RoomActivationMode[] = ['auto_follow', 'mention_only', 'paused']",
    )
    expect(add).toContain("activationModes[agent.id] ?? 'auto_follow'")
    expect(add).toContain('testID={`room-agent-work-mode-${agent.id}`}')
    expect(add).toContain('ActionSheetIOS.showActionSheetWithOptions(')
    expect(add).not.toContain('<AgentConfigurationSummary')
    expect(add).not.toContain(': agent.description')
    expect(add).toContain('isExpectedManagedRoomBinding(bindResponse.payload, {')
    expect(add).toContain('agentIdentityId: agent.id')
    expect(add).toContain('nianSessionId: session.id')
    expect(add).not.toContain('/rooms/session/${encodeURIComponent(sessionId)}/binding')
    expect(add).not.toContain("pathname: '/(main)/spaces/agents'")
    expect(add).toContain('router.canGoBack()')
    expect(add).toContain('router.back()')
    expect(add).toContain("pathname: '/(main)/spaces/details'")
    expect(add).toContain('params: { roomId }')
    expect(add).not.toContain("pathname: '/(main)/chat/[sessionId]'")
    expect(add).not.toContain('roomInviteUrl:')
    expect(add).toContain('testID="room-create-agent"')
    expect(add).toContain("pathname: '/(main)/agents/new'")
    expect(add).toContain("params: { returnTo: 'room-agent-add', roomId }")
    expect(add).toContain("createdAgentId = ''")
    expect(add).toContain('agent.id === createdAgentId')
    expect(add).toContain('getAddedRoomAgentIds(agents, members, roomId, addedIds)')
    expect(add).toContain('agents.map((agent) => {')
    expect(add).toContain('disabled={already || busy !== null}')
    expect(add).toContain("'agents_room_existing'")
    expect(add).toContain("t('agents_room_add_empty')")
    expect(add).toContain('testID="room-add-agents-submit"')
    expect(add).not.toContain("t('agents_room_add_hint')")
    expect(add).not.toContain("t('spaces_agent_add_work_mode_hint')")
    expect(add).not.toContain("t('agents_no_description')")
    expect(add).toContain('testID="room-add-agent-risk-note"')
    expect(add).toContain("t('agents_room_risk_note')")
    expect(add).toContain("name={already || selected ? 'checkmark-circle' : 'ellipse-outline'}")
    expect(add).toContain("t('agents_room_select_prompt')")
    expect(add).toContain("t('agents_room_add_selected', { count: pendingAgents.length })")
    expect(add).toContain('submitRoomAgentSelection(pendingAgents, add)')
    expect(add).toContain('onPress={() => toggle(agent)}')
    expect(add).toContain('testID="room-add-agent-error"')
    expect(add).not.toContain('room-add-agent-capacity-limit')
    expect(add).not.toContain('getRoomAgentCapacity')
    expect(add).toContain('testID="room-add-agent-retry"')
    expect(add).toContain("connectivityUnavailable ? 'connectivity' : 'add'")
    expect(add).toContain("'relay_agent_init_unavailable'")
    expect(add).toContain("'spaces_add_agent_failed'")
    expect(add).toContain("'spaces_agents_load_failed'")
    expect(add).not.toContain('reason instanceof Error ? reason.message : String(reason)')
    expect(add).not.toContain('{error}</Text>')
    expect(add).not.toContain("t('spaces_manage_action_failed')")
    expect(add).not.toContain('style={[s.create')

    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')
    expect(zh).toContain("agents_room_add_empty: '暂无智能体，请先到智能体页创建'")
    expect(en).toContain(
      "agents_room_add_empty: 'No Agents yet. Create one from the Agents tab first.'",
    )
    expect(zh).toContain("agents_room_add_all_added: '所有智能体都已加入该群聊'")
    expect(en).toContain("agents_room_add_all_added: 'All Agents are already in this group chat'")
  })

  it('keeps own Agent relationship and work mode management inside the group', () => {
    const info = read('../features/rooms/components/RoomInfoPanel.tsx')
    const agents = read('../features/rooms/components/RoomMyAgentsPanel.tsx')
    const settingsSheet = read('../features/rooms/components/RoomAgentWorkSettingsSheet.tsx')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')
    expect(info).toContain('<RoomMyAgentsPanel')
    expect(info).not.toContain('onOpenAgents')
    expect(info).not.toContain("pathname: '/(main)/spaces/agents'")
    expect(agents).toContain(
      "member.principalType === 'agent' && member.ownerUserId === currentUserId",
    )
    expect(agents).toContain("Platform.OS === 'web' ? 'spaces_my_agents' : 'mobile_my_ai'")
    expect(agents).not.toContain("t('spaces_title_with_count'")
    expect(agents).not.toContain('linkedAgentSessionId')
    expect(agents).not.toContain("pathname: '/(main)/spaces/[roomId]' as const")
    expect(agents).not.toContain('lastMessagePreview')
    expect(agents).toContain('chevron-forward')
    expect(agents).not.toContain('const MODES: RoomActivationMode[]')
    expect(settingsSheet).toContain('const MODES: RoomActivationMode[]')
    expect(settingsSheet).toContain(
      'roomAccountClient.updateAgentMode(roomId, agent.id, { activationMode })',
    )
    expect(settingsSheet).toContain('spaces_agent_mode_${mode}')
    expect(settingsSheet).not.toContain('spaces_agent_mode_${mode}_description')
    expect(settingsSheet).toContain('preferDialogOnWeb')
    expect(agents).not.toContain('agent.description')
    expect(agents).toContain('getRoomMemberParticipation(agent)')
    expect(agents).toContain('spaces_agent_status_full_${participation}')
    expect(agents).toContain('offline={offline}')
    expect(settingsSheet).toContain('isRoomAgentIdentityDimmed(getRoomMemberParticipation(agent))')
    expect(settingsSheet).toContain('canChangeRoomAgentMode(agent, userId)')
    expect(settingsSheet).toContain('accessibilityRole="radio"')
    expect(settingsSheet).toContain('checked: selected')
    expect(settingsSheet).not.toContain('spaces_agent_status_full_offline')
    expect(settingsSheet).not.toContain('spaces_agent_set_runtime')
    expect(settingsSheet).not.toContain('spaces_agent_retry_recovery')
    expect(agents).not.toContain('styles.description')
    expect(agents).toContain(
      'await removeRoomAgent({ accountId: currentUserId, roomId, membershipId: agent.id,',
    )
    expect(agents).not.toContain('db.')
    expect(agents).not.toContain('authApi')
    expect(agents).toContain('<RoomMemberRemovalConfirmModal')
    expect(agents).toContain('const [removalTarget, setRemovalTarget]')
    expect(agents).toContain('onRemove={() => requestRemove(agent)}')
    expect(agents).toContain('onConfirm={() => void confirmRemove()}')
    expect(agents).toContain(
      'onMembersUpdated(current.current.members.filter((member) => member.id !== agent.id))',
    )
    expect(agents).not.toContain('onMembersUpdated(previousMembers)')
    expect(agents).toContain('testID={`room-remove-own-agent-${agent.id}`}')
    expect(agents).toContain("import { Swipeable } from 'react-native-gesture-handler'")
    expect(agents).toContain("Platform.OS === 'web'")
    expect(agents).not.toContain('testID={`room-agent-menu-${agent.id}`}')
    expect(agents).toContain('renderRightActions={renderRightActions}')
    expect(settingsSheet).toContain('testID={`room-agent-settings-remove-${agent.id}`}')
    expect(settingsSheet).not.toContain("t('spaces_remove_agent_hint')")
    expect(settingsSheet).toContain('size={34}')
    expect(settingsSheet).toContain("t('spaces_agent_work_mode')")
    expect(settingsSheet).not.toContain('spaces_agent_room_settings')
    expect(settingsSheet).toContain("alignSelf: 'center'")
    expect(settingsSheet).not.toContain('borderColor: colors.error')
    expect(agents).toContain("t('spaces_remove_own_agent')")
    expect(zh).toContain("spaces_agent_remove_confirm_title: '让“{{name}}”退出本群？'")
    expect(zh).not.toContain('本群专用的内部对话将被清理')
    expect(en).toContain("spaces_agent_remove_confirm_title: 'Remove “{{name}}” from this group?'")
    expect(en).not.toContain('Its internal conversation for this group will be deleted.')
  })

  it('supports an identity header without changing existing bottom sheet titles', () => {
    const bottomSheet = read('../components/BottomSheet.tsx')
    expect(bottomSheet).toContain('headerTitle?: ReactNode')
    expect(bottomSheet).toContain('headerTitle ??')
    expect(bottomSheet).toContain('<Text style={[styles.title, ds.title]}>{title}</Text>')
    expect(bottomSheet).toContain('accessibilityViewIsModal')
    expect(bottomSheet).toContain("accessibilityLabel={t('close')}")
    expect(bottomSheet).toContain('useWebModalFocus({')
    expect(bottomSheet).toContain('containerRef: sheetRef')
    expect(bottomSheet).toContain('initialFocusRef: closeButtonRef')
    expect(bottomSheet).toContain("if (Platform.OS !== 'web')")
    expect(bottomSheet).toContain(
      "presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}",
    )
    expect(bottomSheet).toContain('automaticallyAdjustKeyboardInsets={avoidKeyboard}')
  })

  it('keeps member directories informational instead of duplicating Agent chat entry points', () => {
    const grid = read('../features/rooms/components/RoomMemberGrid.tsx')
    const members = read('../features/rooms/components/RoomMembersPanel.tsx')
    const removal = read('../features/rooms/components/RoomMemberRemovalConfirmModal.tsx')
    expect(grid).not.toContain('linkedAgentSessionId')
    expect(grid).not.toContain('room-own-agent-')
    expect(grid).not.toContain('/(main)/chat/')
    expect(members).not.toContain('linkedAgentSessionId')
    expect(members).not.toContain('room-own-agent-')
    expect(members).not.toContain('/(main)/chat/')
    expect(members).toContain('styles.agentBranch')
    expect(members).toContain('styles.branchLine')
    expect(members).toContain('<RoomMemberProfileSheet')
    expect(members).not.toContain("t('spaces_agent_count'")
    expect(members).not.toContain('chevron-forward')
    expect(members).toContain('<RoomMemberRemovalConfirmModal')
    expect(members).not.toContain('Alert.alert')
    expect(removal).toContain("t('spaces_agent_remove_confirm_title'")
    expect(removal).toContain("Platform.OS !== 'web'")
    expect(removal).toContain('Alert.alert(')
    expect(removal).toContain("style: 'cancel'")
    expect(removal).toContain("style: 'destructive'")
    expect(removal).toContain('<Modal')
    expect(removal).toContain("t('spaces_member_remove_action')")
    expect(members).not.toContain("t('spaces_agent_owned_by'")
    expect(members).not.toContain('styles.agentBadge')
    expect(members).not.toContain("t('spaces_me')")
    expect(members).toContain("t('spaces_role_admin')")
    expect(members).not.toContain('agent.description')
    expect(members).not.toContain('styles.description')
    expect(members).toContain(
      "name: { fontSize: 16, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.listTitle) }",
    )
    expect(members).toContain(
      "agentName: { fontSize: 16, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.listTitle) }",
    )
  })

  it('nests native Agent rows under their human owner with a half-avatar indent', () => {
    const members = read('../features/rooms/components/RoomMembersPanel.tsx')
    expect(members).toContain('filterRoomMemberGroups(orderedGroups, query)')
    expect(members).toContain('all.push({ member: group.human, isAgent: false })')
    expect(members).toContain('all.push(...group.agents.map((member) => ({ member, isAgent: true })))')
    expect(members).toContain('agent && styles.nativeAgentIndent')
    expect(members).toContain('nativeAgentIndent: { marginLeft: 22 }')
  })

  it('uses an explicit owner-only member removal mode and blocks direct management access', () => {
    const settings = read('../features/rooms/RoomSettingsScreen.tsx')
    const members = read('../features/rooms/components/RoomMembersPanel.tsx')
    expect(members).toContain('testID="room-members-manage-toggle"')
    expect(settings).toContain('onToggleManage={() => setRemovingMembers(true)}')
    expect(settings).toContain('canManage={isOwner && removingMembers}')
    expect(settings).toContain("accessibilityLabel={t('done')}")
    expect(settings).toContain("label={t('mobile_add_members')}")
    expect(settings).toContain("page === 'manage' && !isOwner")
    expect(settings).toContain('testID="room-management-owner-only"')
    expect(settings).toContain("t('spaces_owner_only_management')")
  })

  it('shows one bottom notification row with an atomically persisted three-state picker', () => {
    const info = read('../features/rooms/components/RoomInfoPanel.tsx')
    expect(info).toContain('testID="room-notification-preference"')
    expect(info).not.toContain('testID="room-mute-regular-notifications"')
    expect(info).not.toContain('testID="room-mute-mention-notifications"')
    expect(info).toContain('ROOM_NOTIFICATION_MODES.map((mode) =>')
    expect(info).toContain('roomNotificationPreferencesForMode(mode)')
    expect(info).toContain('roomAccountClient.updateNotificationPreferences(roomId, next)')
    expect(info.indexOf('testID="room-notification-preference"')).toBeGreaterThan(
      info.indexOf('<RoomMyAgentsPanel'),
    )
    expect(info.indexOf('testID="room-notification-preference"')).toBeGreaterThan(
      info.indexOf('testID="room-all-members-row"'),
    )
    expect(info.indexOf('testID="room-notification-preference"')).toBeGreaterThan(
      info.indexOf('testID="room-browser-access-row"'),
    )
    expect(zhTranslations.spaces_notification_mode_all).toBe('接收全部消息')
    expect(zhTranslations.spaces_notification_mode_mentions).toBe('仅接收 @ 消息')
    expect(zhTranslations.spaces_notification_mode_none).toBe('不接收任何消息')
    expect(enTranslations.spaces_notification_mode_all).toBe('All messages')
    expect(enTranslations.spaces_notification_mode_mentions).toBe('Only @ messages')
    expect(enTranslations.spaces_notification_mode_none).toBe('No messages')
  })

  it.each([
    [{ muteRegularNotifications: false, muteMentionNotifications: false }, 'all'],
    [{ muteRegularNotifications: true, muteMentionNotifications: false }, 'mentions'],
    [{ muteRegularNotifications: true, muteMentionNotifications: true }, 'none'],
  ] as const)('maps a supported notification preference pair to %s', (preferences, mode) => {
    expect(roomNotificationModeFromPreferences(preferences)).toBe(mode)
    expect(roomNotificationPreferencesForMode(mode)).toEqual(preferences)
  })

  it('conservatively folds the historical false/true notification pair into fully muted', () => {
    expect(roomNotificationModeFromPreferences({
      muteRegularNotifications: false,
      muteMentionNotifications: true,
    })).toBe('none')
    expect(roomNotificationPreferencesForMode('none')).toEqual({
      muteRegularNotifications: true,
      muteMentionNotifications: true,
    })
  })

  it('loads and reviews pending applications through owner-only Room APIs', () => {
    const admin = read('../features/rooms/components/RoomAdminPanel.tsx')
    expect(admin).toContain('roomAccountClient.listPendingJoinRequests(roomId)')
    expect(admin).toContain('roomAccountClient.reviewJoinRequest(roomId, id, decision)')
    expect(admin).toContain("review(request.id, 'approve')")
    expect(admin).toContain("review(request.id, 'reject')")
    expect(admin).toContain("event.event.startsWith('room.join_request.')")
    expect(admin).toContain('testID="room-invitation-requests"')
  })

  it('shares one URL and QR while retaining owner-only red invitation controls', () => {
    const admin = read('../features/rooms/components/RoomAdminPanel.tsx')
    const invite = read('../features/rooms/components/RoomInvitePanel.tsx')
    const link = read('../features/rooms/components/RoomShareLink.tsx')
    const content = read('../features/rooms/components/RoomShareContent.tsx')
    const settings = read('../features/rooms/RoomSettingsScreen.tsx')
    const dialogs = read('../features/rooms/components/ScopedRoomDialogs.tsx')
    const web = read('../features/rooms/ScopedRoomConversationScreen.tsx')
    const qr = read('../features/rooms/components/RoomInviteQr.tsx')
    expect(invite).toContain('roomAccountClient.getInviteLink(room.id)')
    expect(invite).toContain('roomAccountClient.resetInviteLink(room.id)')
    expect(invite).toContain("roomAccountClient.updateRoom(room.id, { joinPolicy: 'closed' })")
    expect(invite).toContain('onInviteClosed?.({ ...room, ...updatedRoom })')
    expect(invite).toContain('canManageInvite && !invitationsClosed && invite && !loading')
    expect(settings).toContain('canManageInvite={Boolean(isOwner && active)}')
    expect(invite).toContain('testID="room-reset-invite"')
    expect(invite).toContain('testID="room-close-invitation"')
    expect(invite).toContain('color={colors.error}')
    expect(invite).not.toContain('backgroundColor: colors.error')
    expect(invite).toContain('<RoomShareContent')
    expect(invite).toContain("t('mobile_invite_ai_identity_hint')")
    expect(dialogs).toContain('<RoomShareContent')
    expect(invite).not.toContain('invitationMetadata')
    expect(invite).not.toContain('room-invitation-closed')
    expect(content).toContain('value={share.url}')
    expect(content).toContain('url={share.url}')
    expect(content).toContain('key={share.url}')
    expect(content).toContain('hint={t(share.hintKey)}')
    expect(link).toContain('roomShareCopyValue({')
    expect(link).toContain('ROOM_INVITE_INSTALL_URL')
    expect(link).toContain('Share.share({ title: roomName, message: copyValue })')
    expect(link).toContain('Clipboard.setStringAsync(copyValue)')
    expect(link).not.toContain("t('spaces_invitation_message')")
    expect(link).toContain('Share.share')
    expect(link).toContain('Linking.openURL(url)')
    expect(link).toContain("name={copied ? 'checkmark' : 'copy-outline'}")
    expect(link).not.toContain('Skill')
    expect(link).not.toContain('Agent')
    expect(dialogs).not.toContain('RoomAgentLinkCard')
    expect(dialogs).not.toContain("t('scoped_room_open_app')")
    expect(dialogs).not.toContain("t('scoped_room_no_app')")
    expect(dialogs).toContain("mobileAppDownloadUrl('ios')")
    expect(dialogs).toContain("mobileAppDownloadUrl('android')")
    expect(dialogs).toContain("t('room_access_official_site')")
    expect(dialogs).toContain('variant="menu"')
    expect(web).toContain('testID="room-more-button"')
    expect(web).toContain('icon="more"')
    expect(web).not.toContain('name="share-outline"')
    expect(web).not.toContain('showAppQr')
    expect(web).not.toContain('showInvite')
    expect(web).toContain('version !== shareRequestVersion.current')
    expect(qr).toContain('createShareInviteQrMatrix(value)')
    expect(qr).toContain('testID="room-invite-qr"')
    expect(qr).toContain('testID="room-invite-qr-save"')
    expect(qr).toContain('fontSize={fittedTitle.fontSize}')
    expect(qr).toContain('{fittedTitle.title}')
    expect(qr).toContain('hint ?? t(')
    expect(qr).toContain('MediaLibrary.saveToLibraryAsync(uri)')
    expect(qr).toContain('link.download = filename')
    expect(qr).toContain(
      "purpose === 'invite' ? 'shennian-group-invite.png' : 'shennian-group.png'",
    )
    expect(admin).not.toContain('/invite-link/reset')
    expect(admin).toContain('<JoinPolicyRow')
    expect(admin).toContain('testID="room-join-policy-toggle"')
    expect(admin).toContain('accessibilityState={{ expanded, disabled }}')
    expect(admin).toContain('accessibilityValue={{ text: selectedOption.label }}')
    expect(admin).toContain('setExpanded(false)')
    expect(admin).toContain('if (!selected) void onChange(option.value)')
    expect(admin).toContain('{selectedOption.label}')
    expect(admin).toContain("value: 'open' as const")
    expect(admin).toContain("value: 'approval' as const")
    expect(admin).toContain("value: 'closed' as const")
    expect(admin).not.toContain('accessibilityRole="switch"')
    expect(admin).not.toContain('room-member-agent-limit')
    expect(admin).not.toContain('maxAgentsPerMember')
    expect(admin).not.toContain('spaces_join_policy_open_help')
    expect(admin).not.toContain('spaces_join_policy_approval_help')
    expect(admin).not.toContain('spaces_join_policy_closed_help')
    expect(admin).toContain('accessibilityRole="radiogroup"')
    expect(admin).toContain('accessibilityRole="radio"')
    expect(admin).toContain('<Ionicons name="checkmark"')
    expect(admin).not.toContain('  Switch,')
    expect(admin).toContain('policyValue: { flex: 1')
    expect(admin).not.toContain('limitValue: { flex: 1')
    expect(admin).toContain("textAlign: 'right'")
    expect(admin).toContain("backgroundColor: Platform.OS === 'web' ? colors.bg : colors.groupedBackground")
    expect(admin).toContain('testID="room-manage-members-entry"')
    expect(admin).toContain('styles.nativeDanger')
    expect(admin).not.toContain('groupDivider')
  })

  it('keeps the QR invitation title on one line and preserves the full join prefix', () => {
    const fitted = fitInviteQrTitle(
      '发布验收-0.3.40-20260831-这是一个特别长的群聊名称',
      (name) => `加入「${name}」`,
    )

    expect(fitted.title).toMatch(/^加入「.+…」$/)
    expect(fitted.displayName).toMatch(/…$/)
    expect(fitted.title).not.toContain('\n')
    expect(fitted.fontSize).toBeGreaterThanOrEqual(10)
    expect(fitted.fontSize).toBeLessThanOrEqual(18)

    const maximumLength = fitInviteQrTitle('群'.repeat(80), (name) => `加入「${name}」`)
    expect(maximumLength.title).toMatch(/^加入「.+…」$/)
    expect(maximumLength.title).not.toContain('\n')
    expect(maximumLength.fontSize).toBe(10)
  })

  it('archives a Room without exposing owner transfer', () => {
    const admin = read('../features/rooms/components/RoomAdminPanel.tsx')
    expect(admin).toContain('testID="room-dissolve-action"')
    expect(admin).toContain('roomAccountClient.deleteRoom(roomId)')
    expect(admin).not.toContain('authApi')
    expect(admin).toContain("t('spaces_dissolve_room_confirm')")
    expect(admin).not.toContain('transfer')
  })

  it('keeps active owner exit forbidden while removing archived history per member', () => {
    const membership = read('../../../../open-source/packages/server/src/services/room-membership.ts')
    expect(membership).toContain("membership.room.status === 'archived'")
    expect(membership).toContain("membership.role === 'owner' && !removingArchivedRecord")
    expect(membership).toContain('if (!removingArchivedRecord)')
    expect(membership).toContain("data: { status: 'left', removedAt:")
  })
})
