import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { contactAccountClient, type SavedContact } from '../../contacts/contactAccountClient'
import { roomContactInvitationClient } from '../../contacts/roomContactInvitationClient'
import { useTheme } from '../../../hooks/useTheme'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'

export function RoomContactInvitePanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const [contacts, setContacts] = useState<SavedContact[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [available, setAvailable] = useState(false)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await contactAccountClient.list()
      setContacts(result.contacts.filter((item) => item.kind === 'human' && !item.owned && item.userId))
      setAvailable(true)
    } catch {
      setAvailable(false)
      setStatus(t('mobile_contacts_load_failed'))
    } finally {
      setLoading(false)
    }
  }, [t])
  useEffect(() => { if (open) void load() }, [load, open])

  const toggle = (userId: string) => setSelected((current) => current.includes(userId)
    ? current.filter((id) => id !== userId)
    : current.length < 20 ? [...current, userId] : current)
  const send = async () => {
    if (!available || !selected.length || sending) return
    setSending(true)
    setStatus('')
    try {
      const result = await roomContactInvitationClient.inviteExisting(roomId, selected)
      setSelected([])
      setStatus(t(result.invitations.some((item) => item.status === 'joined')
        ? 'mobile_invitation_joined' : 'mobile_invitation_already_member'))
    } catch {
      setStatus(t('mobile_invitation_failed'))
    } finally {
      setSending(false)
    }
  }
  return <View style={[styles.card, { backgroundColor: colors.groupedSurface }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
      onPress={() => { setOpen((value) => !value); setStatus('') }} style={styles.header}>
      <Text style={[styles.heading, { color: colors.text }]}>{t('mobile_invite_saved_contacts')}</Text>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
    </Pressable>
    {open ? <>
      {loading ? <ActivityIndicator color={colors.brand} style={styles.state} />
        : available ? contacts.length ? contacts.map((contact) => <Pressable key={contact.id}
          accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(contact.userId!) }}
          onPress={() => toggle(contact.userId!)} style={[styles.row, { borderTopColor: colors.groupedSeparator }]}>
          <RoomIdentityAvatar name={contact.displayName} avatar={contact.avatar} size={36} />
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{contact.displayName}</Text>
          <Ionicons name={selected.includes(contact.userId!) ? 'checkmark-circle' : 'ellipse-outline'}
            size={23} color={selected.includes(contact.userId!) ? colors.brand : colors.textTertiary} />
        </Pressable>) : <Text style={[styles.state, { color: colors.textSecondary }]}>{t('mobile_no_invitable_contacts')}</Text>
          : <Pressable onPress={() => void load()} style={styles.state}><Text style={{ color: colors.brand }}>{t('retry')}</Text></Pressable>}
      {selected.length ? <Pressable onPress={() => void send()} disabled={sending}
        style={[styles.submit, { backgroundColor: colors.brand }]}>
        <Text style={styles.submitText}>{t('mobile_invite_selected', { count: selected.length })}</Text>
      </Pressable> : null}
      {status ? <Text style={[styles.state, { color: colors.textSecondary }]}>{status}</Text> : null}
    </> : null}
  </View>
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, overflow: 'hidden', marginTop: 16 },
  header: { minHeight: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 16 },
  row: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1, fontSize: 15 }, state: { padding: 16, textAlign: 'center' },
  submit: { minHeight: 44, margin: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
