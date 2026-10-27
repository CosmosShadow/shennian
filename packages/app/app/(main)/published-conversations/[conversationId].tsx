// @arch docs/features/published-agent-direct-conversations.md

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as Crypto from 'expo-crypto'
import { ApiError } from '@shennian/shared/api'
import { AppPageHeader } from '../../../src/components/AppPageHeader'
import { useAuthStore } from '../../../src/config/auth'
import { readMyPublishedConversation, sendOwnerPublishedConversation,
  resumeMyPublishedConversation, sendMyPublishedConversation,
  type MyPublishedConversationDetail, type PublishedConversationMessage } from '../../../src/features/published-agents/directConversationClient'
import { publishedAgentFailureCopyKey } from '../../../src/features/published-agents/failureCopyKey'
import { useTheme } from '../../../src/hooks/useTheme'
import { PublishedConversationBubble } from '../../../src/features/published-agents/PublishedConversationBubble'
import { canSendPublishedMessage } from '../../../src/features/published-agents/conversationPresentation'
import Ionicons from '@expo/vector-icons/Ionicons'
import { pickStandbyFiles } from '../../../src/features/steward/standbyFiles'
import { uploadDirectDraftAttachment, validateDirectDraftFiles, prepareDirectDraftFiles, type DirectDraftAttachment } from '../../../src/features/published-agents/directConversationAttachments'
import { refreshOwnerDirectUnread } from '../../../src/features/published-agents/useOwnerDirectUnread'

const copy = {
  zh: { title: '对外智能体对话', older: '查看更早消息', loading: '正在读取…',
    failed: '暂时无法读取对话，请重试。', retry: '重试', send: '发送',
    placeholder: '输入消息…', visitor: '访客', me: '我', replyAs: '以 {{name}} 身份回复',
    ownerPlaceholder: '以 {{name}} 身份输入回复…', ownerUnavailable: '暂时不能回复，历史仍可查看。',
    paused: '此智能体已暂停，历史仍可查看。',
    visitorPaused: '这段对话已暂停，不能继续发送；其他访客不受影响。',
    resume: '恢复这段对话',
    unavailable: '此智能体暂不可用，历史仍可查看。',
    revoked: '链接已撤销，历史仍可查看。',
    pending: '排队中', running: '回复中', failedMessage: '回复失败',
    cancelled: '已停止', sendFailed: '发送结果未确认；重试会使用同一条消息 ID。',
    limitReached: '这个智能体今天的消息额度已用完，额度在 UTC 00:00 重置。',
    timeout: '智能体回复超时，请稍后再发一条消息。',
    emptyReply: '智能体未返回可见回复，请稍后再试。',
    runtimeUnavailable: '创建者的智能体当前无法安全运行。',
    providerLimit: '创建者的模型额度或调用速率已达到上限，请稍后再试。',
    retryExhausted: '多次尝试仍未成功，请稍后再试。',
    unauthorizedToolAttempt: '这次请求被安全策略拦截，请换一种方式重新提问。',
    offline: '创建者客户端离线；你仍可发送消息，客户端重新连接后会继续处理。',
    creatorViewed: '创建者已查看此对话',
    attach: '添加附件', file: '文件', media: '照片或视频', camera: '拍照', cancel: '取消',
    attachmentFailed: '附件未能发送，请检查文件后重试（最多 5 个，共 100 MB；图片最多 20 MB）。',
    removeAttachment: '移除附件', privacy: '创建者可查看对话内容。' },
  en: { title: 'Published Agent chat', older: 'Load earlier messages', loading: 'Loading…',
    failed: 'Could not load this conversation. Please retry.', retry: 'Retry', send: 'Send',
    placeholder: 'Write a message…', visitor: 'Visitor', me: 'Me', replyAs: 'Reply as {{name}}',
    ownerPlaceholder: 'Write a reply as {{name}}…', ownerUnavailable: 'Replies are unavailable. History is still available.',
    paused: 'This Agent is paused. History is still available.',
    visitorPaused: 'This conversation is paused. You cannot send; other visitors are unaffected.',
    resume: 'Resume this conversation',
    unavailable: 'This Agent is unavailable. History is still available.',
    revoked: 'The link was revoked. History is still available.',
    pending: 'Queued', running: 'Replying', failedMessage: 'Reply failed',
    cancelled: 'Stopped', sendFailed: 'Send result is uncertain. Retry uses the same message ID.',
    limitReached: 'This agent has reached its daily message limit. The limit resets at 00:00 UTC.',
    timeout: 'The agent timed out. Please send another message later.',
    emptyReply: 'The agent returned no visible reply. Please try again later.',
    runtimeUnavailable: 'The creator’s agent cannot run safely right now.',
    providerLimit: 'The creator’s model quota or rate limit has been reached. Please try again later.',
    retryExhausted: 'Several attempts failed. Please try again later.',
    unauthorizedToolAttempt: 'This request was blocked by a safety policy. Please rephrase and try again.',
    offline: 'The creator is offline. You can send a message; it will be handled after reconnection.',
    creatorViewed: 'The creator has viewed this conversation',
    attach: 'Add attachment', file: 'Files', media: 'Photos or videos', camera: 'Camera', cancel: 'Cancel',
    attachmentFailed: 'Could not send attachments. Retry with up to 5 files, 100 MB total; images up to 20 MB.',
    removeAttachment: 'Remove attachment', privacy: 'The creator can read this conversation.' },
} as const

function mergeMessages(current: PublishedConversationMessage[], incoming: PublishedConversationMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((left, right) => BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1)
}

export default function MyPublishedConversation() {
  const { conversationId = '', perspective: requestedPerspective } = useLocalSearchParams<{ conversationId: string; perspective?: string }>()
  const perspective = requestedPerspective === 'owner' ? 'owner' : undefined
  const accountId = useAuthStore((state) => state.user?.id)
  const router = useRouter()
  const { i18n } = useTranslation()
  const t = i18n.language.startsWith('zh') ? copy.zh : copy.en
  const failureText = (code: string | null | undefined) => {
    const key = publishedAgentFailureCopyKey(code)
    return key ? t[key] : t.failedMessage
  }
  const { colors } = useTheme()
  const [conversation, setConversation] = useState<MyPublishedConversationDetail | null>(null)
  const [loadedFor, setLoadedFor] = useState<{ accountId: string; conversationId: string; perspective?: 'owner' } | null>(null)
  const [messages, setMessages] = useState<PublishedConversationMessage[]>([])
  const messagesRef = useRef<PublishedConversationMessage[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<DirectDraftAttachment[]>([])
  const [picking, setPicking] = useState(false)
  const attachmentScope = useRef(0)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const pendingMessageId = useRef<string | null>(null)
  const scroll = useRef<ScrollView>(null)
  const scrollToLatest = useRef(true)
  const scopeMatches = Boolean(accountId && loadedFor?.accountId === accountId
    && loadedFor.conversationId === conversationId && loadedFor.perspective === perspective)
  const visibleConversation = scopeMatches ? conversation : null
  const visibleMessages = scopeMatches ? messages : []
  const visibleNextBefore = scopeMatches ? nextBefore : null

  useEffect(() => { messagesRef.current = messages }, [messages])

  const refreshLatest = useCallback(async (replace = false) => {
    const request = generation.current
    try {
      const unsettled = replace ? undefined : messagesRef.current.find((message) =>
        message.status === 'pending' || message.status === 'running')
      const [result, unsettledPage] = await Promise.all([
        readMyPublishedConversation(conversationId, { before: 'latest' }, perspective),
        unsettled ? readMyPublishedConversation(conversationId, {
          after: (BigInt(unsettled.sequence) - 1n).toString(),
        }, perspective) : Promise.resolve(null),
      ])
      if (request !== generation.current) return
      if (result.conversation.id !== conversationId || !accountId) throw new Error('conversation_mismatch')
      setLoadedFor({ accountId, conversationId, perspective })
      setConversation(result.conversation)
      if (result.conversation.role === 'owner' && (replace || result.messages.some((message) =>
        message.authorRole === 'visitor' && !messagesRef.current.some((current) => current.id === message.id)))) {
        void refreshOwnerDirectUnread()
      }
      setMessages((current) => replace ? result.messages
        : mergeMessages(current, [...(unsettledPage?.messages ?? []), ...result.messages]))
      if (replace) setNextBefore(result.nextBefore ?? null)
      if (replace) setError('')
    } catch {
      if (request === generation.current && replace) setError(t.failed)
    } finally {
      if (request === generation.current && replace) setLoading(false)
    }
  }, [accountId, conversationId, perspective, t.failed])

  useEffect(() => {
    generation.current += 1
    setLoadedFor(null)
    setConversation(null)
    setMessages([])
    messagesRef.current = []
    setNextBefore(null)
    setDraft('')
    setAttachments([])
    setPicking(false)
    attachmentScope.current += 1
    setError('')
    pendingMessageId.current = null
    scrollToLatest.current = true
    return () => { generation.current += 1 }
  }, [accountId, conversationId, perspective])

  useFocusEffect(useCallback(() => {
    generation.current += 1
    setSending(false)
    setLoadingOlder(false)
    setLoading(true)
    if (accountId && conversationId) void refreshLatest(true)
    const timer = setInterval(() => {
      if (accountId && conversationId) void refreshLatest()
    }, 3_000)
    return () => { generation.current += 1; clearInterval(timer) }
  }, [accountId, conversationId, refreshLatest]))

  const loadOlder = async () => {
    if (!visibleNextBefore || loadingOlder) return
    const request = generation.current
    setLoadingOlder(true)
    try {
      const result = await readMyPublishedConversation(conversationId, { before: visibleNextBefore }, perspective)
      if (request !== generation.current) return
      setMessages((current) => mergeMessages(current, result.messages))
      setNextBefore(result.nextBefore ?? null)
    } catch { if (request === generation.current) setError(t.failed) }
    finally { if (request === generation.current) setLoadingOlder(false) }
  }

  const send = async () => {
    const text = draft.trim()
    if ((!text && !attachments.length) || picking || text.length > 20_000 || sending || !visibleConversation
      || !canSendPublishedMessage(visibleConversation)) return
    const request = generation.current
    const clientMessageId = pendingMessageId.current ?? Crypto.randomUUID()
    pendingMessageId.current = clientMessageId
    setSending(true)
    setError('')
    try {
      const attachmentIds: string[] = []
      for (const file of attachments) {
        const id = await uploadDirectDraftAttachment(conversationId, file)
        if (request !== generation.current) return
        attachmentIds.push(id)
        setAttachments((current) => current.map((item) => item.clientUploadId === file.clientUploadId
          ? { ...item, uploadedId: id } : item))
      }
      const result = visibleConversation.role === 'owner'
        ? await sendOwnerPublishedConversation(conversationId, text, clientMessageId, attachmentIds)
        : await sendMyPublishedConversation(visibleConversation.publicId!, text, clientMessageId, attachmentIds)
      if (request !== generation.current) return
      if (result.conversationId !== conversationId) throw new Error('conversation_mismatch')
      pendingMessageId.current = null
      setDraft('')
      setAttachments([])
      scrollToLatest.current = true
      await refreshLatest()
    } catch (error) {
      if (request === generation.current) setError(error instanceof ApiError && error.status === 429
        ? t.limitReached : attachments.length ? t.attachmentFailed : t.sendFailed)
    }
    finally { if (request === generation.current) setSending(false) }
  }

  const pickAttachment = async (kind: 'file' | 'media' | 'camera') => {
    if (sending || picking) return
    const scope = attachmentScope.current
    setPicking(true)
    try {
      const files = prepareDirectDraftFiles(await pickStandbyFiles(kind))
      if (scope !== attachmentScope.current) return
      validateDirectDraftFiles([...attachments, ...files])
      setAttachments((current) => [...current, ...files.map((file) => ({ ...file, clientUploadId: Crypto.randomUUID() }))])
      pendingMessageId.current = null
    } catch { if (scope === attachmentScope.current) setError(t.attachmentFailed) }
    finally { if (scope === attachmentScope.current) setPicking(false) }
  }

  const unavailable = visibleConversation?.status === 'paused' ? t.visitorPaused
    : visibleConversation?.publicationStatus === 'paused' ? t.paused
    : visibleConversation?.publicationStatus === 'revoked' ? t.revoked : t.unavailable
  const canSend = canSendPublishedMessage(visibleConversation)
  const isOwner = visibleConversation?.role === 'owner'
  const agentName = visibleConversation?.displayName ?? ''
  const visitorName = visibleConversation?.visitorName || t.visitor
  const composerLabel = t.replyAs.replace('{{name}}', agentName)
  const placeholder = isOwner ? t.ownerPlaceholder.replace('{{name}}', agentName) : t.placeholder

  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
    <AppPageHeader title={isOwner ? visitorName : visibleConversation?.displayName ?? t.title} onBack={() => router.back()} />
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={styles.messages}
        onContentSizeChange={() => {
          if (scrollToLatest.current && !loading) {
            scroll.current?.scrollToEnd({ animated: false })
            scrollToLatest.current = false
          }
        }}>
        {loading ? <ActivityIndicator color={colors.brand} /> : null}
        {visibleConversation?.role === 'visitor'
          ? <Text style={{ color: colors.textSecondary, fontSize: 12, alignSelf: 'center' }}>{t.privacy}</Text>
          : null}
        {visibleNextBefore ? <Pressable accessibilityRole="button" disabled={loadingOlder}
          onPress={() => void loadOlder()} style={styles.older}>
          <Text style={{ color: colors.brand }}>{loadingOlder ? t.loading : t.older}</Text>
        </Pressable> : null}
        {visibleMessages.map((message) => <PublishedConversationBubble key={message.id}
          message={message} role={isOwner ? 'owner' : 'visitor'} agentName={agentName}
          visitorName={isOwner ? visitorName : t.me} conversationId={conversationId}
          onDownloadError={() => setError(t.failed)}
          statusText={message.status === 'pending' ? t.pending : message.status === 'running' ? t.running
            : message.status === 'failed' ? failureText(message.failureCode) : message.status === 'cancelled' ? t.cancelled : ''} />)}
        {visibleConversation?.role === 'visitor' && visibleConversation.ownerLastViewedAt
          ? <Text style={{ color: colors.textSecondary, fontSize: 11, alignSelf: 'center' }}>
              {t.creatorViewed} · {new Date(visibleConversation.ownerLastViewedAt).toLocaleString(i18n.language)}
            </Text> : null}
        {error ? error === t.sendFailed || error === t.limitReached || error === t.attachmentFailed
          ? <Text style={{ color: colors.error }}>{error}</Text>
          : <Pressable accessibilityRole="button" onPress={() => void refreshLatest(true)}>
            <Text style={{ color: colors.error }}>{error} {t.retry}</Text>
          </Pressable> : null}
      </ScrollView>
      {visibleConversation?.role === 'visitor' && !canSend ? <Text style={[styles.notice, { color: colors.textSecondary }]}>
        {unavailable}</Text> : null}
      {visibleConversation?.role === 'owner' && visibleConversation.status === 'paused'
        ? <Pressable accessibilityRole="button" disabled={resuming}
          onPress={() => {
            setResuming(true)
            void resumeMyPublishedConversation(conversationId)
              .then(() => refreshLatest(true))
              .catch(() => setError(t.failed))
              .finally(() => setResuming(false))
          }} style={styles.notice}>
          <Text style={{ color: colors.brand }}>{t.resume}</Text>
        </Pressable> : null}
      {isOwner && !canSend && visibleConversation?.status !== 'paused'
        ? <Text style={[styles.notice, { color: colors.textSecondary }]}>{t.ownerUnavailable}</Text> : null}
      {canSend && !isOwner && visibleConversation?.machineOnline === false
        ? <Text style={[styles.notice, { color: colors.textSecondary }]}>{t.offline}</Text> : null}
      {canSend ? <View style={[styles.composer, { borderTopColor: colors.border }]}>
        {attachments.length ? <View style={styles.attachments}>
          {attachments.map((file) => <Pressable key={file.clientUploadId} disabled={sending || picking}
            accessibilityRole="button" accessibilityLabel={`${t.removeAttachment}: ${file.name}`}
            onPress={() => { setAttachments((current) => current.filter((item) => item.clientUploadId !== file.clientUploadId)); pendingMessageId.current = null }}>
            <Text style={{ color: colors.brand }} numberOfLines={1}>{file.name} ×</Text>
          </Pressable>)}
        </View> : null}
        <View style={styles.composerRow}>
        {visibleConversation?.canAttach ? <Pressable accessibilityRole="button" accessibilityLabel={t.attach}
          testID="published-add-attachment" disabled={sending || picking} style={styles.attach}
          onPress={() => Alert.alert(t.attach, undefined, [
            { text: t.media, onPress: () => void pickAttachment('media') },
            { text: t.camera, onPress: () => void pickAttachment('camera') },
            { text: t.file, onPress: () => void pickAttachment('file') },
            { text: t.cancel, style: 'cancel' },
          ])}>
          {picking ? <ActivityIndicator color={colors.brand} /> : <Ionicons name="add" size={26} color={colors.textSecondary} />}
        </Pressable> : null}
        <TextInput value={draft} editable={!sending} onChangeText={(value) => {
          if (value !== draft) pendingMessageId.current = null
          setDraft(value)
        }} multiline maxLength={20_000} placeholder={placeholder} accessibilityLabel={isOwner ? composerLabel : placeholder}
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
        <Pressable accessibilityRole="button" disabled={(!draft.trim() && !attachments.length) || sending || picking}
          onPress={() => void send()} style={styles.send}>
          <Text style={{ color: colors.brand }}>{sending ? t.loading : t.send}</Text>
        </Pressable>
        </View>
      </View> : null}
    </KeyboardAvoidingView>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, messages: { flexGrow: 1, padding: 16, gap: 14, justifyContent: 'flex-start' },
  older: { alignSelf: 'center', padding: 10 }, notice: { paddingHorizontal: 16, paddingVertical: 10 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  attachments: { gap: 8, padding: 8 },
  attach: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  send: { minHeight: 48, minWidth: 56, justifyContent: 'center', alignItems: 'center' },
})
