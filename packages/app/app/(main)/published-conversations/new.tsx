import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as Crypto from 'expo-crypto'
import { AppPageHeader } from '../../../src/components/AppPageHeader'
import { api } from '../../../src/config/api'
import { listMyPublishedConversations, sendMyPublishedConversation } from '../../../src/features/published-agents/directConversationClient'
import { RoomIdentityAvatar } from '../../../src/features/rooms/components/RoomIdentityAvatar'
import { useTheme } from '../../../src/hooks/useTheme'

type SharedAgent = { publicId: string; displayName: string; description: string;
  avatar: { smallUrl: string; mediumUrl: string } | null; status: 'active' | 'paused' | 'unavailable' }

export default function NewPublishedConversationScreen() {
  const { publicId = '' } = useLocalSearchParams<{ publicId: string }>()
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [agent, setAgent] = useState<SharedAgent | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const messageId = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const existing = await listMyPublishedConversations()
      const conversation = existing.conversations.find((item) => item.publicId === publicId)
      if (conversation) {
        router.replace({ pathname: '/(main)/published-conversations/[conversationId]',
          params: { conversationId: conversation.id } })
        return
      }
      const detail = await api<{ publication: SharedAgent }>(`/published-agents/${encodeURIComponent(publicId)}`)
      setAgent(detail.publication)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [publicId, router])
  useFocusEffect(useCallback(() => { void load() }, [load]))

  const send = async () => {
    const text = draft.trim()
    if (!agent || agent.status !== 'active' || !text || text.length > 20_000 || sending) return
    setSending(true)
    setSendFailed(false)
    const clientMessageId = messageId.current ?? Crypto.randomUUID()
    messageId.current = clientMessageId
    try {
      const result = await sendMyPublishedConversation(agent.publicId, text, clientMessageId)
      messageId.current = null
      router.replace({ pathname: '/(main)/published-conversations/[conversationId]',
        params: { conversationId: result.conversationId } })
    } catch {
      setSendFailed(true)
    } finally {
      setSending(false)
    }
  }

  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={agent?.displayName ?? t('mobile_start_ai_chat')} onBack={() => router.back()} />
    {loading ? <ActivityIndicator style={styles.state} color={colors.brand} /> : failed || !agent ?
      <Pressable style={styles.state} onPress={() => void load()}><Text style={{ color: colors.textSecondary }}>{t('mobile_plaza_load_failed')}</Text><Text style={{ color: colors.brand }}>{t('retry')}</Text></Pressable> :
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.intro}>
          <RoomIdentityAvatar name={agent.displayName} avatar={agent.avatar} agent size={66} />
          <Text style={[styles.name, { color: colors.text }]}>{agent.displayName}</Text>
          <Text style={[styles.note, { color: colors.textSecondary }]}>{t('mobile_ai_owner_notice')}</Text>
        </View>
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <TextInput value={draft} onChangeText={(value) => { setDraft(value); messageId.current = null; setSendFailed(false) }}
            multiline placeholder={t('mobile_ai_chat_placeholder')} placeholderTextColor={colors.textTertiary}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceHover }]} />
          <Pressable accessibilityRole="button" disabled={!draft.trim() || sending || agent.status !== 'active'}
            onPress={() => void send()} style={[styles.send, { backgroundColor: colors.brand, opacity: !draft.trim() || sending ? 0.5 : 1 }]}>
            <Text style={styles.sendText}>{t('send')}</Text>
          </Pressable>
        </View>
        {sendFailed ? <Text style={[styles.error, { color: colors.error }]}>{t('mobile_ai_send_failed')}</Text> : null}
      </KeyboardAvoidingView>}
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, body: { flex: 1, justifyContent: 'space-between' },
  state: { marginTop: 32, alignItems: 'center', gap: 8 },
  intro: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 38, gap: 12 },
  name: { fontSize: 21, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  send: { minWidth: 58, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  error: { margin: 10, fontSize: 13 },
})
