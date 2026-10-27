// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-room-management.test.ts
import { useRef } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { getRoomMemberParticipation } from '../rooms/roomPresentation'
import type { RoomJoinRequest } from '../rooms/roomAccountClient.types'
import type { RoomMemberView } from '../rooms/types'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { desktopRoomManagementStyles as styles } from './desktopRoomManagementStyles'

export type ConfirmAction =
  | { kind: 'remove'; member: RoomMemberView }
  | { kind: 'review'; request: RoomJoinRequest; decision: 'approve' | 'reject' }
  | { kind: 'policy'; joinPolicy: 'open' | 'approval' | 'closed' }
  | { kind: 'leave' | 'dissolve'; roomName: string }
  | { kind: 'delete-record'; roomName: string; active: boolean }
  | { kind: 'reset-invite' | 'close-invite' }

export function DesktopRoomConfirmDialog({
  action,
  busy,
  failed,
  onCancel,
  onConfirm,
  clearOnLeave,
  onToggleClearOnLeave,
}: {
  action: ConfirmAction | null
  busy: boolean
  failed: boolean
  onCancel(): void
  onConfirm(): void
  clearOnLeave: boolean
  onToggleClearOnLeave(): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const cancelRef = useRef<View>(null)
  if (!action) return null
  const destructive =
    action.kind === 'remove' ||
    action.kind === 'reset-invite' ||
    action.kind === 'close-invite' ||
    action.kind === 'leave' ||
    action.kind === 'delete-record' ||
    action.kind === 'dissolve' ||
    (action.kind === 'review' && action.decision === 'reject')
  const title =
    action.kind === 'remove'
      ? t('spaces_member_remove_confirm')
      : action.kind === 'review'
        ? t(action.decision === 'approve' ? 'spaces_request_approve' : 'spaces_request_reject')
        : action.kind === 'policy'
          ? t('spaces_join_policy_title')
          : action.kind === 'leave'
            ? t('spaces_leave_room_title', { name: action.roomName })
            : action.kind === 'delete-record'
              ? t('spaces_remove_archived_room_title', { name: action.roomName })
            : action.kind === 'dissolve'
              ? t('spaces_dissolve_room_title', { name: action.roomName })
              : t(
                  action.kind === 'reset-invite'
                    ? 'spaces_invite_reset'
                    : 'spaces_invitation_close',
                )
  const body =
    action.kind === 'remove'
      ? t(
          action.member.principalType === 'agent'
            ? 'spaces_agent_remove_confirm_title'
            : 'spaces_member_remove_confirm_body',
          { name: action.member.displayAlias },
        )
      : action.kind === 'review'
        ? t('desktop_room_review_confirm', {
            name: action.request.applicant.name,
            decision: t(
              action.decision === 'approve' ? 'spaces_request_approve' : 'spaces_request_reject',
            ),
          })
        : action.kind === 'policy'
          ? t(`spaces_join_policy_${action.joinPolicy}_help`)
          : action.kind === 'reset-invite'
            ? t('spaces_invite_reset_confirm')
            : action.kind === 'close-invite'
              ? t('spaces_invitation_close_confirm')
              : action.kind === 'delete-record'
                  ? t(action.active
                      ? 'spaces_delete_active_record_confirm'
                      : 'spaces_remove_archived_room_confirm')
                : t('spaces_dissolve_room_confirm')
  return (
    <DesktopDialog title={title} onClose={onCancel} busy={busy} initialFocusRef={cancelRef}>
      <View
        testID="desktop-room-confirm-dialog"
        accessibilityRole="alert"
        style={styles.dialogContent}
      >
        {action.kind !== 'leave' ? (
          <Text style={[desktopTypography.body, { color: colors.textSecondary }]}>{body}</Text>
        ) : (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={t('spaces_remove_archived_room')}
            accessibilityState={{ checked: clearOnLeave, disabled: busy }}
            disabled={busy}
            style={[styles.dialogButton, { alignSelf: 'flex-start', flexDirection: 'row', gap: 8 }]}
            onPress={onToggleClearOnLeave}
          >
            <Text style={[desktopTypography.control, { color: clearOnLeave ? colors.error : colors.textSecondary }]}>
              {clearOnLeave ? '☑' : '☐'}
            </Text>
            <Text style={[desktopTypography.control, { color: colors.text }]}>{t('spaces_remove_archived_room')}</Text>
          </Pressable>
        )}
        {failed ? (
          <Text accessibilityRole="alert" style={[desktopTypography.body, { color: colors.error }]}>
            {t('spaces_manage_action_failed')}
          </Text>
        ) : null}
        <View style={styles.dialogActions}>
          <Pressable
            ref={cancelRef}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={styles.dialogButton}
            onPress={onCancel}
          >
            <Text style={[desktopTypography.control, { color: colors.text }]}>{t('cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(action.kind === 'leave' ? 'spaces_leave_room' : 'confirm')}
            accessibilityState={{ disabled: busy, busy }}
            accessibilityHint={busy ? t('desktop_dialog_busy') : undefined}
            disabled={busy}
            style={styles.dialogButton}
            onPress={onConfirm}
          >
            {busy ? (
              <ActivityIndicator color={destructive ? colors.error : colors.brand} />
            ) : (
              <Text
                style={[
                  desktopTypography.control,
                  { color: destructive ? colors.error : colors.brand, fontWeight: '600' },
                ]}
              >
                {t(action.kind === 'leave' ? 'spaces_leave_room' : 'confirm')}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </DesktopDialog>
  )
}

export function DesktopRoomMemberDetailDialog({
  member,
  members,
  onClose,
}: {
  member: RoomMemberView | null
  members: RoomMemberView[]
  onClose(): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  if (!member) return null
  const agent = member.principalType === 'agent'
  const owner = agent
    ? (members.find(
        (candidate) =>
          candidate.principalType === 'human' &&
          (candidate.id === member.parentHumanMembershipId ||
            candidate.ownerUserId === member.ownerUserId),
      ) ?? null)
    : null
  const participation = getRoomMemberParticipation(member)
  const status = participation ? t(`spaces_agent_status_full_${participation}`) : null
  return (
    <DesktopDialog title={member.displayAlias} onClose={onClose}>
      <View
        testID={`desktop-room-member-detail-${member.id}`}
        accessibilityRole="summary"
        style={styles.dialogContent}
      >
        <View style={styles.memberDialogHeader}>
          <View style={[styles.detailAvatar, { backgroundColor: colors.surfaceHover }]}>
            <Text style={[styles.detailAvatarText, { color: colors.text }]}>
              {member.displayAlias.trim().slice(0, 1).toUpperCase() || '?'}
            </Text>
          </View>
          <View style={styles.memberCopy}>
            <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
              {t(agent ? 'spaces_member_kind_agent' : `spaces_role_${member.role}`)}
            </Text>
          </View>
        </View>
        {agent ? (
          <View style={[styles.memberDetails, { borderTopColor: colors.border }]}>
            <DetailField
              label={t('spaces_agent_description')}
              value={member.description?.trim() || t('spaces_agent_description_empty')}
            />
            {status ? <DetailField label={t('spaces_agent_work_mode')} value={status} /> : null}
            {owner ? <DetailField label={t('spaces_member_owner')} value={owner.displayAlias} /> : null}
          </View>
        ) : null}
      </View>
    </DesktopDialog>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.detailField}>
      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
    </View>
  )
}

export function DesktopRoomRenameDialog({
  visible,
  value,
  busy,
  failed,
  onChange,
  onCancel,
  onConfirm,
}: {
  visible: boolean
  value: string
  busy: boolean
  failed: boolean
  onChange(value: string): void
  onCancel(): void
  onConfirm(): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const inputRef = useRef<TextInput>(null)
  if (!visible) return null
  return (
    <DesktopDialog
      title={t('spaces_settings_name')}
      onClose={onCancel}
      busy={busy}
      initialFocusRef={inputRef}
    >
      <View testID="desktop-room-rename-dialog" style={styles.dialogContent}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          editable={!busy}
          accessibilityLabel={t('spaces_settings_name')}
          accessibilityState={{ disabled: busy }}
          style={[styles.input, desktopTypography.body, { color: colors.text, borderColor: colors.border }]}
        />
        {failed ? (
          <Text accessibilityRole="alert" style={[desktopTypography.body, { color: colors.error }]}>
            {t('spaces_rename_failed')}
          </Text>
        ) : null}
        <View style={styles.dialogActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={styles.dialogButton}
            onPress={onCancel}
          >
            <Text style={[desktopTypography.control, { color: colors.text }]}>{t('cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('confirm')}
            accessibilityState={{ disabled: busy || !value.trim(), busy }}
          accessibilityHint={busy ? t('desktop_dialog_busy') : undefined}
            disabled={busy || !value.trim()}
            style={styles.dialogButton}
            onPress={onConfirm}
          >
            <Text
              style={[
                desktopTypography.control,
                {
                  color: value.trim() ? colors.brand : colors.textTertiary,
                  fontWeight: '600',
                },
              ]}
            >
              {t('confirm')}
            </Text>
          </Pressable>
        </View>
      </View>
    </DesktopDialog>
  )
}
