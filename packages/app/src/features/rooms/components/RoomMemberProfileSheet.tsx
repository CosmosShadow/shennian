// @arch docs/features/network-rooms/ui.md#54-消息
// @test src/__tests__/room-conversation-screen.test.ts

import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import BottomSheet from '../../../components/BottomSheet'
import { useTheme } from '../../../hooks/useTheme'
import type { RoomMemberView } from '../types'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'
import { getRoomMemberParticipation } from '../roomPresentation'
import { RoomAgentModePicker } from './RoomAgentModePicker'
import { RoomAgentParticipationEntry } from './RoomAgentParticipationEntry'
import { roomAccountClient } from '../roomAccountClient'
import { canChangeRoomAgentMode } from '../roomAgentMode'
import { mobileTypography } from '../../../theme/mobileTypography'
import { isRoomAgentIdentityDimmed } from './roomAgentStatusPresentation'
import { peopleAccountClient, type PersonProfile } from '../../contacts/peopleAccountClient'
import { contactAccountClient } from '../../contacts/contactAccountClient'

export function RoomMemberProfileSheet({
  member,
  members,
  visible,
  roomId,
  currentUserId,
  onMemberUpdated,
  onClose,
}: {
  member: RoomMemberView | null
  members: RoomMemberView[]
  visible: boolean
  roomId?: string
  currentUserId?: string | null
  onMemberUpdated?: (member: RoomMemberView) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [choosingMode, setChoosingMode] = useState(false)
  const [person, setPerson] = useState<PersonProfile | null>(null)
  const [personLoading, setPersonLoading] = useState(false)
  const [personFailed, setPersonFailed] = useState(false)
  const [savingContact, setSavingContact] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [personReload, setPersonReload] = useState(0)
  useEffect(() => { setChoosingMode(false) }, [visible, member?.id])
  const personUserId = visible && currentUserId && member?.principalType === 'human' &&
    member.ownerUserId !== currentUserId ? member.ownerUserId : null
  useEffect(() => {
    setPerson(null)
    setPersonFailed(false)
    setSaveFailed(false)
    setSavingContact(false)
    if (!personUserId) { setPersonLoading(false); return }
    let active = true
    setPersonLoading(true)
    void peopleAccountClient.get(personUserId).then(({ person: next }) => {
      if (active) setPerson(next)
    }).catch(() => {
      if (active) setPersonFailed(true)
    }).finally(() => {
      if (active) setPersonLoading(false)
    })
    return () => { active = false }
  }, [personUserId, personReload])
  const saveContact = async () => {
    if (!personUserId || !person || person.savedContactId || savingContact) return
    setSavingContact(true)
    setSaveFailed(false)
    try {
      const { contactId } = await contactAccountClient.saveHuman(personUserId)
      setPerson((current) => current?.userId === personUserId
        ? { ...current, savedContactId: contactId } : current)
    } catch {
      setSaveFailed(true)
    } finally {
      setSavingContact(false)
    }
  }
  const agent = member?.principalType === 'agent'
  const participation = getRoomMemberParticipation(member)
  const offline = isRoomAgentIdentityDimmed(participation)
  const paused =
    member?.ownBinding?.activationMode === 'paused' ||
    member?.agentParticipation?.activationMode === 'paused'
  const status = participation
    ? t(paused ? 'spaces_agent_status_full_paused' : `spaces_agent_status_full_${participation}`)
    : null
  const action = Boolean(roomId && canChangeRoomAgentMode(member, currentUserId))
  const actionLabel = t('spaces_agent_work_mode')
  const owner =
    member && agent
      ? (members.find(
          (candidate) =>
            candidate.principalType === 'human' &&
            (candidate.id === member.parentHumanMembershipId ||
              candidate.ownerUserId === member.ownerUserId),
        ) ?? null)
      : null


  if (visible && roomId && member?.principalType === 'agent' && member.ownerUserId === currentUserId && member.agentIdentityId) {
    return <RoomAgentParticipationEntry roomId={roomId} members={members} agentIdentityId={member.agentIdentityId}
      visible onClose={onClose} onUpdated={() => void roomAccountClient.listMembers(roomId).then((updated) => {
        const next = updated.find((item) => item.id === member.id)
        if (next) onMemberUpdated?.(next)
        else onClose()
      }).catch(() => {})} />
  }
  return (
    <BottomSheet
      isOpen={visible && Boolean(member)}
      onClose={onClose}
      title={t(choosingMode ? 'spaces_agent_work_mode' : 'spaces_member_profile')}
      preferDialogOnWeb
      avoidKeyboard={false}
    >
      {choosingMode && action && roomId && member?.agentIdentityId && member.ownBinding?.nianSessionId ? (
        <RoomAgentModePicker inline target={{ roomId, roomName: '', agentIdentityId: member.agentIdentityId,
          sessionId: member.ownBinding.nianSessionId }} onClose={() => setChoosingMode(false)} onUpdated={onMemberUpdated} />
      ) : member ? (
        <View testID={`room-member-profile-${member.id}`} style={styles.content}>
          <View style={styles.identityHeader}>
            <RoomIdentityAvatar
              name={member.displayAlias}
              avatar={member.avatar}
              agent={agent}
              ownerAvatar={member.ownerAvatar}
              ownerName={member.ownerDisplayName}
              size={56}
              offline={offline}
            />
            <View style={styles.identityCopy}>
              <Text
                style={[styles.name, { color: offline ? colors.textTertiary : colors.text }]}
                numberOfLines={2}
              >
                {member.displayAlias}
              </Text>
              {agent ? (
                <Text style={[styles.kindText, { color: colors.textSecondary }]}>
                  {t('spaces_member_kind_agent')}
                </Text>
              ) : null}
            </View>
          </View>
          {agent ? (
            <View style={[styles.details, { borderTopColor: colors.border }]}>
              {member.description?.trim() ? (
                <ProfileField
                  label={t('agents_public_description')}
                  value={member.description.trim()}
                />
              ) : null}
              {status ? (
                <ProfileField label={t('spaces_agent_work_mode')} value={status} />
              ) : null}
              {owner ? (
                <View style={styles.relationSection}>
                  <Text style={[styles.label, { color: Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary }]}>
                    {t('spaces_member_owner')}
                  </Text>
                  <OwnerRow member={owner} />
                </View>
              ) : null}
            </View>
          ) : null}
          {personUserId ? (
            <View style={[styles.details, { borderTopColor: colors.border }]}>
              {person?.description?.trim() ? <ProfileField
                label={t('mobile_personal_introduction')}
                value={person.description.trim()}
              /> : null}
              {personLoading ? <ActivityIndicator color={colors.brand} /> : personFailed ? (
                <Pressable accessibilityRole="button" onPress={() => setPersonReload((value) => value + 1)}
                  style={styles.personRetry}>
                  <Text style={{ color: colors.textSecondary }}>{t('mobile_person_load_failed')}</Text>
                  <Text style={{ color: colors.brand }}>{t('retry')}</Text>
                </Pressable>
              ) : person ? (
                <Pressable testID="room-member-save-contact" accessibilityRole="button"
                  disabled={Boolean(person.savedContactId) || savingContact}
                  onPress={() => void saveContact()}
                  style={[styles.action, { backgroundColor: colors.brand,
                    opacity: person.savedContactId ? 0.55 : 1 }]}>
                  {savingContact ? <ActivityIndicator color="#fff" /> :
                    <Text style={styles.actionText}>{t(person.savedContactId ? 'mobile_contact_saved' : 'mobile_add_contact')}</Text>}
                </Pressable>
              ) : null}
              {saveFailed ? <Text style={[styles.actionError, { color: colors.error }]}>
                {t('mobile_save_contact_failed')}
              </Text> : null}
            </View>
          ) : null}
          {action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={actionLabel ?? undefined}
              onPress={() => setChoosingMode(true)}
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: colors.brand },
                pressed && styles.actionPressed,
              ]}
            >
              <Text style={styles.actionText}>{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  )
}

function OwnerRow({ member }: { member: RoomMemberView }) {
  const { colors } = useTheme()
  return (
    <View style={styles.memberRow}>
      <RoomIdentityAvatar
        name={member.displayAlias}
        avatar={member.avatar}
        agent={false}
        size={32}
      />
      <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
        {member.displayAlias}
      </Text>
    </View>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { alignItems: 'stretch', paddingTop: 4, paddingBottom: 8 },
  identityHeader: {
    width: '100%',
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  name: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  kindText: { marginTop: 4, fontSize: 13, lineHeight: 19, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  action: {
    minHeight: 44,
    minWidth: 148,
    marginTop: 24,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: { opacity: 0.62 },
  actionText: { color: '#fff', fontSize: 15, lineHeight: 20, fontWeight: '600' },
  details: {
    width: '100%',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 20,
  },
  field: { gap: 4 },
  label: { fontSize: 12, lineHeight: 17, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  value: { fontSize: 15, lineHeight: 22, ...(Platform.OS !== 'web' && mobileTypography.body) },
  relationSection: { gap: 4 },
  personRetry: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  actionError: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  memberRow: {
    minHeight: 40,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberName: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.listTitle) },
})
