// @arch docs/features/network-rooms/ui.md#六移动端
// @test src/__tests__/room-management-panel.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../config/auth'
import { roomApprovalCounts } from '../roomApprovalCounts'
import { useTheme } from '../../../hooks/useTheme'
import { subscribeRoomEvents } from '../roomEvents'
import type { RoomDetailView } from '../types'
import { roomAccountClient, type RoomJoinRequest } from '../roomAccountClient'
import { mobileTypography } from '../../../theme/mobileTypography'

export function RoomAdminPanel({
  roomId,
  room,
  onRoomUpdated,
  onDissolved,
  onOpenManageMembers,
}: {
  roomId: string
  room: RoomDetailView
  onRoomUpdated: (room: RoomDetailView) => void
  onDissolved: () => void
  onOpenManageMembers?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const loadRevision = useRef(0)
  const [requests, setRequests] = useState<RoomJoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [joinPolicy, setJoinPolicy] = useState(room.joinPolicy)

  const load = useCallback(
    async (silent = false) => {
      const revision = ++loadRevision.current
      if (!silent) setLoading(true)
      try {
        const pending = await roomAccountClient.listPendingJoinRequests(roomId)
        if (revision !== loadRevision.current) return
        setRequests(pending)
        if (accountId) roomApprovalCounts.set(accountId, roomId, pending.length)
        setFailed(false)
      } catch {
        if (revision !== loadRevision.current) return
        setFailed(true)
      } finally {
        if (revision === loadRevision.current) setLoading(false)
      }
    },
    [accountId, roomId],
  )

  useEffect(() => void load(), [load])
  useEffect(
    () =>
      subscribeRoomEvents((event) => {
        if (event.event === 'room.sync.request') return
        if (
          event.event === 'room.replica.updated' &&
          (event.roomId === null || event.roomId === roomId)
        ) {
          void load(true)
          return
        }
        if (event.roomId === roomId && event.event.startsWith('room.join_request.')) void load(true)
      }),
    [load, roomId],
  )

  const update = async (patch: {
    joinPolicy?: RoomDetailView['joinPolicy']
  }) => {
    setBusy(true)
    try {
      const updatedRoom = await roomAccountClient.updateRoom(roomId, patch)
      onRoomUpdated({ ...room, ...updatedRoom })
      return true
    } catch {
      setFailed(true)
      return false
    } finally {
      setBusy(false)
    }
  }

  const changeJoinPolicy = async (next: RoomDetailView['joinPolicy']) => {
    const previous = joinPolicy
    setJoinPolicy(next)
    if (!(await update({ joinPolicy: next }))) setJoinPolicy(previous)
  }

  const review = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(true)
    try {
      await roomAccountClient.reviewJoinRequest(roomId, id, decision)
      ++loadRevision.current
      const remaining = requests.filter((item) => item.id !== id)
      setRequests(remaining)
      await load(true)
    } finally {
      setBusy(false)
    }
  }

  const dissolve = () =>
    Alert.alert(t('spaces_dissolve_room'), t('spaces_dissolve_room_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('spaces_dissolve_room'),
        style: 'destructive',
        onPress: () => void roomAccountClient.deleteRoom(roomId).then(onDissolved),
      },
    ])

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    )
  return (
    <ScrollView style={[styles.root, { backgroundColor: Platform.OS === 'web' ? colors.bg : colors.groupedBackground }]} contentContainerStyle={styles.content}>
      {failed ? (
        <Text style={[styles.error, { color: Platform.OS === 'web' ? colors.error : colors.errorText }]}>
          {t('spaces_manage_load_failed')}
        </Text>
      ) : null}
      {Platform.OS !== 'web' ? <Text style={[styles.section, { color: colors.textSecondary }]}>{t('mobile_join_method')}</Text> : null}
      <View style={[styles.sectionBlock, Platform.OS !== 'web' && styles.nativeSectionBlock,
        { backgroundColor: Platform.OS === 'web' ? colors.bg : colors.groupedSurface }]}>
        <JoinPolicyRow value={joinPolicy} disabled={busy} onChange={changeJoinPolicy} />
      </View>
      {Platform.OS !== 'web' && onOpenManageMembers ? <>
        <Text style={[styles.section, { color: colors.textSecondary }]}>{t('mobile_member_management')}</Text>
        <Pressable accessibilityRole="button" testID="room-manage-members-entry"
          onPress={onOpenManageMembers} style={[styles.memberAction, { backgroundColor: colors.groupedSurface }]}>
          <Text style={[styles.label, { color: colors.text }]}>{t('mobile_remove_members')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>
      </> : null}
      {requests.length > 0 ? (
        <>
          <Text style={[styles.section, { color: colors.textSecondary }]}>
            {t('spaces_pending_requests')}
          </Text>
          <View testID="room-invitation-requests" style={{ backgroundColor: colors.bg }}>
            {requests.map((request) => (
              <View key={request.id} style={[styles.request, { borderBottomColor: colors.border }]}>
                <View style={styles.requestCopy}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>
                    {request.applicant.name}
                  </Text>
                  {request.message ? (
                    <Text style={{ color: colors.textSecondary, marginTop: 2 }}>
                      {request.message}
                    </Text>
                  ) : null}
                </View>
                <Pressable onPress={() => void review(request.id, 'reject')}>
                  <Text style={{ color: colors.error }}>{t('spaces_request_reject')}</Text>
                </Pressable>
                <Pressable onPress={() => void review(request.id, 'approve')}>
                  <Text style={{ color: colors.brand }}>{t('spaces_request_approve')}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}
      <Pressable testID="room-dissolve-action" style={[styles.danger, Platform.OS !== 'web' && styles.nativeDanger,
        { backgroundColor: Platform.OS === 'web' ? 'transparent' : colors.groupedSurface }]} onPress={dissolve}>
        <Text style={[styles.dangerText, { color: Platform.OS === 'web' ? colors.error : colors.errorText }]}>{t(Platform.OS === 'web' ? 'spaces_dissolve_room' : 'mobile_dissolve_conversation')}</Text>
      </Pressable>
    </ScrollView>
  )
}

function JoinPolicyRow({
  value,
  disabled,
  onChange,
}: {
  value: RoomDetailView['joinPolicy']
  disabled: boolean
  onChange: (value: RoomDetailView['joinPolicy']) => Promise<void>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const options = [
    { value: 'open' as const, label: t('spaces_join_open') },
    { value: 'approval' as const, label: t('spaces_join_approval') },
    { value: 'closed' as const, label: t('spaces_join_closed') },
  ]
  const selectedOption = options.find((option) => option.value === value) ?? { value, label: String(value) }
  return (
    <View testID="room-join-policy" style={styles.policyRow}>
      <Pressable
        testID="room-join-policy-toggle"
        accessibilityRole="button"
        accessibilityLabel={t('spaces_join_policy_title')}
        accessibilityValue={{ text: selectedOption.label }}
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={() => setExpanded((current) => !current)}
        style={styles.policyHeader}
      >
        <Text style={[styles.label, { color: colors.text }]}>{t('spaces_join_policy_title')}</Text>
        <Text style={[styles.policyValue, { color: colors.textSecondary }]}>
          {selectedOption.label}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textSecondary}
        />
      </Pressable>
      {expanded ? (
        <View accessibilityRole="radiogroup" style={styles.policyOptions}>
          {options.map((option) => {
            const selected = value === option.value
            return (
              <Pressable
                key={option.value}
                testID={`room-join-policy-${option.value}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  setExpanded(false)
                  if (!selected) void onChange(option.value)
                }}
                style={({ pressed }) => [
                  styles.policyOption,
                  { borderBottomColor: colors.border },
                  pressed && { backgroundColor: colors.surfaceHover },
                ]}
              >
                <Text style={[styles.policyLabel, { color: colors.text }]}>{option.label}</Text>
                {selected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 38 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { padding: 14, textAlign: 'center', ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  sectionBlock: { paddingHorizontal: 20 },
  nativeSectionBlock: { marginHorizontal: 16, borderRadius: 12 },
  section: { fontSize: 12, lineHeight: 17, paddingHorizontal: 20, paddingVertical: 8, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  memberAction: { minHeight: 56, marginHorizontal: 16, borderRadius: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    minHeight: 56,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 16, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.body) },
  policyRow: { borderBottomWidth: 0 },
  policyHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  policyOptions: { paddingBottom: 8 },
  policyOption: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  policyValue: { flex: 1, fontSize: 13, lineHeight: 19, textAlign: 'right', ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  policyLabel: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '500', ...(Platform.OS !== 'web' && mobileTypography.body) },
  request: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  requestCopy: { flex: 1 },
  danger: { minHeight: 44, marginTop: 24, alignItems: 'center', justifyContent: 'center' },
  nativeDanger: { minHeight: 56, marginHorizontal: 16, marginTop: 36, borderRadius: 12 },
  dangerText: { fontSize: 16, ...(Platform.OS !== 'web' && mobileTypography.body) },
})
