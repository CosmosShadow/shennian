import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { ConversationSchedules } from '../schedules/ConversationSchedules'
import { RoomAgentStatusLabel } from '../rooms/components/RoomAgentStatusLabel'
import { getRoomMemberParticipation } from '../rooms/roomPresentation'
import { isRoomAgentIdentityDimmed } from '../rooms/components/roomAgentStatusPresentation'
import { DesktopRoomAgentDetailsDialog } from '../desktop-agents/DesktopRoomAgentDetailsDialog'
// @arch docs/design/desktop/unified-desktop-control.md#页面清单与交互矩阵
// @test ../../__tests__/desktop-room-management.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { getWebAppUrl } from '../../config/server'
import { useTheme } from '../../hooks/useTheme'
import { desktopRoomManagementStyles as styles } from './desktopRoomManagementStyles'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import {
  DesktopRoomConfirmDialog,
  DesktopRoomMemberDetailDialog,
  DesktopRoomRenameDialog,
  type ConfirmAction,
} from './DesktopRoomManagementDialogs'
import { RoomInviteQr } from '../rooms/components/RoomInviteQr'
import type { RoomJoinRequest } from '../rooms/roomAccountClient.types'
import type { RoomMemberView } from '../rooms/types'
import {
  buildDesktopRoomMemberRows,
  resolveDesktopOwnRoomAgents,
  resolveDesktopRoomPermissions,
  resolveDesktopRoomShareUrl,
} from './desktopRoomManagementModel'
import { useDesktopRoomManagement } from './useDesktopRoomManagement'
import { copyDesktopRoomInvitation } from './desktopRoomClipboard'
import { buildDesktopRoomInvitation } from './desktopRoomInvitation'
import { ChoiceRow, DesktopRow, Section } from './desktopRoomManagementControls'
import { ROOM_NOTIFICATION_MODES, roomNotificationModeFromPreferences } from '../rooms/roomNotificationPreference'

export type DesktopRoomManagementPage = 'overview' | 'members' | 'invite' | 'manage' | 'notifications'

export function DesktopRoomManagementScreen({
  roomId,
  page,
}: {
  roomId: string
  page: DesktopRoomManagementPage
}) {
  const router = useRouter()
  const navigate = (next: DesktopRoomManagementPage) =>
    router.replace({
      pathname: `/(main)/spaces/${next === 'overview' ? 'details' : next}` as never,
      params: { roomId },
    })
  const returnToRoom = () =>
    router.replace({
      pathname: '/(main)/room-workspace',
      params: { roomId },
    })
  const returnToRooms = () => router.replace('/(main)/spaces')

  return (
    <DesktopRoomManagementPanel
      roomId={roomId}
      page={page}
      onNavigate={navigate}
      onBack={returnToRoom}
      onUnavailableBack={returnToRooms}
      onExitRoom={returnToRooms}
    />
  )
}

export function DesktopRoomManagementPanel({
  roomId,
  page,
  onNavigate,
  onBack,
  onUnavailableBack = onBack,
  onExitRoom = onBack,
  onClose,
  showBack = true,
  onNestedDialogChange,
}: {
  roomId: string
  page: DesktopRoomManagementPage
  onNavigate(page: DesktopRoomManagementPage): void
  onBack(): void
  onUnavailableBack?(): void
  onExitRoom?(): void
  onClose?(): void
  showBack?: boolean
  onNestedDialogChange?(visible: boolean): void
}) {
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  return (
    <DesktopRoomManagementContent
      key={`${accountId}:${roomId}`}
      accountId={accountId}
      roomId={roomId}
      page={page}
      onNavigate={onNavigate}
      onBack={onBack}
      onUnavailableBack={onUnavailableBack}
      onExitRoom={onExitRoom}
      onClose={onClose}
      showBack={showBack}
      onNestedDialogChange={onNestedDialogChange}
    />
  )
}

function DesktopRoomManagementContent({
  accountId,
  roomId,
  page,
  onNavigate,
  onBack,
  onUnavailableBack,
  onExitRoom,
  onClose,
  showBack,
  onNestedDialogChange,
}: {
  accountId: string
  roomId: string
  page: DesktopRoomManagementPage
  onNavigate(page: DesktopRoomManagementPage): void
  onBack(): void
  onUnavailableBack(): void
  onExitRoom(): void
  onClose?(): void
  showBack: boolean
  onNestedDialogChange?(visible: boolean): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const { model, state } = useDesktopRoomManagement(accountId, roomId)
  const permissions = resolveDesktopRoomPermissions(accountId, state.room, state.members)
  const canSetNotifications = Boolean(
    state.room?.status === 'active' && permissions.ownMembership &&
    state.room.membershipStatus !== 'left' && state.room.membershipStatus !== 'removed',
  )
  const ownAgents = resolveDesktopOwnRoomAgents(accountId, state.members)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [clearOnLeave, setClearOnLeave] = useState(true)
  const [draftName, setDraftName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [removingMembers, setRemovingMembers] = useState(false)
  const [hasMoreBelow, setHasMoreBelow] = useState(false)
  const scrollMetrics = useRef({ contentHeight: 0, viewportHeight: 0, offsetY: 0 })
  const updateScrollHint = () => {
    const { contentHeight, viewportHeight, offsetY } = scrollMetrics.current
    setHasMoreBelow(contentHeight > viewportHeight + 8 && offsetY + viewportHeight < contentHeight - 8)
  }
  useEffect(() => setRemovingMembers(false), [page])
  useEffect(() => {
    scrollMetrics.current.offsetY = 0
    setHasMoreBelow(false)
  }, [page])
  const [inviteRequested, setInviteRequested] = useState(false)
  const [selectedMember, setSelectedMember] = useState<RoomMemberView | null>(null)
  const [selectedAgentIdentityId, setSelectedAgentIdentityId] = useState<string | null>(null)
  const nestedDialogVisible = Boolean(confirm || editingName || selectedMember || selectedAgentIdentityId)
  useEffect(() => {
    onNestedDialogChange?.(nestedDialogVisible)
    return () => onNestedDialogChange?.(false)
  }, [nestedDialogVisible, onNestedDialogChange])
  useEffect(() => {
    if (page === 'invite' && state.room && state.room.joinPolicy !== 'closed' && !inviteRequested) {
      setInviteRequested(true)
      void model.loadInvite()
    }
  }, [inviteRequested, model, page, state.room])
  const title =
    page === 'members'
      ? t('spaces_all_members')
      : page === 'notifications'
        ? t('spaces_notifications_title')
        : page === 'invite'
          ? t('spaces_share_room')
          : page === 'manage'
            ? t('spaces_group_management')
            : (state.room?.name ?? t('spaces_settings_title'))
  const unavailable = state.failure === 'unavailable'
  const closeAfter = (action: () => Promise<boolean>, exitRoom = false) => {
    void action().then((ok) => {
      if (!ok) return
      setConfirm(null)
      if (exitRoom) onExitRoom()
    })
  }
  const openConfirm = (action: ConfirmAction) => {
    model.clearFailure()
    if (action.kind === 'leave') setClearOnLeave(true)
    setConfirm(action)
  }
  if (!accountId || (!state.room && state.loading))
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    )
  return (
    <View testID="desktop-room-management" style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, onClose && styles.dialogHeader, { borderBottomColor: colors.border }]}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            style={styles.iconButton}
            onPress={unavailable ? onUnavailableBack : onBack}
          >
            <Ionicons
              name="chevron-back"
              size={desktopControlMetrics.iconGlyphSize}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
        <View style={styles.headerCopy}>
          <Text
            accessibilityRole="header"
            style={[styles.title, onClose && styles.dialogTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
        {page === 'members' && permissions.canManage ? (
          <Pressable accessibilityRole="button" onPress={() => setRemovingMembers(value => !value)} style={styles.smallButton}>
            <Text style={[desktopTypography.control, {color: colors.textSecondary}]}>{t(removingMembers ? 'done' : 'spaces_manage_title')}</Text>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            style={styles.iconButton}
            onPress={onClose}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {state.failure && !unavailable && !confirm && !editingName ? (
        <View
          style={[styles.failure, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text accessibilityRole="alert" style={{ color: colors.error, flex: 1 }}>
            {t('spaces_manage_action_failed')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('retry')}
            style={styles.smallButton}
            onPress={() => void (page === 'invite' ? model.loadInvite() : model.reload())}
          >
            <Text style={{ color: colors.brand, fontWeight: '600' }}>{t('retry')}</Text>
          </Pressable>
        </View>
      ) : null}
      {!state.room ? (
        <View style={styles.center}>
          <Text style={[styles.loadTitle, { color: colors.text }]}>
            {t(unavailable ? 'spaces_unavailable_title' : 'spaces_manage_load_failed')}
          </Text>
          {unavailable ? (
            <Text style={[styles.loadBody, { color: colors.textSecondary }]}>
              {t('spaces_unavailable_body')}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(unavailable ? 'back' : 'retry')}
            style={styles.primaryButton}
            onPress={unavailable ? onUnavailableBack : () => void model.reload()}
          >
            <Text style={{ color: '#fff' }}>{t(unavailable ? 'back' : 'retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator
          scrollEventThrottle={16}
          onLayout={(event) => {
            scrollMetrics.current.viewportHeight = event.nativeEvent.layout.height
            updateScrollHint()
          }}
          onContentSizeChange={(_width, contentHeight) => {
            scrollMetrics.current.contentHeight = contentHeight
            updateScrollHint()
          }}
          onScroll={(event) => {
            scrollMetrics.current.offsetY = event.nativeEvent.contentOffset.y
            updateScrollHint()
          }}
        >
          {page === 'overview' ? (
            <Overview
              room={state.room}
              roomId={roomId}
              ownAgents={ownAgents}
              agentNames={Object.fromEntries(
                state.members
                  .filter(member => member.ownerUserId === accountId && member.agentIdentityId)
                  .map(member => [member.agentIdentityId!, member.displayAlias]),
              )}
              canManage={permissions.canManage}
              canAddAgent={permissions.canAddAgent}
              canViewInvite={permissions.canViewInvite}
              canLeave={permissions.canLeave}
              canDeleteRecord={permissions.canDeleteRecord}
              canSetNotifications={canSetNotifications}
              memberCounts={t('spaces_member_counts', {
                humans: state.members.filter((member) => member.principalType === 'human').length,
                agents: state.members.filter((member) => member.principalType === 'agent').length,
              })}
              onNavigate={onNavigate}
              onAddAgent={() => {
                onClose?.()
                router.navigate({ pathname: '/(main)/spaces/agent-add', params: { roomId } })
              }}
              onOpenAgent={setSelectedAgentIdentityId}
              onRename={() => {
                model.clearFailure()
                setDraftName(state.room?.name ?? '')
                setEditingName(true)
              }}
              onLeave={() => openConfirm({ kind: 'leave', roomName: state.room?.name ?? '' })}
              onDeleteRecord={() => openConfirm({
                kind: 'delete-record',
                roomName: state.room?.name ?? '',
                active: state.room?.membershipStatus === 'active',
              })}
            />
          ) : null}
          {page === 'members' ? (
            <Members
              members={state.members}
              accountId={accountId}
              canManage={permissions.canManage && removingMembers}
              onSelect={setSelectedMember}
              onRemove={(member) => openConfirm({ kind: 'remove', member })}
            />
          ) : null}
          {page === 'notifications' ? (
            canSetNotifications ? (
              <Section testID="desktop-room-notification-options">
                <ChoiceRow
                  groupLabel={t('spaces_notifications_title')}
                  disabled={Boolean(state.busy)}
                  values={ROOM_NOTIFICATION_MODES}
                  current={roomNotificationModeFromPreferences({
                    muteRegularNotifications: state.room.muteRegularNotifications ?? false,
                    muteMentionNotifications: state.room.muteMentionNotifications ?? false,
                  })}
                  label={(mode) => t(`spaces_notification_mode_${mode}`)}
                  testIDPrefix="desktop-room-notification-option"
                  onChoose={(mode) => void model.setNotificationMode(mode).then((ok) => {
                    if (ok) onNavigate('overview')
                  })}
                />
              </Section>
            ) : <PermissionState />
          ) : null}
          {page === 'invite' ? (
            <Invite
              room={state.room}
              invite={state.invite}
              loading={state.busy === 'invite.load'}
              canManage={permissions.canManage}
              onRetry={() => void model.loadInvite()}
              onReset={() => openConfirm({ kind: 'reset-invite' })}
              onClose={() => openConfirm({ kind: 'close-invite' })}
            />
          ) : null}
          {page === 'manage' ? (
            permissions.canManage ? (
              <Manage
                room={state.room}
                requests={state.requests}
                busy={Boolean(state.busy)}
                onPolicy={(joinPolicy) => openConfirm({ kind: 'policy', joinPolicy })}
                onReview={(request, decision) => openConfirm({ kind: 'review', request, decision })}
                onDissolve={() =>
                  openConfirm({ kind: 'dissolve', roomName: state.room?.name ?? '' })
                }
              />
            ) : (
              <PermissionState />
            )
          ) : null}
        </ScrollView>
      )}
      {state.room && hasMoreBelow ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.scrollHint, { backgroundColor: colors.bg, borderTopColor: colors.border }]}
        >
          <Text style={[styles.scrollHintText, { color: colors.textSecondary }]}>
            {t('desktop_scroll_more')}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </View>
      ) : null}
      <DesktopRoomConfirmDialog
        action={confirm}
        busy={Boolean(state.busy)}
        failed={Boolean(confirm && state.failure)}
        onCancel={() => {
          if (!state.busy) setConfirm(null)
        }}
        clearOnLeave={clearOnLeave}
        onToggleClearOnLeave={() => setClearOnLeave(value => !value)}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.kind === 'remove') closeAfter(() => model.removeMember(confirm.member.id))
          if (confirm.kind === 'review')
            closeAfter(() => model.review(confirm.request.id, confirm.decision))
          if (confirm.kind === 'policy') closeAfter(() => model.setJoinPolicy(confirm.joinPolicy))
          if (confirm.kind === 'reset-invite') closeAfter(model.resetInvite)
          if (confirm.kind === 'close-invite') closeAfter(model.closeInvite)
          if (confirm.kind === 'leave') closeAfter(clearOnLeave ? model.leaveAndClearRecord : model.leave, true)
          if (confirm.kind === 'delete-record') closeAfter(model.deleteRecord, true)
          if (confirm.kind === 'dissolve') closeAfter(model.dissolve, true)
        }}
      />
      <DesktopRoomRenameDialog
        visible={editingName}
        value={draftName}
        busy={Boolean(state.busy)}
        failed={Boolean(state.failure)}
        onChange={setDraftName}
        onCancel={() => {
          if (!state.busy) setEditingName(false)
        }}
        onConfirm={() =>
          void model.rename(draftName).then((ok) => {
            if (ok) setEditingName(false)
          })
        }
      />
      <DesktopRoomMemberDetailDialog
        member={selectedMember}
        members={state.members}
        onClose={() => setSelectedMember(null)}
      />
      <DesktopRoomAgentDetailsDialog
        roomId={roomId}
        agentIdentityId={selectedAgentIdentityId ?? ''}
        visible={Boolean(selectedAgentIdentityId)}
        onOpenWork={onClose}
        onClose={() => {
          setSelectedAgentIdentityId(null)
          void model.reload()
        }}
      />
    </View>
  )
}

function Overview({
  room,
  roomId,
  ownAgents,
  agentNames,
  canManage,
  canAddAgent,
  canViewInvite,
  canLeave,
  canDeleteRecord,
  canSetNotifications,
  memberCounts,
  onNavigate,
  onAddAgent,
  onOpenAgent,
  onRename,
  onLeave,
  onDeleteRecord,
}: {
  room: NonNullable<ReturnType<typeof useDesktopRoomManagement>['state']['room']>
  roomId: string
  ownAgents: Array<RoomMemberView & { agentIdentityId: string }>
  agentNames: Record<string, string>
  canManage: boolean
  canAddAgent: boolean
  canViewInvite: boolean
  canLeave: boolean
  canDeleteRecord: boolean
  canSetNotifications: boolean
  memberCounts: string
  onNavigate(page: DesktopRoomManagementPage): void
  onAddAgent(): void
  onOpenAgent(agentIdentityId: string): void
  onRename(): void
  onLeave(): void
  onDeleteRecord(): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  return (
    <View style={styles.column}>
      {room.status !== 'active' || room.membershipStatus === 'left' || room.membershipStatus === 'removed' ? (
        <Text
          style={[styles.notice, { color: colors.textSecondary, backgroundColor: colors.surface }]}
        >
          {t(room.membershipStatus === 'removed'
            ? 'spaces_removed_history_hint'
            : room.membershipStatus === 'left'
              ? 'spaces_left_history_hint'
              : 'spaces_archived_readonly')}
        </Text>
      ) : null}
      <Section>
        <DesktopRow
          label={t('spaces_settings_name')}
          value={room.name}
          onPress={room.status === 'active' ? onRename : undefined}
        />
        {canViewInvite ? (
          <DesktopRow
            testID="desktop-room-details-invite"
            label={t('spaces_share_room')}
            onPress={() => onNavigate('invite')}
          />
        ) : null}
        <OwnAgents
          agents={ownAgents}
          canAdd={canAddAgent}
          onAdd={onAddAgent}
          onOpen={onOpenAgent}
        />
        <DesktopRow
          testID="desktop-room-details-members"
          label={t('spaces_all_members')}
          value={memberCounts}
          onPress={() => onNavigate('members')}
        />
        {canManage ? (
          <DesktopRow
            testID="desktop-room-details-manage"
            label={t('spaces_group_management')}
            onPress={() => onNavigate('manage')}
          />
        ) : null}
        <ConversationSchedules desktop embedded roomId={roomId} agentNames={agentNames} />
        {canSetNotifications ? (
          <DesktopRow
            testID="desktop-room-notification-preference"
            label={t('spaces_notifications_title')}
            value={t(`spaces_notification_mode_${roomNotificationModeFromPreferences({
              muteRegularNotifications: room.muteRegularNotifications ?? false,
              muteMentionNotifications: room.muteMentionNotifications ?? false,
            })}`)}
            onPress={() => onNavigate('notifications')}
          />
        ) : null}
      </Section>
      {canLeave ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('spaces_leave_room')}
          style={styles.dangerButton}
          onPress={onLeave}
        >
          <Text style={{ color: colors.error }}>{t('spaces_leave_room')}</Text>
        </Pressable>
      ) : null}
      {canDeleteRecord ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('spaces_remove_archived_room')}
          style={styles.dangerButton}
          onPress={onDeleteRecord}
        >
          <Text style={{ color: colors.error }}>{t('spaces_remove_archived_room')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function OwnAgents({
  agents,
  canAdd,
  onAdd,
  onOpen,
}: {
  agents: Array<RoomMemberView & { agentIdentityId: string }>
  canAdd: boolean
  onAdd(): void
  onOpen(agentIdentityId: string): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  return (
    <View testID="desktop-room-details-own-agents">
      <View style={[styles.ownAgentsHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{t('spaces_my_agents')}</Text>
        {canAdd ? (
          <Pressable
            testID="desktop-room-details-add-agent"
            accessibilityRole="button"
            accessibilityLabel={t('spaces_add_agent')}
            style={styles.ownAgentsAdd}
            onPress={onAdd}
          >
            <Ionicons name="add" size={20} color={colors.brand} />
          </Pressable>
        ) : null}
      </View>
      {agents.length === 0 ? (
        <Text style={[styles.ownAgentsEmpty, { color: colors.textSecondary }]}>
          {t('spaces_my_agents_empty')}
        </Text>
      ) : agents.map((agent) => {
        const participation = getRoomMemberParticipation(agent)
        const offline = isRoomAgentIdentityDimmed(participation)
        return (
          <Pressable
            key={agent.id}
            testID={`desktop-room-details-agent-${agent.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${agent.displayAlias} · AI`}
            style={({ pressed }) => [
              styles.ownAgentRow,
              { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
            ]}
            onPress={() => onOpen(agent.agentIdentityId)}
          >
            <RoomIdentityAvatar
              name={agent.displayAlias}
              avatar={agent.avatar}
              agent
              ownerAvatar={agent.ownerAvatar}
              ownerName={agent.ownerDisplayName}
              size={36}
              offline={offline}
            />
            <Text
              numberOfLines={1}
              style={[styles.ownAgentName, { color: offline ? colors.textTertiary : colors.text }]}
            >
              {agent.displayAlias} · AI
            </Text>
            {participation ? (
              <RoomAgentStatusLabel
                participation={participation}
                label={t(`spaces_agent_status_full_${participation}`)}
                style={styles.ownAgentStatus}
              />
            ) : null}
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Pressable>
        )
      })}
    </View>
  )
}

function Members({
  members,
  accountId,
  canManage,
  onSelect,
  onRemove,
}: {
  members: RoomMemberView[]
  accountId: string
  canManage: boolean
  onSelect(member: RoomMemberView): void
  onRemove(member: RoomMemberView): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const rows = useMemo(() => buildDesktopRoomMemberRows(members), [members])
  return (
    <Section testID="desktop-room-member-list">
      {rows.map(({ member, depth, owner }, index) => {
        const mine = member.principalType === 'human' && member.ownerUserId === accountId
        const removable = canManage && member.role !== 'owner' && !mine
        const ownership =
          member.principalType === 'agent'
            ? t('spaces_agent_owned_by', {
                name: owner?.displayAlias ?? member.ownerDisplayName ?? '',
              })
            : t(`spaces_role_${member.role}`)
        return (
          <View
            key={member.id}
            testID={`desktop-room-member-${member.id}`}
            style={[
              styles.memberRow,
              depth === 1 && styles.agentIndent,
              index > 0 && {
                borderTopColor: colors.border,
                borderTopWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${member.displayAlias}${member.principalType === 'agent' ? ' · AI' : ''}, ${ownership}`}
              style={styles.memberProfileButton}
              onPress={() => onSelect(member)}
            >
              <RoomIdentityAvatar name={member.displayAlias} avatar={member.avatar} ownerAvatar={member.ownerAvatar} ownerName={member.ownerDisplayName} agent={member.principalType === 'agent'} size={36} />
              <View style={styles.memberCopy}>
                <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={2}>
                  {member.displayAlias}{member.principalType === 'agent' ? ' · AI' : ''}
                  {mine ? ` · ${t('spaces_me')}` : ''}
                </Text>
                {member.principalType === 'human' && member.role === 'owner' ? <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{t('spaces_role_owner')}</Text> : null}
              </View>
            </Pressable>
            {removable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('spaces_member_remove')}
                style={styles.iconButton}
                onPress={() => onRemove(member)}
              >
                <Ionicons name="remove-circle-outline" size={19} color={colors.error} />
              </Pressable>
            ) : null}
          </View>
        )
      })}
    </Section>
  )
}

function Invite({
  room,
  invite,
  loading,
  canManage,
  onRetry,
  onReset,
  onClose,
}: {
  room: NonNullable<ReturnType<typeof useDesktopRoomManagement>['state']['room']>
  invite: ReturnType<typeof useDesktopRoomManagement>['state']['invite']
  loading: boolean
  canManage: boolean
  onRetry(): void
  onReset(): void
  onClose(): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const url = resolveDesktopRoomShareUrl(room, invite, getWebAppUrl())
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    )
  if (!url)
    return (
      <View style={styles.center}>
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {t('spaces_manage_load_failed')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('retry')}
          style={styles.primaryButton}
          onPress={onRetry}
        >
          <Text style={{ color: '#fff' }}>{t('retry')}</Text>
        </Pressable>
      </View>
    )
  const invitation = buildDesktopRoomInvitation(t, room.name, url, room.joinPolicy === 'closed')
  return (
    <View style={styles.shareColumn}>
      <RoomInviteQr
        value={url}
        roomName={room.name}
        purpose={invitation.purpose}
        hint={invitation.hint}
      />
      <View style={styles.shareBlockHeader}>
        <Text style={[styles.shareBlockTitle, { color: colors.text }]}>{t('spaces_invites_title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(copied ? 'spaces_invite_copied' : 'copy')}
          hitSlop={4}
          style={({ pressed }) => [styles.shareIconButton, { backgroundColor: colors.brandLight }, pressed && styles.pressed]}
          onPress={() => {
            setCopyFailed(false)
            void copyDesktopRoomInvitation(invitation.text).then((success) => {
              setCopied(success)
              setCopyFailed(!success)
            })
          }}
        >
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={17} color={colors.brand} />
        </Pressable>
      </View>
      <Section>
        <View style={styles.linkRow}>
          <Text selectable style={[styles.link, { color: colors.text }]}>
            {invitation.text}
          </Text>
        </View>
      </Section>
      {copyFailed ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {t('spaces_share_copy_failed')}
        </Text>
      ) : null}
      {canManage && room.joinPolicy !== 'closed' ? (
        <View style={styles.ownerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('spaces_invite_reset')}
            style={styles.dangerButton}
            onPress={onReset}
          >
            <Text style={{ color: colors.error }}>{t('spaces_invite_reset')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('spaces_invitation_close')}
            style={styles.dangerButton}
            onPress={onClose}
          >
            <Text style={{ color: colors.error }}>{t('spaces_invitation_close')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function Manage({
  room,
  requests,
  busy,
  onPolicy,
  onReview,
  onDissolve,
}: {
  room: NonNullable<ReturnType<typeof useDesktopRoomManagement>['state']['room']>
  requests: ReturnType<typeof useDesktopRoomManagement>['state']['requests']
  busy: boolean
  onPolicy(value: 'open' | 'approval' | 'closed'): void
  onReview(request: RoomJoinRequest, decision: 'approve' | 'reject'): void
  onDissolve(): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [policyOpen, setPolicyOpen] = useState(false)
  return (
    <View style={styles.column}>
      <Section>
        <DesktopRow
          label={t('spaces_join_policy_title')}
          value={t(`spaces_join_${room.joinPolicy}`)}
          disabled={busy}
          expanded={policyOpen}
          onPress={() => !busy && setPolicyOpen((value) => !value)}
        />
        {policyOpen ? (
          <ChoiceRow
            groupLabel={t('spaces_join_policy_title')}
            disabled={busy}
            values={['open', 'approval', 'closed'] as const}
            current={room.joinPolicy}
            label={(value) => t(`spaces_join_${value}`)}
            onChoose={(value) => {
              onPolicy(value)
            }}
          />
        ) : null}
      </Section>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        {t('spaces_pending_requests')}
      </Text>
      <Section testID="desktop-room-join-requests">
        {requests.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            {t('spaces_requests_empty')}
          </Text>
        ) : (
          requests.map((request) => (
            <View key={request.id} style={[styles.requestRow, { borderTopColor: colors.border }]}>
              <View style={styles.memberCopy}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>
                  {request.applicant.name}
                </Text>
                {request.message ? (
                  <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
                    {request.message}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('spaces_request_reject')}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                style={styles.smallButton}
                onPress={() => onReview(request, 'reject')}
              >
                <Text style={{ color: colors.error }}>{t('spaces_request_reject')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('spaces_request_approve')}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                style={styles.smallButton}
                onPress={() => onReview(request, 'approve')}
              >
                <Text style={{ color: colors.brand }}>{t('spaces_request_approve')}</Text>
              </Pressable>
            </View>
          ))
        )}
      </Section>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('spaces_dissolve_room')}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        style={styles.dangerButton}
        onPress={onDissolve}
      >
        <Text style={{ color: colors.error }}>{t('spaces_dissolve_room')}</Text>
      </Pressable>
    </View>
  )
}

function PermissionState() {
  const { colors } = useTheme()
  const { t } = useTranslation()
  return (
    <View style={styles.center}>
      <Text style={[styles.title, { color: colors.text }]}>
        {t('spaces_owner_only_management')}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {t('spaces_owner_only_management_help')}
      </Text>
    </View>
  )
}
