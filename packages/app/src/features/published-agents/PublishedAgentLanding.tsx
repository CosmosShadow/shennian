// @arch docs/features/published-agent-direct-conversations.md

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { copy } from './landingCopy'
import { shouldSendOnEnter } from './composerKeyboard'
import { ReplyDots } from './ReplyDots'
import { visibleMessages, waitingForReply, type Message } from './conversationPresentation'
import Head from 'expo-router/head'
import Svg, { Path } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import * as Clipboard from 'expo-clipboard'
import { ApiError } from '@shennian/shared/api'
import { api } from '../../config/api'
import { getServerUrl } from '../../config/server'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useAuthPublicConfig } from '../auth/hooks/useAuthPublicConfig'
import { usePhoneLogin } from '../auth/hooks/usePhoneLogin'
import { offerScopedNicknameSetup, type ScopedNicknameSetup } from '../auth/offerNicknameSetup'
import { PhoneLoginPanel } from '../auth/components/PhoneLoginPanel'
import { TencentCaptchaModal } from '../../components/auth/TencentCaptchaModal'
import { publishedAgentFailureCopyKey } from './failureCopyKey'
import { SimpleMessageMarkdown } from '../../components/chat/SimpleMessageMarkdown'

type Publication = {
  publicId: string
  status: 'active' | 'paused' | 'unavailable'
  machineOnline: boolean
  displayName: string
  description: string
  suggestedQuestions?: string[]
  avatar: { smallUrl: string; mediumUrl: string } | null
  creatorCanReadConversation: true
  requireContactApproval: boolean
  allowAnonymousVisitors: boolean
}
type DraftAttachment = { id: string; file: File; uploadedId?: string }
type ConversationPage = {
  conversation: { id: string; status: string; ownerLastViewedAt: string | null } | null
  messages: Message[]
  nextAfter?: string | null
  nextBefore?: string | null
}

export function PublishedAgentLanding({ publicId }: { publicId: string }) {
  const accountUserId = useAuthStore((state) => state.isAuthenticated ? state.user?.id ?? null : null)
  return <PublishedAgentLandingForAccount key={`${publicId}:${accountUserId ?? 'signed-out'}`}
    publicId={publicId} accountUserId={accountUserId} />
}

function PublishedAgentLandingForAccount({ publicId, accountUserId }: {
  publicId: string; accountUserId: string | null
}) {
  const { i18n } = useTranslation()
  const { colors } = useTheme()
  const authConfig = useAuthPublicConfig()
  const t = i18n.language.startsWith('zh') ? copy.zh : copy.en
  const failureText = (code: string | null | undefined) => {
    const key = publishedAgentFailureCopyKey(code)
    return key ? t[key] : t.failed
  }
  const [publication, setPublication] = useState<Publication | null>(null)
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [scopedUserId, setScopedUserId] = useState<string | null>(null)
  const [scopedPublicId, setScopedPublicId] = useState<string | null>(null)
  const [scopedKind, setScopedKind] = useState<'account' | 'anonymous'>('account')
  const [accountReady, setAccountReady] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [usingAccount, setUsingAccount] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [localMessage, setLocalMessage] = useState<Message | null>(null)
  const timelineMessages = visibleMessages(messages, localMessage)
  const [conversationStatus, setConversationStatus] = useState('active')
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [conversationError, setConversationError] = useState('')
  const [sendError, setSendError] = useState('')
  const [sendRetryable, setSendRetryable] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([])
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [showAiDialog, setShowAiDialog] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  const [viewportTop, setViewportTop] = useState(0)
  const [sending, setSending] = useState(false)
  const [contactStatus, setContactStatus] = useState<'none' | 'pending' | 'added' | null>(null)
  const [requestingContact, setRequestingContact] = useState(false)
  const [contactRequestError, setContactRequestError] = useState('')
  const pendingMessageId = useRef<string | null>(null)
  const lastSequence = useRef('0')
  const messagesRef = useRef<Message[]>([])
  const timelineRef = useRef<ScrollView>(null)
  const inputRef = useRef<TextInput>(null)
  const stickToBottomRef = useRef(true)
  const conversationLoading = useRef(false)
  const conversationEpoch = useRef(0)
  const visiblePublication = publication?.publicId === publicId ? publication : null
  const hasScopedAccess = authenticated && scopedPublicId === publicId
    && (scopedKind === 'anonymous' || !accountUserId || scopedUserId === accountUserId)
  const directAccess = visiblePublication?.status === 'active'
    && visiblePublication.allowAnonymousVisitors
  const needsLogin = !hasScopedAccess && !directAccess
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const viewport = window.visualViewport
    const oldOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const update = () => {
      setViewportHeight(Math.round(viewport?.height ?? window.innerHeight))
      setViewportTop(Math.round(viewport?.offsetTop ?? 0))
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      document.documentElement.style.overflow = oldOverflow
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  const clearConversation = () => {
    conversationEpoch.current += 1
    messagesRef.current = []
    lastSequence.current = '0'
    pendingMessageId.current = null
    setMessages([])
    setLocalMessage(null)
    setConversationStatus('active')
    setOlderCursor(null)
    setDraft('')
    setDraftAttachments([])
    setSending(false)
    setConversationError('')
    setSendError('')
    setSendRetryable(false)
  }
  const phoneLogin = usePhoneLogin({
    captchaAppId: authConfig.tencentCaptchaAppId ?? '',
    verifyIdentity: async (phone, code) => {
      const result = await api<{ userId: string; nicknameSetup?: ScopedNicknameSetup }>(
        `/published-agents/${publicId}/browser/verify-phone`, {
          method: 'POST', credentials: 'include',
          body: JSON.stringify({ phone, code }),
        },
      )
      clearConversation()
      setScopedUserId(result.userId)
      setScopedPublicId(publicId)
      setScopedKind('account')
      setAuthenticated(true)
      await offerScopedNicknameSetup(result.nicknameSetup)
    },
  })

  useEffect(() => {
    if (useAuthStore.getState().isAuthenticated) {
      setAccountReady(true)
      return
    }
    let mounted = true
    void useAuthStore.getState().loadFromStorage().catch(() => {}).finally(() => {
      if (mounted) setAccountReady(true)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    clearConversation()
    if (!/^[A-Za-z0-9_-]{32}$/.test(publicId)) {
      setLoading(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    const refresh = () => {
      void api<{ publication: Publication }>(`/published-agents/${publicId}`, {
        signal: controller.signal,
      }).then((value) => {
        if (!cancelled && value.publication.publicId === publicId) setPublication(value.publication)
      }).catch((error) => {
        if (!cancelled && error instanceof ApiError && error.status === 404) setPublication(null)
      }).finally(() => {
        if (!cancelled) setLoading(false)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer) }
  }, [publicId])

  useEffect(() => {
    if (!accountReady) return
    if (!/^[A-Za-z0-9_-]{32}$/.test(publicId)) {
      setCheckingSession(false)
      return
    }
    let cancelled = false
    setCheckingSession(true)
    void api<{ userId: string; accessKind?: 'account' | 'anonymous' }>(`/published-agents/${publicId}/browser/session`, {
      credentials: 'include',
    }).then((session) => {
      if (!cancelled) {
        clearConversation()
        setScopedUserId(session.userId)
        setScopedPublicId(publicId)
        setScopedKind(session.accessKind === 'anonymous' ? 'anonymous' : 'account')
        setAuthenticated(true)
      }
    }).catch(() => {
      if (!cancelled) {
        clearConversation()
        setScopedUserId(null)
        setScopedPublicId(null)
        setAuthenticated(false)
      }
    }).finally(() => {
      if (!cancelled) setCheckingSession(false)
    })
    return () => { cancelled = true }
  }, [accountReady, publicId])

  const useCurrentAccount = async () => {
    if (!accountUserId || usingAccount) return
    setUsingAccount(true)
    setConversationError('')
    try {
      const result = await api<{ userId: string }>(
        `/published-agents/${publicId}/browser/use-account`, {
          method: 'POST', credentials: 'include', body: '{}',
        })
      clearConversation()
      if (result.userId !== accountUserId
        || result.userId !== useAuthStore.getState().user?.id) {
        setAuthenticated(false)
        throw new Error('account_changed')
      }
      setScopedUserId(result.userId)
      setScopedPublicId(publicId)
      setScopedKind('account')
      setAuthenticated(true)
    } catch { setConversationError(t.loadFailed) }
    finally { setUsingAccount(false) }
  }

  const loadConversation = useCallback(async () => {
    if (!hasScopedAccess || conversationLoading.current) return
    const epoch = conversationEpoch.current
    conversationLoading.current = true
    try {
      const firstUnsettled = messagesRef.current.find((message) =>
        message.status === 'pending' || message.status === 'running')
      const tailAfter = lastSequence.current
      const initialPage = messagesRef.current.length === 0 && tailAfter === '0'
      const fetchPage = (after: string) => api<ConversationPage>(
        `/published-agents/${publicId}/browser/conversation?after=${after}`,
        { credentials: 'include' })
      const [tail, unsettledPage] = await Promise.all([
        initialPage
          ? api<ConversationPage>(`/published-agents/${publicId}/browser/conversation?before=latest`,
            { credentials: 'include' })
          : fetchPage(tailAfter),
        firstUnsettled
          ? fetchPage((BigInt(firstUnsettled.sequence) - 1n).toString())
          : Promise.resolve(null),
      ])
      if (epoch !== conversationEpoch.current) return
      setConversationStatus(tail.conversation?.status ?? 'active')
      if (initialPage) setOlderCursor(tail.nextBefore ?? null)
      const incoming = [...(unsettledPage?.messages ?? []), ...tail.messages]
      if (incoming.length) {
        setMessages((old) => {
          if (epoch !== conversationEpoch.current) return old
          const byId = new Map(old.map((message) => [message.id, message]))
          for (const message of incoming) byId.set(message.id, message)
          messagesRef.current = [...byId.values()].sort((a, b) =>
            BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1)
          return messagesRef.current
        })
        if (tail.messages.length
          && BigInt(tail.messages[tail.messages.length - 1]!.sequence) > BigInt(lastSequence.current)) {
          lastSequence.current = tail.messages[tail.messages.length - 1]!.sequence
        }
      }
      setConversationError('')
    } catch (error) {
      if (epoch !== conversationEpoch.current) return
      if (error instanceof ApiError && error.status === 401) setAuthenticated(false)
      else setConversationError(t.loadFailed)
    } finally {
      conversationLoading.current = false
    }
  }, [hasScopedAccess, publicId, t.loadFailed])

  const loadOlder = useCallback(async () => {
    if (!hasScopedAccess || !olderCursor || conversationLoading.current) return
    const epoch = conversationEpoch.current
    conversationLoading.current = true
    try {
      const page = await api<ConversationPage>(
        `/published-agents/${publicId}/browser/conversation?before=${olderCursor}`,
        { credentials: 'include' })
      if (epoch !== conversationEpoch.current) return
      setMessages((old) => {
        if (epoch !== conversationEpoch.current) return old
        const byId = new Map(old.map((message) => [message.id, message]))
        for (const message of page.messages) byId.set(message.id, message)
        messagesRef.current = [...byId.values()].sort((a, b) =>
          BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1)
        return messagesRef.current
      })
      setOlderCursor(page.nextBefore ?? null)
      setConversationError('')
    } catch {
      if (epoch === conversationEpoch.current) setConversationError(t.loadFailed)
    } finally { conversationLoading.current = false }
  }, [hasScopedAccess, olderCursor, publicId, t.loadFailed])

  useEffect(() => {
    if (!hasScopedAccess) return
    void loadConversation()
    const timer = window.setInterval(() => void loadConversation(), 3000)
    return () => window.clearInterval(timer)
  }, [hasScopedAccess, loadConversation])

  useEffect(() => {
    if (!hasScopedAccess || scopedKind === 'anonymous'
      || !visiblePublication?.requireContactApproval) {
      setContactStatus(null)
      return
    }
    let cancelled = false
    const refresh = () => {
      void api<{ status: 'none' | 'pending' | 'added' }>(
        `/published-agents/${publicId}/browser/contact-request`, { credentials: 'include' },
      ).then((result) => { if (!cancelled) setContactStatus(result.status) }).catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [hasScopedAccess, scopedKind, publicId, visiblePublication?.requireContactApproval])

  const requestContact = async () => {
    if (requestingContact || !hasScopedAccess) return
    setRequestingContact(true)
    setContactRequestError('')
    try {
      const result = await api<{ outcome: 'pending_approval' | 'already_added' }>(
        `/published-agents/${publicId}/browser/contact-request`, {
          method: 'POST', credentials: 'include', body: '{}',
        },
      )
      setContactStatus(result.outcome === 'already_added' ? 'added' : 'pending')
    } catch { setContactRequestError(t.requestFailed) }
    finally { setRequestingContact(false) }
  }

  const latestVisibleSequence = timelineMessages[timelineMessages.length - 1]?.id
  useEffect(() => {
    if (!latestVisibleSequence || !stickToBottomRef.current) return
    const frame = requestAnimationFrame(() => timelineRef.current?.scrollToEnd({ animated: false }))
    return () => cancelAnimationFrame(frame)
  }, [latestVisibleSequence])

  const send = useCallback(async () => {
    const text = draft.trim()
    if ((!hasScopedAccess && !directAccess) || (!text && !draftAttachments.length) || sending
      || conversationStatus !== 'active'
      || !visiblePublication || visiblePublication.status === 'unavailable'
      || (scopedKind === 'anonymous' && !visiblePublication.allowAnonymousVisitors)
      || (visiblePublication.requireContactApproval && contactStatus !== 'added')) return
    const epoch = conversationEpoch.current
    const clientMessageId = pendingMessageId.current ?? crypto.randomUUID()
    pendingMessageId.current = clientMessageId
    setSending(true)
    stickToBottomRef.current = true
    const echo: Message = { id: clientMessageId, sequence: '0', authorRole: 'visitor', text,
      status: 'sending', createdAt: new Date().toISOString(),
      attachments: draftAttachments.map(({ id, file }) => ({ attachmentId: id, name: file.name,
        mediaKind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file',
        mimeType: file.type, byteSize: String(file.size), available: false })) }
    setLocalMessage(echo)
    setSendError('')
    setSendRetryable(false)
    try {
      if (!hasScopedAccess) {
        const result = await api<{ userId: string; accessKind: 'anonymous' }>(
          `/published-agents/${publicId}/browser/anonymous`, {
            method: 'POST', credentials: 'include', body: '{}',
          })
        if (epoch !== conversationEpoch.current) return
        setScopedUserId(result.userId)
        setScopedPublicId(publicId)
        setScopedKind('anonymous')
        setAuthenticated(true)
      }
      const attachmentIds: string[] = []
      for (const attachment of draftAttachments) {
        if (attachment.uploadedId) { attachmentIds.push(attachment.uploadedId); continue }
        const bytes = await attachment.file.arrayBuffer()
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        const mimeType = attachment.file.type || 'application/octet-stream'
        const mediaKind = mimeType.startsWith('image/') ? 'image'
          : mimeType.startsWith('video/') ? 'video' : 'file'
        const initialized = await api<{ attachmentId: string; ready: boolean; upload?: {
          url: string; headers: Record<string, string> } }>(
          `/published-agents/${publicId}/browser/attachments/init`, {
            method: 'POST', credentials: 'include',
            body: JSON.stringify({ clientUploadId: attachment.id, name: attachment.file.name,
              mimeType, mediaKind, byteSize: attachment.file.size, sha256 }),
          })
        if (!initialized.ready) {
          if (!initialized.upload?.url.startsWith('https://')) throw new Error('unsafe_upload_url')
          const uploaded = await fetch(initialized.upload.url, { method: 'PUT',
            headers: initialized.upload.headers, body: bytes, redirect: 'error' })
          if (!uploaded.ok) throw new Error('attachment_upload_failed')
          await api(`/published-agents/${publicId}/browser/attachments/${initialized.attachmentId}/complete`, {
            method: 'POST', credentials: 'include', body: '{}',
          })
        }
        attachmentIds.push(initialized.attachmentId)
        setDraftAttachments((previous) => previous.map((item) => item.id === attachment.id
          ? { ...item, uploadedId: initialized.attachmentId } : item))
      }
      const accepted = await api<{ messageId: string; sequence: string; status: string }>(`/published-agents/${publicId}/browser/messages`, {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({ text, attachmentIds, clientMessageId }),
      })
      if (epoch !== conversationEpoch.current) return
      setMessages((previous) => {
        const acknowledged = { ...echo, id: accepted.messageId,
          sequence: accepted.sequence, status: accepted.status }
        const updated = visibleMessages(previous, acknowledged)
        messagesRef.current = updated
        return updated
      })
      setLocalMessage(null)
      setDraft('')
      setDraftAttachments([])
      pendingMessageId.current = null
      if (hasScopedAccess) await loadConversation()
    } catch (error) {
      if (epoch !== conversationEpoch.current) return
      if (error instanceof ApiError && error.status === 401) setAuthenticated(false)
      setLocalMessage((local) => local ? { ...local, status: 'failed' } : null)
      const limited = error instanceof ApiError && error.status === 429
      const unavailable = error instanceof ApiError && error.status === 409
      if (unavailable) {
        if (hasScopedAccess) void loadConversation()
        void api<{ publication: Publication }>(`/published-agents/${publicId}`).then((result) => {
          if (epoch === conversationEpoch.current && result.publication.publicId === publicId) {
            setPublication(result.publication)
          }
        }).catch(() => {})
      }
      setSendError(limited ? t.limitReached : unavailable ? t.sendUnavailable
        : draftAttachments.length ? t.attachmentFailed : t.sendFailed)
      setSendRetryable(!limited && !unavailable
        && !(error instanceof ApiError && error.status === 401))
    } finally { if (epoch === conversationEpoch.current) setSending(false) }
  }, [draft, draftAttachments, hasScopedAccess, directAccess, sending, visiblePublication, scopedKind,
    conversationStatus,
    contactStatus, publicId, loadConversation,
    t.sendFailed, t.sendUnavailable, t.limitReached, t.attachmentFailed])

  useEffect(() => {
    if (Platform.OS !== 'web' || !inputFocused) return
    const input = document.getElementById('published-ai-message-input')
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldSendOnEnter(event)) return
      event.preventDefault()
      event.stopPropagation()
      void send()
    }
    input?.addEventListener('keydown', onKeyDown, true)
    return () => input?.removeEventListener('keydown', onKeyDown, true)
  }, [inputFocused, send])

  const chooseAttachments = (accept: string) => {
    setAttachMenuOpen(false)
    if (Platform.OS !== 'web') return
    const picker = document.createElement('input')
    picker.type = 'file'
    picker.multiple = true
    picker.accept = accept
    picker.onchange = () => {
      const selected = Array.from(picker.files ?? [])
      const combined = [...draftAttachments, ...selected.map((file) => ({ id: crypto.randomUUID(), file }))]
      if (combined.length > 5 || combined.reduce((size, item) => size + item.file.size, 0) > 100 * 1024 * 1024
        || combined.some((item) => item.file.type.startsWith('image/') && item.file.size > 20 * 1024 * 1024)
        || selected.some((file) => file.size < 1 || file.size > 100 * 1024 * 1024)) {
        setSendError(t.attachmentLimit)
        return
      }
      pendingMessageId.current = null
      setDraftAttachments(combined)
      setSendError('')
    }
    picker.click()
  }

  const openAttachment = async (attachmentId: string) => {
    try {
      const data = await api<{ downloadUrl: string }>(
        `/published-agents/${publicId}/browser/attachments/${attachmentId}/download`,
        { credentials: 'include' })
      if (data.downloadUrl.startsWith('https://')) window.open(data.downloadUrl, '_blank', 'noopener,noreferrer')
    } catch { setConversationError(t.loadFailed) }
  }

  const aiInstruction = `${t.aiPrompt}${getServerUrl().replace(/\/+$/, '')}/p/${publicId}`

  return (
    <View style={[styles.root, { backgroundColor: colors.bg },
      Platform.OS === 'web' && viewportHeight ? {
        position: 'fixed', top: viewportTop, left: 0, right: 0, height: viewportHeight,
      } as never : null]}>
      <TencentCaptchaModal
        visible={phoneLogin.captchaVisible}
        appId={authConfig.tencentCaptchaAppId ?? ''}
        onClose={() => phoneLogin.setCaptchaVisible(false)}
        onVerified={phoneLogin.handleCaptchaVerified}
      />
      <Head>
        <title>{visiblePublication?.displayName ?? t.title}</title>
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex,nofollow,noarchive" />
        <style>{'#published-ai-message-input:focus { outline: none !important; box-shadow: none !important; border: 0 !important; }'}</style>
      </Head>
      {visiblePublication && !checkingSession ? (
        <>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerIdentity}>
              <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text }]}>
                {visiblePublication?.displayName ?? t.title}
              </Text>
              {visiblePublication.status !== 'active' || !visiblePublication.machineOnline
                ? <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {visiblePublication.status === 'paused' ? t.statusPaused
                    : visiblePublication.status === 'active' ? t.statusOffline : t.unavailableStatus}
                </Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t.guideButton}
              style={styles.headerAction} onPress={() => { setShowAiDialog(true); setLinkCopied(false) }}>
              <Text style={[styles.headerActionText, { color: colors.textSecondary }]}>{t.guideButton} ↗</Text>
            </Pressable>
          </View>
          <ScrollView ref={timelineRef} style={styles.timeline} contentContainerStyle={styles.timelineContent}
            scrollEventThrottle={100}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
              stickToBottomRef.current = contentSize.height - contentOffset.y
                - layoutMeasurement.height < 80
            }}>
            {visiblePublication?.status === 'unavailable'
              ? <Text style={[styles.status, { color: colors.textSecondary }]}>{t.unavailableStatus}</Text> : null}
            {visiblePublication?.status === 'active' && !visiblePublication.machineOnline
              ? <Text style={[styles.status, { color: colors.textSecondary }]}>{t.offline}</Text> : null}
            {!visiblePublication
              ? <Text style={[styles.status, { color: colors.textSecondary }]}>{t.unavailable}</Text> : null}
            {scopedKind === 'anonymous' && visiblePublication
              && !visiblePublication.allowAnonymousVisitors
              ? <Text style={[styles.status, { color: colors.textSecondary }]}>{t.guestDisabled}</Text> : null}
            {conversationStatus === 'paused'
              ? <Text style={[styles.status, { color: colors.error }]}>{t.visitorPaused}</Text> : null}
            {needsLogin && visiblePublication.status !== 'unavailable'
              ? <View style={[styles.login, { backgroundColor: colors.surface,
                borderColor: colors.border }]}>
                {visiblePublication.description.trim()
                  && visiblePublication.description.trim() !== visiblePublication.displayName.trim()
                  ? <Text style={{ color: colors.textSecondary }}>{visiblePublication.description}</Text> : null}
                <Text style={[styles.loginHeading, { color: colors.text }]}>
                  {visiblePublication.status === 'paused' ? t.loginHistoryTitle : t.loginTitle}
                </Text>
                {accountUserId ? <Pressable accessibilityRole="button"
                  disabled={usingAccount || phoneLogin.loading} style={styles.accountButton}
                  onPress={() => void useCurrentAccount()}>
                  <Text style={{ color: colors.brand }}>{t.useAccount}</Text>
                </Pressable> : null}
                {accountUserId ? <Text style={{ color: colors.textSecondary }}>{t.otherPhone}</Text> : null}
                <PhoneLoginPanel
                  phone={phoneLogin.phone} setPhone={phoneLogin.setPhone}
                  code={phoneLogin.code} setCode={phoneLogin.setCode}
                  countdown={phoneLogin.countdown} sendingCode={phoneLogin.sendingCode}
                  loading={phoneLogin.loading || usingAccount}
                  onSendCode={() => { if (!usingAccount) void phoneLogin.handleSendCode() }}
                  onLogin={() => { if (!usingAccount) void phoneLogin.handleLogin() }} colors={colors}
                />
                {phoneLogin.error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>
                  {phoneLogin.error}</Text> : null}
              </View> : null}
            {!needsLogin && timelineMessages.length === 0
              ? <View style={styles.emptyState}>
                {conversationStatus === 'paused'
                  ? <Text style={[styles.empty, { color: colors.textSecondary }]}>{t.visitorPaused}</Text>
                  : visiblePublication?.status === 'active' && visiblePublication.requireContactApproval
                  && contactStatus !== 'added'
                  ? <Text style={[styles.empty, { color: colors.textSecondary }]}>
                    {contactStatus === 'pending' ? t.requestPending : t.requestFirst}
                  </Text> : visiblePublication?.status === 'active'
                  ? <>
                    {visiblePublication.description.trim()
                      && visiblePublication.description.trim() !== visiblePublication.displayName.trim()
                      ? <Text style={[styles.emptyDescription, { color: colors.text }]}>
                        {visiblePublication.description}</Text> : null}
                    {(visiblePublication.suggestedQuestions ?? []).length > 0
                      ? <View style={styles.questionList}>
                        {visiblePublication.suggestedQuestions?.map((question) => (
                          <Pressable key={question} accessibilityRole="button" style={[styles.question,
                            { borderColor: colors.border, backgroundColor: colors.bg }]}
                            onPress={() => { setDraft(question); inputRef.current?.focus() }}>
                            <Text style={[styles.questionText, { color: colors.text }]}>{question}</Text>
                            <Text style={{ color: colors.textSecondary }}>↗</Text>
                          </Pressable>
                        ))}
                      </View> : null}
                  </> : <Text style={[styles.empty, { color: colors.textSecondary }]}>{t.noHistory}</Text>}
              </View>
              : !needsLogin ? <>
                  {olderCursor ? <Pressable accessibilityRole="button" style={styles.olderButton}
                    onPress={() => void loadOlder()}>
                    <Text style={{ color: colors.brand }}>{t.olderMessages}</Text>
                  </Pressable> : null}
                  {timelineMessages.map((message) => {
                    const own = message.authorRole === 'visitor'
                    if (message.authorRole === 'system') {
                      return <Text key={message.id} style={[styles.systemMessage, { color: colors.textSecondary }]}>
                        {message.text}
                      </Text>
                    }
                    return <View key={message.id} style={[styles.messageRow, own && styles.ownMessageRow]}>
                      <View style={styles.messageBody}>
                        <View style={own ? [styles.bubble, { backgroundColor: colors.ownMessage }]
                          : styles.agentReply}>
                          <SimpleMessageMarkdown content={message.text ?? ''} typography={{ fontSize: 15, lineHeight: 22 }}
                            color={colors.text} linkColor={colors.brand} codeBackground={colors.surface} />
                          {message.attachments?.map((file) => (
                            <Pressable key={file.attachmentId} accessibilityRole="button"
                              disabled={!file.available} onPress={() => void openAttachment(file.attachmentId)}
                              style={styles.messageAttachment}>
                              <Text style={{ color: file.available ? colors.brand : colors.textSecondary }}
                                numberOfLines={1}>{file.mediaKind === 'image' ? '▧' : file.mediaKind === 'video' ? '▶' : '▤'} {file.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                        {message.status === 'failed'
                          ? <Text style={[styles.messageStatus, { color: colors.error }]}>{failureText(message.failureCode)}</Text> : null}
                        {message.status === 'cancelled'
                          ? <Text style={[styles.messageStatus, { color: colors.textSecondary }]}>{t.cancelled}</Text> : null}
                      </View>
                    </View>
                  })}
                  {waitingForReply(timelineMessages) ? <ReplyDots color={colors.textSecondary}
                    label={t.running} /> : null}
                </> : null}
            {conversationError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {conversationError}</Text> : null}
            {conversationError ? <Pressable accessibilityRole="button" onPress={() => void loadConversation()}>
              <Text style={{ color: colors.brand }}>{t.retry}</Text>
            </Pressable> : null}
          </ScrollView>
          {!needsLogin && conversationStatus !== 'paused'
            && visiblePublication && visiblePublication.status !== 'unavailable'
            && !(scopedKind === 'anonymous' && !visiblePublication.allowAnonymousVisitors)
            && visiblePublication.requireContactApproval
            && contactStatus !== 'added' ? <View style={styles.composer}>
            {contactStatus === 'pending' ? <Text style={{ color: colors.textSecondary }}>{t.requestPending}</Text>
              : <Pressable accessibilityRole="button" disabled={requestingContact || contactStatus === null}
                onPress={() => void requestContact()} style={styles.accountButton}>
                <Text style={{ color: colors.brand }}>{t.requestToAdd}</Text>
              </Pressable>}
            {contactRequestError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {contactRequestError}</Text> : null}
          </View> : !needsLogin && conversationStatus !== 'paused'
            && visiblePublication && visiblePublication.status !== 'unavailable'
            && !(scopedKind === 'anonymous' && !visiblePublication.allowAnonymousVisitors)
            ? <View style={styles.composer}>
            {sendError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{sendError}</Text> : null}
            {sendError && sendRetryable ? <Pressable accessibilityRole="button" disabled={sending}
              onPress={() => void send()}>
              <Text style={{ color: colors.brand }}>{t.retrySend}</Text>
            </Pressable> : null}
            {draftAttachments.length ? <View style={styles.draftAttachments}>
              {draftAttachments.map((item) => <View key={item.id} style={[styles.draftAttachment,
                { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontSize: 13 }}>
                  {item.file.type.startsWith('image/') ? '▧' : item.file.type.startsWith('video/') ? '▶' : '▤'} {item.file.name}
                  {' · '}{item.file.size < 1024 * 1024
                    ? `${Math.max(1, Math.ceil(item.file.size / 1024))} KB`
                    : `${(item.file.size / 1024 / 1024).toFixed(1)} MB`}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`${t.removeAttachment}: ${item.file.name}`}
                  disabled={sending} onPress={() => {
                    pendingMessageId.current = null
                    setDraftAttachments((previous) => previous.filter((file) => file.id !== item.id))
                  }}><Text style={{ color: colors.textSecondary, fontSize: 18 }}>×</Text></Pressable>
              </View>)}
            </View> : null}
            {attachMenuOpen ? <View style={[styles.attachMenu, { backgroundColor: colors.surface,
              borderColor: colors.border }]}>
              <Pressable accessibilityRole="button" style={styles.attachMenuOption}
                onPress={() => chooseAttachments('*/*')}><Text style={{ color: colors.text }}>{t.files}</Text></Pressable>
              <Pressable accessibilityRole="button" style={styles.attachMenuOption}
                onPress={() => chooseAttachments('image/*,video/*')}><Text style={{ color: colors.text }}>{t.media}</Text></Pressable>
            </View> : null}
            <View style={[styles.inputRow, { borderColor: inputFocused ? colors.brand : colors.border,
              backgroundColor: colors.bg }]}>
              <TextInput
              ref={inputRef}
              testID="published-ai-message-input"
              nativeID="published-ai-message-input"
              value={draft}
              onChangeText={(value) => {
                setDraft(value)
                pendingMessageId.current = null
                setSendError('')
                setSendRetryable(false)
              }}
              placeholder={t.write}
              placeholderTextColor={colors.textTertiary}
              style={[styles.inputText, { color: colors.text },
                Platform.OS === 'web' ? { borderWidth: 0, outlineStyle: 'none',
                  outlineWidth: 0, boxShadow: 'none', backgroundColor: 'transparent' } as never : null]}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              maxLength={20000}
              editable={!sending}
              accessibilityLabel={t.write}
              multiline
              numberOfLines={1}
              scrollEnabled
              onSubmitEditing={Platform.OS === 'web' ? undefined : () => void send()}
              blurOnSubmit={false}
              />
              <View style={styles.inputActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={t.attach} disabled={sending}
                onPress={() => setAttachMenuOpen((current) => !current)} style={styles.attachButton}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 5v14M5 12h14" stroke={colors.textSecondary}
                    strokeWidth={1.7} strokeLinecap="round" />
                </Svg>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t.send}
                accessibilityState={{ disabled: (!draft.trim() && !draftAttachments.length) || sending, busy: sending }}
                disabled={(!draft.trim() && !draftAttachments.length) || sending} onPress={() => void send()}
                style={[styles.sendButton, { backgroundColor: colors.brand,
                  opacity: (!draft.trim() && !draftAttachments.length) || sending ? 0.45 : 1 }]}>
                {sending ? <ActivityIndicator size="small" color="#fff" /> :
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 19V5m-6 6 6-6 6 6" stroke="#fff"
                      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>}
              </Pressable>
              </View>
            </View>
          </View> : null}
        </>
      ) : (
        <View style={styles.loadingState}>
          {loading || checkingSession ? <ActivityIndicator accessibilityLabel={t.loading}
            color={colors.brand} /> : <Text style={{ color: colors.textSecondary }}>{t.unavailable}</Text>}
        </View>
      )}
      {showAiDialog ? <View style={styles.dialogScrim}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t.close}
          onPress={() => setShowAiDialog(false)} />
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.subtitle, { color: colors.text }]}>{t.aiTitle}</Text>
          <Text style={[styles.aiToolHint, { color: colors.textSecondary }]}>{t.aiToolHint}</Text>
          <View style={[styles.instructionBox, { borderColor: colors.border, backgroundColor: colors.bg }]}>
            <Text selectable style={[styles.instruction, { color: colors.text }]}>{aiInstruction}</Text>
          </View>
          <Pressable accessibilityRole="button" style={[styles.dialogButton, { backgroundColor: colors.brand }]}
            onPress={() => void Clipboard.setStringAsync(aiInstruction)
              .then(() => setLinkCopied(true)).catch(() => setLinkCopied(false))}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>{linkCopied ? t.copied : t.copyLink}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.dialogClose}
            onPress={() => setShowAiDialog(false)}>
            <Text style={{ color: colors.brand }}>{t.close}</Text>
          </Pressable>
        </View>
      </View> : null}
      <View style={styles.hiddenGuide} aria-hidden>
        <Text>{t.aiSummary} {aiInstruction} {t.officialGuide} {t.aiGuide} {t.install} {t.skill}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, overflow: 'hidden' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hiddenGuide: { display: 'none' },
  dialogScrim: { ...StyleSheet.absoluteFillObject, zIndex: 20, backgroundColor: '#0008',
    alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 440, borderRadius: 18, padding: 20, gap: 16 },
  aiToolHint: { fontSize: 13, lineHeight: 19 },
  instructionBox: { borderWidth: 1, borderRadius: 10, padding: 14 },
  instruction: { fontSize: 15, lineHeight: 23 },
  dialogButton: { minHeight: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dialogClose: { alignSelf: 'center', minHeight: 36, justifyContent: 'center' },
  subtitle: { fontSize: 20, fontWeight: '700' },
  header: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth },
  headerIdentity: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  headerAction: { minHeight: 44, minWidth: 96, alignItems: 'flex-end', justifyContent: 'center' },
  headerActionText: { fontSize: 13, fontWeight: '600' },
  timeline: { flex: 1 },
  timelineContent: { width: '100%', maxWidth: 860, alignSelf: 'center', flexGrow: 1,
    paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  stateNotice: { borderRadius: 12, padding: 14, gap: 5 },
  stateNoticeTitle: { fontSize: 14, fontWeight: '600' },
  status: { alignSelf: 'center', textAlign: 'center', fontSize: 13, lineHeight: 19 },
  emptyState: { minHeight: 160, flexGrow: 1, width: '100%', maxWidth: 620,
    alignSelf: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8 },
  emptyDescription: { fontSize: 21, lineHeight: 31, fontWeight: '500' },
  questionList: { marginTop: 36, gap: 10 },
  question: { minHeight: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  questionText: { fontSize: 14, lineHeight: 20, flex: 1 },
  emptyTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  empty: { alignSelf: 'center', textAlign: 'center', fontSize: 14, lineHeight: 21 },
  olderButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  messageRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingRight: 38 },
  ownMessageRow: { justifyContent: 'flex-end', paddingLeft: 38, paddingRight: 0 },
  messageBody: { minWidth: 0, maxWidth: '100%', alignSelf: 'flex-start', flexShrink: 1 },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  agentReply: { paddingVertical: 10 },
  messageStatus: { marginTop: 4, marginHorizontal: 4, fontSize: 11, lineHeight: 15 },
  systemMessage: { alignSelf: 'center', textAlign: 'center', fontSize: 12, lineHeight: 17 },
  composer: { width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 16,
    paddingVertical: 6, gap: 6 },
  draftAttachments: { gap: 6 },
  draftAttachment: { minHeight: 38, borderWidth: 1, borderRadius: 9,
    paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  messageAttachment: { marginTop: 6, minHeight: 28, justifyContent: 'center' },
  attachMenu: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 12, padding: 5,
    minWidth: 160 },
  attachMenuOption: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12 },
  inputActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  attachButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  inputRow: { borderWidth: 1, borderRadius: 16,
    paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4, gap: 0 },
  inputText: { minWidth: 0, height: 24, maxHeight: 120,
    paddingHorizontal: 4, paddingVertical: 0, fontSize: 16, lineHeight: 22,
    textAlignVertical: 'top' },
  sendButton: { width: 28, height: 28, margin: 4, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  login: { gap: 14, borderWidth: 1, borderRadius: 16, padding: 18 },
  loginHeading: { fontSize: 17, fontWeight: '600' },
  accountButton: { minHeight: 44, justifyContent: 'center' },
})
