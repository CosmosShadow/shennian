import { routeString } from '../../../src/utils/runtimeValues'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import * as Crypto from 'expo-crypto'
import { AppPageHeader } from '../../../src/components/AppPageHeader'
import { RoomIdentityAvatar } from '../../../src/features/rooms/components/RoomIdentityAvatar'
import { contactAccountClient, type SavedContact } from '../../../src/features/contacts/contactAccountClient'
import { readSavedContactsCache, removeSavedContactFromCache, writeSavedContactsCache } from '../../../src/features/contacts/savedContactsCache'
import { useAuthStore } from '../../../src/config/auth'
import { roomContactInvitationClient } from '../../../src/features/contacts/roomContactInvitationClient'
import { publishRoomSyncRequest } from '../../../src/features/rooms/roomEvents'
import { useTheme } from '../../../src/hooks/useTheme'

export default function ContactDetailScreen() {
  const params = useLocalSearchParams<{ contactId: string }>()
  const contactId = routeString(params.contactId)
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const [contact, setContact] = useState<SavedContact | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [conversationAvailable, setConversationAvailable] = useState(false)
  const [conversationRoomId, setConversationRoomId] = useState<string | null>(null)
  const [conversationBlocked, setConversationBlocked] = useState(false)
  const operationId = useRef(Crypto.randomUUID())
  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    const cached = await readSavedContactsCache(accountId)
    const cachedContact = cached?.find((item) => item.id === contactId) ?? null
    if (cachedContact) {
      setContact(cachedContact)
      setLoading(false)
    }
    try {
      const result = await contactAccountClient.list()
      await writeSavedContactsCache(accountId, result.contacts).catch(() => {})
      const selected = result.contacts.find((item) => item.id === contactId) ?? null
      const invitationLookup = selected?.kind === 'human' && selected.userId
        ? await roomContactInvitationClient.listSent(selected.userId)
          .then((value) => ({ available: true, invitation: value.sentInvitations[0] ?? null }))
          .catch(() => ({ available: false, invitation: null }))
        : { available: false, invitation: null }
      const invitationState = invitationLookup.invitation
      setContact(selected)
      setConversationAvailable(invitationLookup.available)
      setConversationRoomId(invitationState?.status === 'accepted' ? invitationState.roomId : null)
      setConversationBlocked(invitationState?.status === 'declined')
    } catch {
      if (!cachedContact) setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [accountId, contactId])
  useFocusEffect(useCallback(() => { void load() }, [load]))
  const remove = () => {
    if (!contact || removing) return
    Alert.alert(t('mobile_remove_contact'), t('mobile_remove_contact_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('mobile_remove_contact'), style: 'destructive', onPress: () => {
        setRemoving(true)
        void contactAccountClient.remove(contact.id).then(async () => {
          await removeSavedContactFromCache(accountId, contact.id).catch(() => {})
          router.back()
        }).catch(() => {
          Alert.alert('', t('mobile_remove_contact_failed'))
        }).finally(() => setRemoving(false))
      } },
    ])
  }
  const startConversation = async () => {
    if (!contact?.userId || contact.kind !== 'human' || starting || conversationBlocked || !conversationAvailable) return
    if (conversationRoomId) {
      router.navigate({ pathname: '/(main)/room-workspace', params: { roomId: conversationRoomId } })
      return
    }
    setStarting(true)
    try {
      const result = await roomContactInvitationClient.create(contact.displayName, [contact.userId], operationId.current)
      const outcome = result.invitations.find((item) => item.targetUserId === contact.userId)
      if (!outcome || outcome.status === 'declined') throw new Error('invitation_missing')
      publishRoomSyncRequest('tab-focused')
      router.navigate({ pathname: '/(main)/room-workspace', params: { roomId: result.room.id } })
    } catch {
      Alert.alert('', t('mobile_invitation_failed'))
    } finally {
      setStarting(false)
    }
  }
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={t('mobile_contact_detail')} onBack={() => router.back()} />
    {loading ? <ActivityIndicator style={styles.state} color={colors.brand} /> : failed ?
      <Pressable style={styles.state} onPress={() => void load()}><Text style={{ color: colors.textSecondary }}>{t('mobile_contacts_load_failed')}</Text><Text style={{ color: colors.brand }}>{t('retry')}</Text></Pressable> :
      contact ? <ScrollView contentContainerStyle={styles.content}>
        <RoomIdentityAvatar name={contact.displayName} avatar={contact.avatar} agent={contact.kind === 'agent'} size={76} />
        <Text style={[styles.name, { color: colors.text }]}>{contact.displayName}</Text>
        <Text style={[styles.kind, { color: colors.textSecondary }]}>{t(contact.kind === 'human' ? 'mobile_human' : 'mobile_ai')}</Text>
        <Text style={[styles.help, { color: colors.textSecondary }]}>{t('mobile_saved_contact_hint')}</Text>
        {contact.kind === 'human' && contact.userId ? <>
          <Pressable onPress={() => void startConversation()}
            disabled={starting || conversationBlocked || !conversationAvailable} accessibilityRole="button"
            style={[styles.start, { backgroundColor: colors.brand, opacity: conversationAvailable && !conversationBlocked ? 1 : 0.45 }]}>
            <Text style={styles.startText}>{t(conversationBlocked ? 'mobile_invitation_closed' : conversationRoomId ? 'mobile_open_conversation' : 'mobile_start_conversation')}</Text>
          </Pressable>
        </> : null}
        {contact.kind === 'agent' && !contact.owned && contact.publicId ? <Pressable
          accessibilityRole="button" onPress={() => router.navigate({
            pathname: '/(main)/published-conversations/new', params: { publicId: contact.publicId! },
          })}
          style={[styles.start, { backgroundColor: colors.brand }]}>
          <Text style={styles.startText}>{t('mobile_start_ai_chat')}</Text>
        </Pressable> : null}
        <Pressable style={[styles.remove, { backgroundColor: colors.groupedSurface }]} onPress={remove} disabled={removing} accessibilityRole="button">
          <Text style={[styles.removeText, { color: colors.error }]}>{t('mobile_remove_contact')}</Text>
        </Pressable>
      </ScrollView> : <Text style={[styles.state, { color: colors.textSecondary }]}>{t('mobile_contact_not_found')}</Text>}
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, state: { marginTop: 32, textAlign: 'center', alignItems: 'center', gap: 8 },
  content: { alignItems: 'center', padding: 24, paddingTop: 32 },
  name: { fontSize: 23, fontWeight: '700', marginTop: 14 }, kind: { fontSize: 14, marginTop: 5 },
  help: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 28 },
  start: { alignSelf: 'stretch', borderRadius: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  startText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  remove: { alignSelf: 'stretch', borderRadius: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 32 },
  removeText: { fontSize: 15, fontWeight: '600' },
})
