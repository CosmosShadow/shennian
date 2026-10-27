import { ActionIconButton } from '../../components/ActionIconButton'
import { ScheduleDetailsModal } from '../schedules/ScheduleDetailsModal'
// @arch docs/features/network-rooms/scoped-browser-access.md
// @test src/__tests__/scoped-room-api.test.ts

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Image,
  InteractionManager,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import Feather from '@expo/vector-icons/Feather'
import * as DocumentPicker from 'expo-document-picker'
import Head from 'expo-router/head'
import { useTranslation } from 'react-i18next'
import type { RoomMessageView } from '@shennian/wire'
import { WEB_APP_URL } from '../../config/server'
import { ScopedRoomDialogs } from './components/ScopedRoomDialogs'
import { MobileAppDownloadDialog } from './components/MobileAppDownloads'
import { ApiError } from '@shennian/shared/api'
import { useTheme } from '../../hooks/useTheme'
import type { RoomMemberView } from './types'
import { scopedRoomApi, scopedRoomEventsUrl } from './scopedRoomApi'
import { formatRoomSystemMessage, isHiddenScopedAgentSystemMessage } from './roomSystemMessages'
import { roomMessageAvatars } from './roomPresentation'
import { scopedRoomSourceLabelKey } from './scopedRoomMessagePresentation'
import { RoomIdentityAvatar } from './components/RoomIdentityAvatar'
import { useChatFontSize } from '../../hooks/useChatFontSize'
import { usesDesktopScopedRoomTypography } from '../chat/preferences/chatFontSize'
import { roomTypography } from './roomTypography'
import { SimpleMessageMarkdown } from '../../components/chat/SimpleMessageMarkdown'
import { ComposerInputCard } from '../chat/components/ComposerInputCard'
import { ComposerActionMenu } from '../chat/components/ComposerActionMenu'
import { guessMimeType } from '../../components/chat/fileOperations'
import { useDesktopFileDrop } from '../desktop-control/useDesktopFileDrop'
import { isInlineImage } from '../uploads/heicFile'
import { RoomMentionPicker } from './components/RoomMentionPicker'
import {
  containsMentionToken,
  createMentionInsertion,
  shouldOpenMentionPicker,
} from './roomMentions'
import {
  pickDesktopRoomAttachment,
  uploadScopedRoomAttachment,
  type RoomPickedFile,
} from './roomAttachments'
import { requestAiDataConsent } from '../privacy/aiDataConsent'


type Bootstrap = {
  browserLogoutAvailable?: boolean
  room: {
    id: string
    name: string
    description: string
    status: string
    joinPolicy: 'open' | 'approval' | 'closed'
    lastSequence: string
  }
  currentUser: { id: string; name: string }
  membershipId: string
  members: RoomMemberView[]
  messages: RoomMessageView[]
  hasOlder: boolean
  expiresAt: string
}

type PendingRoomAttachment = RoomPickedFile & {
  id: string
  attachmentId: string | null
  status: 'uploading' | 'ready' | 'failed'
}

const APP_HINT_DISMISSED_KEY = 'shennian:room-web-app-hint-dismissed'

function appHintDismissedThisSession(): boolean {
  if (Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return true
  try {
    return sessionStorage.getItem(APP_HINT_DISMISSED_KEY) === '1'
  } catch {
    return true
  }
}

function markAppHintDismissed(): void {
  if (Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(APP_HINT_DISMISSED_KEY, '1')
  } catch {}
}

export function ScopedRoomConversationScreen({
  roomId,
  unavailableFallback,
}: {
  roomId: string
  unavailableFallback?: ReactNode
}) {
  const desktopDensity = usesDesktopScopedRoomTypography(
    Platform.OS,
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true,
  )
  const { typography } = useChatFontSize({ desktopDensity })
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const [scheduleDetails, setScheduleDetails] = useState(false)
  const [data, setData] = useState<Bootstrap | null>(null)
  const [messages, setMessages] = useState<RoomMessageView[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const [attachmentFailed, setAttachmentFailed] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingRoomAttachment[]>([])
  const [inputFocused, setInputFocused] = useState(false)
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [selectedMentions, setSelectedMentions] = useState<RoomMemberView[]>([])
  const [draftSelection, setDraftSelection] = useState<{ start: number; end: number }>()
  const [showComposerMenu, setShowComposerMenu] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showAppHint, setShowAppHint] = useState(false)
  const [showAppDownloads, setShowAppDownloads] = useState(false)
  const shareRequestVersion = useRef(0)
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const inputRef = useRef<TextInput>(null)
  const latestSequenceRef = useRef('0')
  const accessEnded = useRef(false)
  const endAccess = useCallback(() => { accessEnded.current = true; setUnavailable(true) }, [])
  const memberById = useMemo(
    () => new Map((data?.members ?? []).map((member) => [member.id, member])),
    [data?.members],
  )
  const readOnly = data?.room.status !== 'active'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await scopedRoomApi<Bootstrap>(roomId, '/bootstrap')
      if (accessEnded.current) return
      setData(result)
      setMessages(result.messages)
      setHasOlder(result.hasOlder)
      latestSequenceRef.current = result.messages[result.messages.length - 1]?.sequence ?? '0'
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) endAccess()
    } finally {
      setLoading(false)
    }
  }, [roomId, endAccess])

  const refreshContext = useCallback(async () => {
    try {
      const result = await scopedRoomApi<Bootstrap>(roomId, '/bootstrap')
      if (accessEnded.current) return
      setData((current) => current ? {
        ...current,
        room: result.room,
        currentUser: result.currentUser,
        membershipId: result.membershipId,
        members: result.members,
        expiresAt: result.expiresAt,
      } : current)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) endAccess()
    }
  }, [roomId, endAccess])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!data) return
    const timer = setTimeout(endAccess, Math.max(0, Date.parse(data.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [data?.expiresAt, endAccess])

  useEffect(() => {
    if (!unavailable) return
    setData(null)
    setMessages([])
    setPendingAttachments([])
    setDraft('')
    setShowShare(false)
  }, [unavailable])


  useEffect(() => {
    if (!data || unavailable) return
    let active = true
    const recover = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const result = await scopedRoomApi<{ messages: RoomMessageView[] }>(
          roomId,
          `/messages?after=${encodeURIComponent(latestSequenceRef.current)}&limit=50`,
        )
        if (!active || accessEnded.current || result.messages.length === 0) return
        latestSequenceRef.current =
          result.messages[result.messages.length - 1]?.sequence ?? latestSequenceRef.current
        setMessages((current) => mergeMessages(current, result.messages))
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) endAccess()
      }
    }
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      if (
        !active ||
        typeof WebSocket === 'undefined' ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      ) return
      socket = new WebSocket(scopedRoomEventsUrl(roomId))
      socket.onmessage = (event) => {
        if (accessEnded.current) return
        try {
          const frame = JSON.parse(String(event.data)) as {
            event?: string
            payload?: { roomId?: string; message?: RoomMessageView }
          }
          if (frame.event === 'room.message.created' && frame.payload?.message) {
            latestSequenceRef.current = frame.payload.message.sequence
            setMessages((current) => mergeMessages(current, [frame.payload!.message!]))
            requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
          } else if (frame.event && frame.event.startsWith('room.')) {
            void refreshContext()
            void recover()
          }
        } catch {
          // A sequence recovery pass remains the authority after malformed frames.
        }
      }
      socket.onclose = (event) => {
        if (event.code === 4401 || event.code === 4403) {
          endAccess()
          return
        }
        socket = null
        if (
          active &&
          (typeof document === 'undefined' || document.visibilityState !== 'hidden')
        ) reconnectTimer = setTimeout(connect, 1500)
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = null
        socket?.close()
        socket = null
        return
      }
      void recover()
      if (!socket) connect()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility)
    }
    connect()
    return () => {
      active = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
    }
  }, [data, roomId, unavailable, endAccess, refreshContext])

  useEffect(() => {
    const sequence = messages[messages.length - 1]?.sequence
    if (!sequence) return
    void scopedRoomApi(roomId, '/read-state', {
      method: 'POST',
      body: JSON.stringify({ lastReadSequence: sequence }),
    }).catch(() => {})
  }, [messages, roomId])

  const loadOlder = useCallback(async () => {
    const before = messages[0]?.sequence
    if (!before || !hasOlder || loadingOlder) return
    setLoadingOlder(true)
    try {
      const result = await scopedRoomApi<{ messages: RoomMessageView[]; hasMore: boolean }>(
        roomId,
        `/messages?before=${encodeURIComponent(before)}&limit=50`,
      )
      if (accessEnded.current) return
      setMessages((current) => mergeMessages(current, result.messages))
      setHasOlder(result.hasMore)
    } finally {
      setLoadingOlder(false)
    }
  }, [hasOlder, loadingOlder, messages, roomId])

  const send = useCallback(async () => {
    const text = draft.trim()
    const attachmentIds = pendingAttachments.reduce<string[]>((ids, item) => {
      if (item.status === 'ready' && item.attachmentId) ids.push(item.attachmentId)
      return ids
    }, [])
    if (
      !data ||
      (!text && attachmentIds.length === 0) ||
      sending ||
      readOnly ||
      pendingAttachments.some((item) => item.status === 'uploading')
    ) return
    if (data.members.some((member) => member.principalType === 'agent')) {
      const consented = await requestAiDataConsent({
        accountId: data.currentUser.id,
        kind: 'room',
        title: t('ai_consent_room_title'),
        message: t('ai_consent_room_body'),
        allowLabel: t('ai_consent_allow_room'),
        declineLabel: t('ai_consent_not_now'),
        privacyLabel: t('ai_consent_privacy'),
      })
      if (!consented) return
    }
    setSending(true)
    setSendFailed(false)
    try {
      const result = await scopedRoomApi<{ message: RoomMessageView }>(roomId, '/messages', {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId: `room-web:${cryptoRandomId()}`,
          text,
          attachmentIds,
          mentionMembershipIds: selectedMentions
            .filter((member) => containsMentionToken(text, member.displayAlias))
            .map((member) => member.id),
        }),
      })
      if (accessEnded.current) return
      latestSequenceRef.current = result.message.sequence
      setMessages((current) => mergeMessages(current, [result.message]))
      setDraft('')
      setDraftSelection(undefined)
      setSelectedMentions([])
      setPendingAttachments([])
      if (!appHintDismissedThisSession()) setShowAppHint(true)
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
    } catch (error) {
      setSendFailed(true)
      if (error instanceof ApiError && error.status === 401) endAccess()
    } finally {
      setSending(false)
    }
  }, [data, draft, pendingAttachments, readOnly, roomId, selectedMentions, sending, endAccess, t])

  const selectMention = useCallback(
    (member: RoomMemberView) => {
      const insertion = createMentionInsertion(draft, member.displayAlias)
      setSelectedMentions((current) =>
        current.some((item) => item.id === member.id) ? current : [...current, member],
      )
      setDraft(insertion.text)
      setDraftSelection(insertion.selection)
      setMentionPickerOpen(false)
      void InteractionManager.runAfterInteractions(() => inputRef.current?.focus())
    },
    [draft],
  )

  const handleDraftChange = useCallback(
    (value: string) => {
      const openMentionPicker = shouldOpenMentionPicker(draft, value)
      setDraftSelection(undefined)
      setDraft(value)
      setSelectedMentions((current) =>
        current.filter((member) => containsMentionToken(value, member.displayAlias)),
      )
      if (openMentionPicker) {
        inputRef.current?.blur()
        setMentionPickerOpen(true)
      }
    },
    [draft],
  )

  const handleDraftSelectionChange = useCallback(
    (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
      if (!draftSelection) return
      const { selection } = event.nativeEvent
      if (selection.start !== draftSelection.start || selection.end !== draftSelection.end) return
      requestAnimationFrame(() => setDraftSelection(undefined))
    },
    [draftSelection],
  )

  const uploadPickedAttachments = useCallback(async (picked: RoomPickedFile[]) => {
    const selected: PendingRoomAttachment[] = picked
      .slice(0, 10 - pendingAttachments.length)
      .map((item) => ({
        ...item,
        id: cryptoRandomId(),
        attachmentId: null,
        status: 'uploading',
      }))
    setPendingAttachments((current) => [...current, ...selected])
    for (const item of selected) {
      try {
        const attachmentId = await uploadScopedRoomAttachment(roomId, item)
        setPendingAttachments((current) => current.map((candidate) => (
          candidate.id === item.id
            ? { ...candidate, attachmentId, status: 'ready' }
            : candidate
        )))
      } catch {
        setPendingAttachments((current) => current.map((candidate) => (
          candidate.id === item.id ? { ...candidate, status: 'failed' } : candidate
        )))
      }
    }
  }, [pendingAttachments.length, roomId])

  useDesktopFileDrop(
    (files) => uploadPickedAttachments(files.map((file) => ({
      name: file.name,
      mimeType: guessMimeType(file.name),
      size: file.size,
      readBytes: file.readBytes,
    }))),
    !sending && !readOnly && pendingAttachments.length < 10,
  )

  const pickAttachments = useCallback(async (type: '*/*' | string[]) => {
    if (sending || readOnly || pendingAttachments.length >= 10) return
    setShowComposerMenu(false)
    try {
      const desktopFile = await pickDesktopRoomAttachment()
      if (desktopFile !== undefined) {
        if (desktopFile) await uploadPickedAttachments([desktopFile])
        return
      }
      const result = await DocumentPicker.getDocumentAsync({
        type,
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (result.canceled) return
      await uploadPickedAttachments(result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        size: asset.size ?? 0,
        ...(asset.file ? { file: asset.file } : {}),
      })))
    } catch {
      // Cancellation and browser picker errors leave the draft unchanged.
    }
  }, [pendingAttachments.length, readOnly, sending, uploadPickedAttachments])

  const takePhoto = useCallback(() => {
    if (Platform.OS !== 'web' || sending || readOnly || pendingAttachments.length >= 10) return
    setShowComposerMenu(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) void uploadPickedAttachments([{
        file,
        name: file.name || `photo_${Date.now()}.jpg`,
        mimeType: file.type || 'image/jpeg',
        size: file.size,
      }])
    }
    input.click()
  }, [pendingAttachments.length, readOnly, sending, uploadPickedAttachments])

  const openAttachment = useCallback(async (attachmentId: string) => {
    setAttachmentFailed(false)
    try {
      const result = await scopedRoomApi<{ downloadUrl: string }>(
        roomId,
        `/attachments/${encodeURIComponent(attachmentId)}/download`,
      )
      await Linking.openURL(result.downloadUrl)
    } catch {
      setAttachmentFailed(true)
    }
  }, [roomId])

  const canonicalUrl = `${WEB_APP_URL}/spaces/${encodeURIComponent(roomId)}`

  const openMobileApp = useCallback(() => {
    void Linking.openURL(`shennian:///spaces/${encodeURIComponent(roomId)}`).catch(() => {
      setShowAppDownloads(true)
    })
  }, [roomId])

  const dismissAppHint = useCallback(() => {
    setShowAppHint(false)
    markAppHintDismissed()
  }, [])

  const openShare = useCallback(async () => {
    const version = ++shareRequestVersion.current
    setShowShare(true)
    setInviteUrl('')
    setInviteLoading(true)
    try {
      const result = await scopedRoomApi<{ invite: { url: string; joinPolicy?: Bootstrap['room']['joinPolicy'] } }>(roomId, '/invite-link')
      if (version !== shareRequestVersion.current) return
      const joinPolicy = result.invite.joinPolicy
      if (joinPolicy) setData(current => current ? { ...current, room: { ...current.room, joinPolicy } } : current)
      setInviteUrl(joinPolicy === 'closed' ? '' : result.invite.url)
    } catch {
      if (version === shareRequestVersion.current) setInviteUrl('')
    } finally {
      if (version === shareRequestVersion.current) setInviteLoading(false)
    }
  }, [roomId])

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.brand} />
      </SafeAreaView>
    )
  }

  if (unavailable || !data) {
    if (unavailableFallback) return unavailableFallback
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <Ionicons name="lock-closed-outline" size={32} color={colors.textSecondary} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {t('scoped_room_access_expired')}
        </Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          {t('scoped_room_access_expired_body')}
        </Text>
        <Pressable style={[styles.primaryButton, { backgroundColor: colors.brand }]} onPress={openMobileApp}>
          <Text style={styles.primaryButtonText}>{t('scoped_room_open_app')}</Text>
        </Pressable>
        <MobileAppDownloadDialog visible={showAppDownloads} onClose={() => setShowAppDownloads(false)} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={usesBrowserBottomSafeArea() ? ['top', 'bottom'] : ['top']}
    >
      {showShare && <ScopedRoomDialogs
        visible={showShare}
        roomName={data.room.name}
        roomUrl={canonicalUrl}
        joinPolicy={data.room.joinPolicy}
        inviteUrl={inviteUrl}
        inviteLoading={inviteLoading}
        roomId={roomId}
        browserLogoutAvailable={Boolean(data.browserLogoutAvailable)}
        onOpenSchedules={() => {
          shareRequestVersion.current += 1
          setShowShare(false)
          setScheduleDetails(true)
        }}
        onRetry={() => void openShare()}
        onClose={() => { shareRequestVersion.current += 1; setShowShare(false) }}
      />}
      {scheduleDetails ? <ScheduleDetailsModal roomId={roomId} agentNames={Object.fromEntries(data.members.filter(m => m.ownerUserId === data.currentUser.id && m.agentIdentityId).map(m => [m.agentIdentityId!, m.displayAlias]))} onClose={() => setScheduleDetails(false)} /> : null}
      <MobileAppDownloadDialog visible={showAppDownloads} onClose={() => setShowAppDownloads(false)} />
      <Head>
        <title>{data.room.name} · {t('app_name')}</title>
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Head>
      <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.separator ?? colors.border }]}>
        <View style={styles.headerIdentity}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{data.room.name}</Text>
        </View>
        <View style={styles.headerActions}>
          <ActionIconButton
            icon="more"
            label={t('more')}
            testID="room-more-button"
            onPress={() => void openShare()}
            color={colors.text}
          />
        </View>
      </View>
      <ScrollView
        ref={scrollRef}
        style={[styles.timeline, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.timelineContent}
      >
        {hasOlder ? (
          <Pressable style={styles.olderButton} disabled={loadingOlder} onPress={() => void loadOlder()}>
            {loadingOlder ? <ActivityIndicator color={colors.brand} /> : (
              <Text style={[styles.olderText, { color: colors.brand }]}>{t('scoped_room_load_older')}</Text>
            )}
          </Pressable>
        ) : null}
        {messages.map((message) => {
          if (isHiddenScopedAgentSystemMessage(message)) return null
          const own = message.author.ownerUserId === data.currentUser.id && message.author.principalType === 'human'
          const member = memberById.get(message.author.membershipId)
          if (message.kind === 'system') {
            return <Text key={message.id} style={[styles.system, typography.system, { color: colors.textSecondary }]}>{formatRoomSystemMessage(message, t)}</Text>
          }
          const agent = message.author.principalType === 'agent'
          const { avatar, ownerAvatar } = roomMessageAvatars(message.author.avatar, member, agent)
          const displayName = member?.displayAlias ?? message.author.displayName
          const aiSourceKey = scopedRoomSourceLabelKey(message.author.principalType, message.source)
          const avatarView = (
            <RoomIdentityAvatar
              name={displayName}
              avatar={avatar}
              agent={agent}
              ownerAvatar={ownerAvatar}
              ownerName={agent ? (message.author.ownerDisplayName ?? member?.ownerDisplayName) : null}
              size={30}
            />
          )
          return (
            <View key={message.id} testID={`scoped-room-message-${message.id}`} style={[styles.messageRow, own && styles.ownMessageRow]}>
              {!own ? avatarView : null}
              <View style={[styles.message, own && styles.ownMessage]}>
                {!own ? (
                  <Text style={[styles.author, typography.author, { color: colors.textSecondary }]}>
                    {displayName}
                  </Text>
                ) : null}
                <View style={[styles.bubble, { backgroundColor: own ? colors.ownMessage : colors.surfaceHover }]}>
                  {message.text ? <SimpleMessageMarkdown content={message.text} typography={typography.body}
                    color={colors.text} linkColor={colors.brand} codeBackground={colors.surface} /> : null}
                  {message.attachments.map((attachment) => (
                    <Pressable
                      key={attachment.attachmentId}
                      accessibilityRole="link"
                      onPress={() => void openAttachment(attachment.attachmentId)}
                      style={[styles.attachment, { borderColor: colors.border }]}
                    >
                      <Ionicons name="document-outline" size={16} color={colors.textSecondary} />
                      <Text numberOfLines={1} style={[styles.attachmentName, { color: colors.text }]}>
                        {attachment.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {aiSourceKey ? <Text style={[styles.aiSource, { color: colors.textTertiary }]}>{t(aiSourceKey)}</Text> : null}
              </View>
            </View>
          )
        })}
      </ScrollView>
      {Platform.OS === 'web' && showAppHint ? (
        <View style={[styles.appHint, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
          <Text style={[styles.appHintText, { color: colors.textSecondary }]} numberOfLines={2}>
            {t('scoped_room_app_hint')}
          </Text>
          <Pressable accessibilityRole="button" onPress={openMobileApp}>
            <Text style={[styles.appHintAction, { color: colors.brand }]}>
              {t('scoped_room_open_app_compact')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            hitSlop={8}
            style={styles.appHintClose}
            onPress={dismissAppHint}
          >
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.composer, { backgroundColor: colors.bg }]}>
        {pendingAttachments.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pendingStripContent}
          >
            {pendingAttachments.map((item) => {
              const image = isInlineImage(item)
              return (
                <View
                  key={item.id}
                  style={[
                    styles.pendingAttachment,
                    { backgroundColor: `${colors.brand}10`, borderColor: `${colors.brand}25` },
                  ]}
                >
                  <View style={styles.pendingAttachmentBody}>
                    {image ? (
                      <View>
                        <Image source={{ uri: item.uri }} style={styles.pendingAttachmentThumb} />
                        {item.status === 'uploading' ? (
                          <View style={styles.pendingAttachmentProgressOverlay}>
                            <ActivityIndicator size="small" color="#fff" />
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <View style={[styles.pendingAttachmentIcon, { backgroundColor: colors.surface }]}>
                        <Feather
                          name={item.status === 'failed' ? 'alert-circle' : 'file'}
                          size={16}
                          color={item.status === 'failed' ? colors.error : colors.textSecondary}
                        />
                      </View>
                    )}
                    <Text numberOfLines={1} style={[styles.pendingAttachmentName, { color: colors.text }]}>
                      {item.name}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.pendingAttachmentCancel}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('delete')}
                    onPress={() => setPendingAttachments((current) => (
                      current.filter((candidate) => candidate.id !== item.id)
                    ))}
                  >
                    <Feather name="x" size={14} color={colors.textTertiary} />
                  </Pressable>
                </View>
              )
            })}
          </ScrollView>
        ) : null}
        <ComposerInputCard
          inputStyle={typography.body}
          testID="scoped-room-message-input"
          value={draft}
          onChangeText={handleDraftChange}
          selection={draftSelection}
          onSelectionChange={handleDraftSelectionChange}
          inputRef={inputRef}
          maxLength={20000}
          editable={!readOnly}
          accessibilityLabel={t('scoped_room_send_as_placeholder', { name: data.currentUser.name })}
          placeholder={t(readOnly ? 'scoped_room_read_only' : 'scoped_room_send_as_placeholder', { name: data.currentUser.name })}
          inputFocused={inputFocused}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onSubmitEditing={() => void send()}
          blurOnSubmit={false}
          colors={colors}
          isDark={isDark}
          compact
          leftActions={
            <>
              {showComposerMenu ? (
                <View style={styles.composerMenuWrap}>
                  <ComposerActionMenu
                    colors={colors}
                    items={[
                      {
                        id: 'camera',
                        icon: 'camera',
                        label: t('profile_avatar_camera'),
                        onPress: takePhoto,
                      },
                      {
                        id: 'media',
                        icon: 'image',
                        label: t('composer_menu_photos'),
                        onPress: () => void pickAttachments(['image/*', 'video/*']),
                      },
                      {
                        id: 'file',
                        icon: 'file',
                        label: t('composer_menu_files'),
                        onPress: () => void pickAttachments('*/*'),
                      },
                    ]}
                  />
                </View>
              ) : null}
              <ActionIconButton icon="add" color={showComposerMenu ? colors.brand : colors.textSecondary}
                testID="scoped-room-composer-more-btn"
                label={t('composer_more_actions')}
                disabled={sending || readOnly || pendingAttachments.length >= 10}
                onPress={() => setShowComposerMenu((current) => !current)}
               />
            </>
          }
          rightActions={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('send')}
              disabled={
                (!draft.trim() && !pendingAttachments.some((item) => item.status === 'ready')) ||
                pendingAttachments.some((item) => item.status === 'uploading') ||
                sending ||
                readOnly
              }
              style={[
                styles.sendButton,
                {
                  backgroundColor: colors.brand,
                  opacity:
                    (!draft.trim() && !pendingAttachments.some((item) => item.status === 'ready')) ||
                    pendingAttachments.some((item) => item.status === 'uploading') ||
                    sending ||
                    readOnly
                      ? 0.45
                      : 1,
                },
              ]}
              onPress={() => void send()}
            >
              {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-up" size={18} color="#fff" />}
            </Pressable>
          }
        />
      </View>
      {sendFailed ? <Text style={[styles.sendError, { color: colors.error }]}>{t('scoped_room_send_failed')}</Text> : null}
      {attachmentFailed ? <Text style={[styles.sendError, { color: colors.error }]}>{t('scoped_room_attachment_failed')}</Text> : null}
      <RoomMentionPicker
        visible={mentionPickerOpen}
        members={data.members}
        currentUserId={data.currentUser.id}
        onSelect={selectMention}
        onClose={() => setMentionPickerOpen(false)}
      />
    </SafeAreaView>
  )
}

function usesBrowserBottomSafeArea(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean }
  return Boolean(
    standaloneNavigator.standalone || window.matchMedia?.('(display-mode: standalone)').matches,
  )
}

function mergeMessages(current: RoomMessageView[], incoming: RoomMessageView[]) {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((left, right) => BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1)
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  header: { zIndex: 20, height: 56, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerIdentity: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  timeline: { flex: 1 },
  timelineContent: { width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 20, gap: 12 },
  olderButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  olderText: { fontSize: 14, fontWeight: '600' },
  messageRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingRight: 38 },
  ownMessageRow: { justifyContent: 'flex-end', paddingLeft: 38, paddingRight: 0 },
  message: { minWidth: 0, maxWidth: '100%', alignSelf: 'flex-start', flexShrink: 1 },
  ownMessage: { alignSelf: 'flex-end' },
  author: { ...roomTypography.author, marginBottom: 4, marginLeft: 4 },
  aiSource: { marginTop: 4, marginHorizontal: 4, fontSize: 11, lineHeight: 15 },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  body: roomTypography.body,
  attachment: { minHeight: 36, marginTop: 7, paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  attachmentName: { maxWidth: 260, fontSize: 12, lineHeight: 17 },
  system: { alignSelf: 'center', ...roomTypography.system, textAlign: 'center', marginVertical: 4 },
  composer: { width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  pendingStripContent: { gap: 6, marginBottom: 6, paddingRight: 4 },
  pendingAttachment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minWidth: 180,
    maxWidth: 240,
  },
  pendingAttachmentBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  pendingAttachmentThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#ddd' },
  pendingAttachmentProgressOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingAttachmentIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingAttachmentName: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '500' },
  pendingAttachmentCancel: { padding: 4, marginTop: -2 },
  composerAction: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  composerMenuWrap: { position: 'absolute', left: 0, bottom: 44, zIndex: 20 },
  sendButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sendError: { textAlign: 'center', fontSize: 13, lineHeight: 19, paddingBottom: 8 },
  appHint: {
    width: '100%',
    maxWidth: 860,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 10,
  },
  appHintText: { flex: 1, fontSize: 13, lineHeight: 18 },
  appHintAction: { fontSize: 13, fontWeight: '600' },
  appHintClose: { padding: 2 },
  emptyTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 420 },
  primaryButton: { minHeight: 48, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
