// @arch docs/features/published-agent-direct-conversations.md#32-访客单智能体网页--app
// @test src/__tests__/plaza-agent-detail-presentation.test.ts
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../../src/components/AppPageHeader'
import { RoomIdentityAvatar } from '../../../src/features/rooms/components/RoomIdentityAvatar'
import { contactAccountClient } from '../../../src/features/contacts/contactAccountClient'
import { plazaAccountClient, type PlazaAgent } from '../../../src/features/contacts/plazaAccountClient'
import { useTheme } from '../../../src/hooks/useTheme'

export default function PlazaAgentDetailScreen() {
  const { publicId } = useLocalSearchParams<{ publicId: string }>()
  const router = useRouter()
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const [agent, setAgent] = useState<PlazaAgent | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const detail = await plazaAccountClient.get(publicId)
      setAgent(detail.agent)
      const contacts = await contactAccountClient.list().catch(() => null)
      setSaved(Boolean(contacts?.contacts.some((item) => item.agentIdentityId === detail.agent.agentIdentityId)))
      if (detail.agent.requireContactApproval) {
        const request = await contactAccountClient.getPublicAgentRequestStatus(publicId)
        setPending(request.status === 'pending')
        if (request.status === 'added') setSaved(true)
      } else setPending(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [publicId])
  useFocusEffect(useCallback(() => { void load() }, [load]))
  const save = async () => {
    if (!agent || saving || saved) return
    setSaving(true)
    try {
      if (agent.requireContactApproval) {
        const result = await contactAccountClient.requestPublicAgent(agent.publicId)
        setPending(result.outcome === 'pending_approval')
        if (result.outcome === 'already_added') setSaved(true)
      } else {
        await contactAccountClient.savePublicAgent(agent.publicId)
        setSaved(true)
      }
    } catch {
      Alert.alert('', t('mobile_save_contact_failed'))
    } finally {
      setSaving(false)
    }
  }
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={agent?.displayName ?? t('mobile_ai_detail')} onBack={() => router.back()} />
    {loading ? <ActivityIndicator style={styles.state} color={colors.brand} /> : failed || !agent ?
      <Pressable style={styles.state} onPress={() => void load()}><Text style={{ color: colors.textSecondary }}>{t('mobile_plaza_load_failed')}</Text><Text style={{ color: colors.brand }}>{t('retry')}</Text></Pressable> :
      <ScrollView contentContainerStyle={styles.content}>
        <RoomIdentityAvatar name={agent.displayName} avatar={agent.avatar} agent size={82} />
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{agent.displayName}</Text>
          <Text style={[styles.aiBadge, { color: colors.brand, backgroundColor: colors.surfaceHover }]}>AI</Text>
        </View>
        <Text style={[styles.status, { color: agent.machineOnline ? colors.successText : colors.textSecondary }]}>
          {t(agent.machineOnline ? 'machine_online' : 'machine_offline')}
        </Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{agent.description}</Text>
        <View style={styles.actions}>
          <Pressable style={[styles.primary, { backgroundColor: (saved || (agent.allowNewContacts && !agent.requireContactApproval)) && agent.status === 'active' ? colors.brand : colors.textSecondary }]} disabled={(!saved && (!agent.allowNewContacts || agent.requireContactApproval)) || agent.status !== 'active'} onPress={() => router.navigate({
            pathname: '/(main)/published-conversations/new', params: { publicId: agent.publicId },
          })}>
            <Text style={styles.primaryText}>{(saved || (agent.allowNewContacts && !agent.requireContactApproval)) && agent.status === 'active'
              ? t('mobile_start_ai_chat') : i18n.language.startsWith('zh') ? '暂不可发起对话' : 'Chat unavailable'}</Text>
          </Pressable>
          {!saved && agent.allowNewContacts ? (
            <Pressable style={[styles.secondary, { backgroundColor: colors.surfaceHover }]} onPress={() => void save()} disabled={saving || pending}>
              <Text style={[styles.secondaryText, { color: colors.brand }]}>{pending
                ? (i18n.language.startsWith('zh') ? '审核中' : 'Pending review')
                : agent.requireContactApproval
                  ? (i18n.language.startsWith('zh') ? '申请添加' : 'Request to add')
                  : t('mobile_save_contact')}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>}
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, state: { marginTop: 32, textAlign: 'center', alignItems: 'center', gap: 8 },
  content: { alignItems: 'center', padding: 24, paddingTop: 32 },
  nameRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
  name: { fontSize: 23, fontWeight: '700', flexShrink: 1 },
  aiBadge: { fontSize: 12, fontWeight: '600', overflow: 'hidden', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  status: { fontSize: 13, marginTop: 5 }, description: { alignSelf: 'stretch', fontSize: 15, lineHeight: 23, marginTop: 28 },
  actions: { alignSelf: 'stretch', flexDirection: 'row', gap: 10, marginTop: 30 },
  primary: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondary: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
})
