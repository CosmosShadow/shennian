import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../src/components/ConnectedAppPageHeader'
import { useAuthStore } from '../../src/config/auth'
import { profileAccountClient } from '../../src/features/account/profileAccountClient'
import { ProfileAvatarEditor } from '../../src/features/profile/components/ProfileAvatarEditor'
import { peopleAccountClient } from '../../src/features/contacts/peopleAccountClient'
import { PersonalIdentityQr } from '../../src/features/contacts/PersonalIdentityQr'
import { useTheme } from '../../src/hooks/useTheme'
import { hydrateMyProfile, refreshMyProfile, seedMyProfile, useMyProfileStore } from '../../src/config/myProfile'

export default function PersonalProfileScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { colors, isDark } = useTheme()
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const refreshToken = useAuthStore((state) => state.refreshToken)
  const login = useAuthStore((state) => state.login)
  const [editing, setEditing] = useState<'name' | 'description' | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const profile = useMyProfileStore((s) => (s.userId === user?.id ? s.profile : null))
  const [profileFailed, setProfileFailed] = useState(false)

  const load = useCallback(async () => {
    setProfileFailed(false)
    try {
      await refreshMyProfile(user?.id)
    } catch { setProfileFailed(true) }
  }, [user?.id])
  useFocusEffect(useCallback(() => {
    void hydrateMyProfile(user?.id).then(() => load())
  }, [load, user?.id]))
  const visibleProfile = profile?.person.userId === user?.id ? profile : null

  const openEditor = () => {
    setDraft(user?.name ?? '')
    setEditing('name')
  }
  const openIntroduction = () => {
    if (!visibleProfile) return
    setDraft(visibleProfile.person.description)
    setEditing('description')
  }
  const save = async () => {
    if (saving || !editing || (editing === 'name' && !draft.trim())) return
    setSaving(true)
    try {
      if (editing === 'name') {
        const updated = await profileAccountClient.updateProfile(draft.trim())
        if (token && refreshToken) await login(token, refreshToken, updated)
        void load()
      } else {
        const updated = await peopleAccountClient.updateMine(draft)
        if (user?.id) seedMyProfile(user.id, updated)
      }
      setEditing(null)
    } catch {
      Alert.alert('', t(editing === 'name' ? 'profile_nickname_save_failed' : 'mobile_introduction_save_failed'))
    } finally {
      setSaving(false)
    }
  }

  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={t('mobile_personal_profile')} onBack={() => router.back()} />
    <ScrollView style={{ backgroundColor: isDark ? colors.bg : colors.surfaceHover }} contentContainerStyle={styles.content}>
      {visibleProfile?.qrPayload ? <PersonalIdentityQr value={visibleProfile.qrPayload} name={visibleProfile.person.displayName}
        header={<>
          <View style={styles.avatarWrap}>
            <ProfileAvatarEditor t={t} size={84} />
            <View pointerEvents="none" style={[styles.cameraBadge, { backgroundColor: colors.brand, borderColor: colors.surface }]}>
              <Ionicons name="camera" size={13} color="#fff" />
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('profile_nickname')} onPress={openEditor} hitSlop={6}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{user?.name || t('profile_nickname_unset')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('mobile_personal_introduction')} onPress={openIntroduction} hitSlop={6}>
            <Text style={[styles.intro, { color: visibleProfile.person.description ? colors.textSecondary : colors.textTertiary }]} numberOfLines={2}>
              {visibleProfile.person.description || t('mobile_introduction_empty')}
            </Text>
          </Pressable>
        </>} /> : profileFailed ? <Pressable onPress={() => void load()} style={styles.retry}>
        <Text style={{ color: colors.textSecondary }}>{t('mobile_person_load_failed')}</Text>
        <Text style={{ color: colors.brand }}>{t('retry')}</Text>
      </Pressable> : <ActivityIndicator style={styles.retry} color={colors.textTertiary} />}
    </ScrollView>
    <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditing(null)} />
        <View style={[styles.dialog, { backgroundColor: colors.groupedSurface }]}>
          <View style={styles.dialogHeader}>
            <Text style={[styles.dialogTitle, { color: colors.text }]}>{t(editing === 'description' ? 'mobile_personal_introduction' : 'profile_nickname')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('cancel')} onPress={() => setEditing(null)} disabled={saving} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <TextInput value={draft} onChangeText={setDraft} autoFocus maxLength={editing === 'description' ? 1000 : 40}
            multiline={editing === 'description'} returnKeyType={editing === 'description' ? 'default' : 'done'}
            onSubmitEditing={editing === 'name' ? () => void save() : undefined}
            placeholder={t(editing === 'description' ? 'mobile_introduction_placeholder' : 'profile_nickname_placeholder')}
            placeholderTextColor={colors.textTertiary} textAlignVertical="top"
            style={[styles.input, editing === 'description' && styles.introductionInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]} />
          <Text style={[styles.counter, { color: colors.textTertiary }]}>{draft.length}/{editing === 'description' ? 1000 : 40}</Text>
          <Pressable accessibilityRole="button" onPress={() => void save()} disabled={saving || (editing === 'name' && !draft.trim())}
            style={[styles.saveButton, { backgroundColor: colors.brand }, (saving || (editing === 'name' && !draft.trim())) && styles.saveDisabled]}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{t('save')}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { padding: 16, paddingTop: 20, paddingBottom: 56 },
  avatarWrap: { width: 84, height: 84 },
  cameraBadge: { position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 14, fontSize: 24, fontWeight: '700', letterSpacing: 0.2 },
  intro: { marginTop: 6, fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 260 },
  retry: { alignItems: 'center', gap: 5, padding: 10 },
  overlay: { flex: 1, backgroundColor: '#0007', justifyContent: 'flex-end' },
  dialog: { width: '100%', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 30, gap: 12 },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dialogTitle: { fontSize: 20, fontWeight: '600' }, closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  introductionInput: { minHeight: 120, maxHeight: 200 }, counter: { alignSelf: 'flex-end', fontSize: 12 },
  saveButton: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  saveDisabled: { opacity: 0.45 }, saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
