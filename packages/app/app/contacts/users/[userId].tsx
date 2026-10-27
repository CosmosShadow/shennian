import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../../src/components/ConnectedAppPageHeader'
import { useAuthStore } from '../../../src/config/auth'
import { contactAccountClient } from '../../../src/features/contacts/contactAccountClient'
import { peopleAccountClient, type PersonProfileResponse } from '../../../src/features/contacts/peopleAccountClient'
import { RoomIdentityAvatar } from '../../../src/features/rooms/components/RoomIdentityAvatar'
import { useTheme } from '../../../src/hooks/useTheme'

export default function PersonShareRoute() {
  const { userId = '' } = useLocalSearchParams<{ userId: string }>()
  const authenticated = useAuthStore((state) => state.isAuthenticated)
  const viewerId = useAuthStore((state) => state.user?.id ?? '')
  if (!authenticated) return <Redirect href={{ pathname: '/(auth)/login',
    params: { redirect: `/contacts/users/${encodeURIComponent(userId)}` } }} />
  return <PersonShareScreen key={`${viewerId}:${userId}`} userId={userId} />
}

function PersonShareScreen({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const { colors } = useTheme()
  const ownUserId = useAuthStore((state) => state.user?.id)
  const [response, setResponse] = useState<PersonProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try { setResponse(await peopleAccountClient.get(userId)) }
    catch { setFailed(true) }
    finally { setLoading(false) }
  }, [userId])
  useFocusEffect(useCallback(() => { void load() }, [load]))
  const person = response?.person
  const save = async () => {
    if (!person || person.savedContactId || ownUserId === person.userId || saving) return
    setSaving(true)
    try {
      const result = await contactAccountClient.saveHuman(person.userId)
      setResponse((current) => current ? { ...current, person: { ...current.person, savedContactId: result.contactId } } : current)
    } catch { Alert.alert('', t('mobile_save_contact_failed')) }
    finally { setSaving(false) }
  }
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={t('mobile_contact_detail')} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {loading && !response ? <ActivityIndicator color={colors.brand} /> : failed ?
        <Pressable onPress={() => void load()} style={styles.state}>
          <Text style={{ color: colors.textSecondary }}>{t('mobile_person_load_failed')}</Text>
          <Text style={{ color: colors.brand }}>{t('retry')}</Text>
        </Pressable> : person ? <>
          <View style={[styles.hero, { backgroundColor: colors.groupedSurface }]}>
            <RoomIdentityAvatar name={person.displayName} avatar={person.avatar} size={72} />
            <Text style={[styles.name, { color: colors.text }]}>{person.displayName}</Text>
            {person.description ? <Text style={[styles.introduction, { color: colors.textSecondary }]}>{person.description}</Text> : null}
          </View>
          {ownUserId !== person.userId ? <Pressable accessibilityRole="button" onPress={() => void save()}
            disabled={Boolean(person.savedContactId) || saving} style={[styles.action, { backgroundColor: colors.brand,
              opacity: person.savedContactId ? 0.55 : 1 }]}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionText}>{t(person.savedContactId ? 'mobile_contact_saved' : 'mobile_save_contact')}</Text>}
          </Pressable> : null}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('mobile_saved_contact_hint')}</Text>
        </> : null}
    </ScrollView>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { padding: 18, gap: 16 },
  state: { alignItems: 'center', gap: 9, paddingTop: 40 },
  hero: { borderRadius: 14, alignItems: 'center', padding: 24, gap: 12 },
  name: { fontSize: 21, fontWeight: '600' }, introduction: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  action: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '600' }, hint: { fontSize: 13, lineHeight: 19 },
})
