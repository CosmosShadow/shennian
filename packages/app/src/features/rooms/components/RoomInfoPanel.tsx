import { ActionIconButton } from '../../../components/ActionIconButton'
import { ConversationSchedules } from '../../schedules/ConversationSchedules'
// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import BottomSheet from '../../../components/BottomSheet'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import type { RoomDetailView, RoomMemberView } from '../types'
import { RoomRenameModal } from './RoomRenameModal'
import { RoomApprovalDot } from './RoomApprovalDot'
import { RoomMyAgentsPanel } from './RoomMyAgentsPanel'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'
import { RoomBrowserLoginModal } from './RoomBrowserLoginModal'
import { roomAccountClient } from '../roomAccountClient'
import {
  ROOM_NOTIFICATION_MODES,
  roomNotificationModeFromPreferences,
  roomNotificationPreferencesForMode,
  type RoomNotificationMode,
} from '../roomNotificationPreference'
import { useRoomBrowserAuthorizations } from '../useRoomBrowserAuthorizations'

export function RoomInfoPanel({
  roomId,
  room,
  members,
  currentUserId,
  onOpenMembers,
  onOpenAddMembers,
  onOpenShare,
  onOpenManage,
  onRoomUpdated,
  onMembersUpdated,
  onLeft,
}: {
  roomId: string
  room: RoomDetailView
  members: RoomMemberView[]
  currentUserId?: string | null
  onOpenMembers: () => void
  onOpenAddMembers: () => void
  onOpenShare: () => void
  onOpenManage: () => void
  onRoomUpdated: (room: RoomDetailView) => void
  onMembersUpdated?: (members: RoomMemberView[]) => void
  onLeft: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const browserAuthorizations = useRoomBrowserAuthorizations()
  const [browserModalOpen, setBrowserModalOpen] = useState(false)
  const [loggedOutSessionIds, setLoggedOutSessionIds] = useState<Set<string>>(() => new Set())
  const [visibleMembers, setVisibleMembers] = useState(members)
  const [notificationPreferences, setNotificationPreferences] = useState(() => ({
    muteRegularNotifications: room.muteRegularNotifications ?? false,
    muteMentionNotifications: room.muteMentionNotifications ?? false,
  }))
  const [notificationPickerOpen, setNotificationPickerOpen] = useState(false)
  const [savingNotificationPreference, setSavingNotificationPreference] = useState(false)
  const [recordAction, setRecordAction] = useState<'leave' | 'clear' | null>(null)
  const [recordActionBusy, setRecordActionBusy] = useState(false)
  const [recordActionError, setRecordActionError] = useState('')
  const [leftDuringRecordAction, setLeftDuringRecordAction] = useState(false)
  const [clearOnLeave, setClearOnLeave] = useState(true)
  useEffect(() => setVisibleMembers(members), [members])
  useEffect(() => setNotificationPreferences({
    muteRegularNotifications: room.muteRegularNotifications ?? false,
    muteMentionNotifications: room.muteMentionNotifications ?? false,
  }), [room.muteMentionNotifications, room.muteRegularNotifications])
  const ownHuman = visibleMembers.find(
    (member) => member.principalType === 'human' && member.ownerUserId === currentUserId,
  )
  const isOwner = ownHuman?.role === 'owner'
  const archived = room.status !== 'active'
  const membershipStatus = room.membershipStatus ?? (ownHuman ? 'active' : null)
  const inactiveMembership = membershipStatus === 'left' || membershipStatus === 'removed'
  const readOnly = archived || inactiveMembership
  const readOnlyTitleKey = membershipStatus === 'removed'
    ? 'spaces_removed_title'
    : membershipStatus === 'left'
      ? 'spaces_left_title'
      : 'spaces_archived_title'
  const readOnlyHintKey = membershipStatus === 'removed'
    ? 'spaces_removed_history_hint'
    : membershipStatus === 'left'
      ? 'spaces_left_history_hint'
      : 'spaces_archived_history_hint'
  const [editingName, setEditingName] = useState(false)
  const roomBrowserAuthorizations = browserAuthorizations.filter(
    (authorization) =>
      authorization.roomId === roomId && !loggedOutSessionIds.has(authorization.id),
  )

  const leave = () => {
    setRecordActionError('')
    setLeftDuringRecordAction(false)
    setClearOnLeave(true)
    setRecordAction('leave')
  }

  const deleteRecord = () => {
    if (Platform.OS === 'web') {
      setRecordActionError('')
      setRecordAction('clear')
      return
    }
    Alert.alert(
      t('spaces_remove_archived_room_title', { name: room.name }),
      t(!readOnly
        ? 'spaces_delete_active_record_confirm'
        : 'spaces_remove_archived_room_confirm'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('spaces_remove_archived_room'),
          style: 'destructive',
          onPress: () => void roomAccountClient.deleteRoomRecord(roomId).then(() => {
            if (readOnly) onLeft()
          }),
        },
      ],
    )
  }

  const runRecordAction = async (clear: boolean) => {
    if (recordActionBusy) return
    setRecordActionBusy(true)
    setRecordActionError('')
    let left = leftDuringRecordAction
    try {
      if (recordAction === 'leave') {
        await roomAccountClient.leaveRoom(roomId)
        left = true
      }
      if (clear) await roomAccountClient.deleteRoomRecord(roomId)
      setRecordAction(null)
      if (left || readOnly) onLeft()
    } catch {
      if (left && clear) {
        setLeftDuringRecordAction(true)
        setRecordAction('clear')
      }
      setRecordActionError(t(left && clear
        ? 'spaces_leave_clear_failed'
        : 'spaces_manage_action_failed'))
    } finally {
      setRecordActionBusy(false)
    }
  }

  const notificationMode = roomNotificationModeFromPreferences(notificationPreferences)
  const updateNotificationPreference = async (mode: RoomNotificationMode) => {
    if (savingNotificationPreference) return
    const previous = notificationPreferences
    const next = roomNotificationPreferencesForMode(mode)
    if (
      previous.muteRegularNotifications === next.muteRegularNotifications &&
      previous.muteMentionNotifications === next.muteMentionNotifications
    )
      return
    setNotificationPreferences(next)
    setSavingNotificationPreference(true)
    try {
      const saved = await roomAccountClient.updateNotificationPreferences(roomId, next)
      setNotificationPreferences(saved)
      onRoomUpdated({ ...room, ...saved })
    } catch {
      setNotificationPreferences(previous)
      Alert.alert(t('spaces_notification_save_failed'))
    } finally {
      setSavingNotificationPreference(false)
    }
  }

  return (
    <>
      <ScrollView style={[styles.root, { backgroundColor: colors.groupedBackground }]} contentContainerStyle={styles.content}>
        {readOnly ? (
          <View
            style={styles.archived}
            accessible
            accessibilityLabel={`${t(readOnlyTitleKey)}. ${t(readOnlyHintKey)}`}
          >
            <Text style={[styles.archivedTitle, { color: colors.text }]}>
              {t(readOnlyTitleKey)}
            </Text>
            <Text style={[styles.archivedText, { color: colors.textSecondary }]}>
              {t(readOnlyHintKey)}
            </Text>
          </View>
        ) : null}
        <View style={[styles.group, { backgroundColor: colors.groupedSurface }]}>
          <ActionRow
            testID="room-rename-row"
            label={t(Platform.OS === 'web' ? 'spaces_settings_name' : 'mobile_conversation_name')}
            value={room.name}
            showSeparator
            onPress={readOnly || !isOwner ? undefined : () => setEditingName(true)}
            colors={colors}
          />
          <ActionRow
            testID="room-all-members-row"
            label={t('mobile_members')}
            value={t('mobile_members_count', { count: visibleMembers.length })}
            valueRole="secondary"
            onPress={onOpenMembers}
            colors={colors}
          />
          <View style={[styles.membersPreview, { borderBottomColor: colors.groupedSeparator }]}>
            {visibleMembers.slice(0, 5).map((member) => <RoomIdentityAvatar key={member.id}
              name={member.displayAlias} avatar={member.avatar} agent={member.principalType === 'agent'} size={38} />)}
            {ownHuman && !readOnly ? <ActionIconButton icon="add" color={colors.brand} testID="room-preview-add-member"
              label={t('mobile_add_members')}
              onPress={onOpenAddMembers} style={[styles.previewAdd, { backgroundColor: colors.surfaceHover }]} /> : null}
          </View>
          {ownHuman && !readOnly ? <ActionRow testID="room-share-row"
            label={t('mobile_invite_conversation')}
            subtitle={t('mobile_invite_conversation_hint')}
            onPress={onOpenShare} colors={colors} /> : null}
        </View>
        {ownHuman ? <ConversationSchedules roomId={roomId} agentNames={Object.fromEntries(visibleMembers.filter(m => m.ownerUserId === currentUserId && m.agentIdentityId).map(m => [m.agentIdentityId!, m.displayAlias]))} /> : null}
        <RoomMyAgentsPanel
          roomId={roomId}
          room={room}
          members={visibleMembers}
          currentUserId={currentUserId}
          editable={!readOnly}
          onMembersUpdated={(nextMembers) => {
            setVisibleMembers(nextMembers)
            onMembersUpdated?.(nextMembers)
          }}
        />
        {Platform.OS !== 'web' && ownHuman && roomBrowserAuthorizations.length ? (
          <View style={[styles.group, styles.spacedGroup, { backgroundColor: colors.groupedSurface }]}>
            <ActionRow
              testID="room-browser-access-row"
              label={t('spaces_browser_session')}
              value={t('spaces_browser_session_count', { count: roomBrowserAuthorizations.length })}
              valueRole="secondary"
              onPress={() => setBrowserModalOpen(true)}
              colors={colors}
            />
          </View>
        ) : null}
        {ownHuman && !readOnly ? (
          <View
            style={[styles.group, styles.spacedGroup, { backgroundColor: colors.groupedSurface }]}
          >
            <NotificationPreferenceRow
              mode={notificationMode}
              saving={savingNotificationPreference}
              onPress={() => setNotificationPickerOpen(true)}
              colors={colors}
              label={t('spaces_notifications_title')}
              value={t(`spaces_notification_mode_${notificationMode}`)}
            />
          </View>
        ) : null}
        {isOwner && !readOnly ? <View style={[styles.group, styles.spacedGroup, { backgroundColor: colors.groupedSurface }]}>
          <ActionRow label={t('mobile_manage_conversation')} onPress={onOpenManage}
            colors={colors} approvalRoomId={roomId} />
        </View> : null}
        {membershipStatus === 'active' && !isOwner && !archived ? (
          <Pressable
            testID="room-leave-action"
            style={[styles.danger, { backgroundColor: colors.groupedSurface }]}
            onPress={leave}
          >
            <Text style={[{ color: Platform.OS === 'web' ? colors.error : colors.errorText, fontSize: 16 }, Platform.OS !== 'web' && mobileTypography.body]}>
              {t('spaces_leave_room')}
            </Text>
          </Pressable>
        ) : null}
        {membershipStatus ? (
          <Pressable
            testID="room-remove-record-action"
            style={[styles.danger, { backgroundColor: colors.groupedSurface }]}
            onPress={deleteRecord}
          >
            <Text style={[{ color: Platform.OS === 'web' ? colors.error : colors.errorText, fontSize: 16 }, Platform.OS !== 'web' && mobileTypography.body]}>
              {t('spaces_remove_archived_room')}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {editingName && !readOnly ? (
        <RoomRenameModal
          key={roomId}
          roomId={roomId}
          name={room.name}
          onClose={() => setEditingName(false)}
          onSaved={(updatedRoom) => onRoomUpdated({ ...room, ...updatedRoom })}
        />
      ) : null}
      <RoomBrowserLoginModal
        roomId={roomId}
        authorizations={roomBrowserAuthorizations}
        visible={browserModalOpen}
        onClose={() => setBrowserModalOpen(false)}
        onLoggedOut={(sessionIds) => setLoggedOutSessionIds((current) => {
          const next = new Set(current)
          for (const sessionId of sessionIds) next.add(sessionId)
          return next
        })}
      />
      <BottomSheet
        isOpen={recordAction !== null}
        onClose={() => {
          if (recordActionBusy) return
          setRecordAction(null)
          if (leftDuringRecordAction) onLeft()
        }}
        title={recordAction === 'leave'
          ? t('spaces_leave_room_title', { name: room.name })
          : t('spaces_remove_archived_room_title', { name: room.name })}
        preferDialogOnWeb
      >
        <View style={styles.notificationOptions}>
          {recordAction === 'clear' ? (
            <Text style={[styles.notificationOptionText, { color: colors.textSecondary }]}>
              {t(readOnly ? 'spaces_remove_archived_room_confirm' : 'spaces_delete_active_record_confirm')}
            </Text>
          ) : null}
          {recordActionError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{recordActionError}</Text> : null}
          {recordAction === 'leave' ? (
            <Pressable
              testID="room-leave-clear-checkbox"
              accessibilityRole="checkbox"
              accessibilityLabel={t('spaces_remove_archived_room')}
              accessibilityState={{ checked: clearOnLeave, disabled: recordActionBusy }}
              disabled={recordActionBusy}
              onPress={() => setClearOnLeave(value => !value)}
              style={styles.notificationOption}
            >
              <Ionicons name={clearOnLeave ? 'checkbox' : 'square-outline'} size={22} color={clearOnLeave ? colors.error : colors.textSecondary} />
              <Text style={{ color: colors.text }}>{t('spaces_remove_archived_room')}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" disabled={recordActionBusy} onPress={() => {
            setRecordAction(null)
            if (leftDuringRecordAction) onLeft()
          }} style={styles.notificationOption}>
            <Text style={{ color: colors.text }}>{t('cancel')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={recordActionBusy} onPress={() => void runRecordAction(recordAction === 'leave' ? clearOnLeave : true)} style={styles.notificationOption}>
            <Text style={{ color: colors.error }}>{t(recordAction === 'leave' ? 'spaces_leave_room' : 'spaces_remove_archived_room')}</Text>
          </Pressable>
        </View>
      </BottomSheet>
      <BottomSheet
        isOpen={notificationPickerOpen}
        onClose={() => setNotificationPickerOpen(false)}
        title={t('spaces_notifications_title')}
        preferDialogOnWeb
      >
        <View style={styles.notificationOptions} accessibilityRole="radiogroup">
          {ROOM_NOTIFICATION_MODES.map((mode) => {
            const selected = notificationMode === mode
            return (
              <Pressable
                key={mode}
                testID={`room-notification-option-${mode}`}
                accessibilityRole="radio"
                accessibilityLabel={t(`spaces_notification_mode_${mode}`)}
                accessibilityState={{ checked: selected, disabled: savingNotificationPreference }}
                disabled={savingNotificationPreference}
                onPress={() => {
                  setNotificationPickerOpen(false)
                  void updateNotificationPreference(mode)
                }}
                style={({ pressed }) => [
                  styles.notificationOption,
                  { borderBottomColor: colors.groupedSeparator },
                  pressed && { backgroundColor: colors.surfaceHover },
                ]}
              >
                <View
                  style={styles.selectionMark}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  {selected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
                </View>
                <Text
                  style={[
                    styles.notificationOptionText,
                    { color: selected ? colors.brand : colors.text },
                  ]}
                >
                  {t(`spaces_notification_mode_${mode}`)}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </BottomSheet>
    </>
  )
}

function NotificationPreferenceRow({
  label,
  value,
  mode,
  saving,
  onPress,
  colors,
}: {
  label: string
  value: string
  mode: RoomNotificationMode
  saving: boolean
  onPress: () => void
  colors: ReturnType<typeof useTheme>['colors']
}) {
  return (
    <Pressable
      testID="room-notification-preference"
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityState={{ disabled: saving }}
      disabled={saving}
      onPress={onPress}
      style={styles.row}
    >
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <Text
        testID={`room-notification-current-${mode}`}
        style={[styles.value, { color: colors.textSecondary }]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {saving ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      )}
    </Pressable>
  )
}

function ActionRow({
  approvalRoomId,
  testID,
  label,
  subtitle,
  value,
  valueRole = 'body',
  showSeparator = false,
  onPress,
  colors,
}: {
  approvalRoomId?: string
  testID?: string
  label: string
  subtitle?: string
  value?: string
  valueRole?: 'body' | 'secondary'
  showSeparator?: boolean
  onPress?: () => void
  colors: ReturnType<typeof useTheme>['colors']
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${label}，${subtitle}` : label}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      style={[styles.row, showSeparator && { borderBottomWidth: 1, borderBottomColor: colors.groupedSeparator }]}
      onPress={onPress}
    >
      {subtitle ? <View style={styles.rowLabelGroup}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View> : <Text style={[styles.label, { color: colors.text }]}>{label}</Text>}
      {approvalRoomId ? <RoomApprovalDot roomId={approvalRoomId} /> : null}
      {value ? (
        <Text style={[styles.value, Platform.OS !== 'web' && mobileTypography[valueRole], { color: colors.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
          {value}
        </Text>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },
  archived: {
    marginTop: 8,
    marginBottom: 20,
    paddingHorizontal: 4,
    gap: 2,
  },
  archivedTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.sectionTitle),
  },
  archivedText: {
    fontSize: 15,
    lineHeight: 20,
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  group: { marginTop: 0, borderRadius: 12, overflow: 'hidden' },
  spacedGroup: { marginTop: 12 },
  membersPreview: { minHeight: 60, paddingHorizontal: 18, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  previewAdd: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    ...(Platform.OS !== 'web' && { paddingVertical: 12 }),
  },
  label: { flex: 1, fontSize: 16, ...(Platform.OS !== 'web' && mobileTypography.body) },
  rowLabelGroup: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16, ...(Platform.OS !== 'web' && mobileTypography.body) },
  rowSubtitle: { fontSize: 13, lineHeight: 18, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  notificationOptions: { width: '100%' },
  notificationOption: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectionMark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  notificationOptionText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'left',
    ...(Platform.OS !== 'web' && mobileTypography.body),
  },
  value: { maxWidth: '55%', fontSize: 15, ...(Platform.OS !== 'web' && { flexShrink: 1, textAlign: 'right' }) },
  danger: { minHeight: 56, marginTop: 12, alignItems: 'center', justifyContent: 'center' },
})
