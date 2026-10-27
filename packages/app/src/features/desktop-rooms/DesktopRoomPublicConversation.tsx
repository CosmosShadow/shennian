import { DesktopRoomMessageTimeline, type DesktopRoomTimelineHandle } from './DesktopRoomMessageTimeline'
import { DesktopScrollToLatestButton } from '../desktop-chat/DesktopScrollToLatestButton'
// @arch docs/design/desktop/unified-desktop-control.md#群聊工作区本轮推荐方案
// @test ../../__tests__/desktop-room-public-conversation.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import * as Clipboard from 'expo-clipboard'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { ActivityIndicator, InteractionManager, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { RoomMessageView } from '@shennian/wire'
import { TimeSeparator } from '../../components/chat/TimeSeparator'
import { formatMessageTime } from '../../components/chat/messageTime'
import { guessMimeType } from '../../components/chat/fileOperations'
import { useAuthStore } from '../../config/auth'
import { useAppIsActive } from '../../hooks/useAppIsActive'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useTheme } from '../../hooks/useTheme'
import { useChatFontSize } from '../../hooks/useChatFontSize'
import { useDesktopFileDrop } from '../desktop-control/useDesktopFileDrop'
import { desktopShellWindowState } from '../desktop-shell/desktopShellWindowState'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { useVoiceDraft } from '../chat/hooks/useVoiceDraft'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { RoomMessageAttachment } from '../rooms/components/RoomMessageAttachment'
import { uploadRoomAttachment, pickDesktopRoomAttachment } from '../rooms/roomAccountAttachments'
import type { RoomPickedFile } from '../rooms/roomAttachments'
import { createRoomClientMessageId } from '../rooms/roomConversationUtils'
import { shouldShowRoomTimeSeparator } from '../rooms/roomMessageTimeline'
import { roomMessageTextWrapStyle } from '../rooms/roomMessageTextWrap'
import { containsMentionToken, createMentionInsertion, getMentionQuery, shouldOpenMentionPicker } from '../rooms/roomMentions'
import { filterRoomMemberGroups, groupRoomMembers } from '../rooms/roomPresentation'
import { desktopMentionOptionId, flattenMentionGroups, resolveDesktopMentionKey } from './desktopRoomMention'
import { avatarFromSnapshot, isOwnRoomAuthor } from '../rooms/roomPresentation'
import { formatRoomSystemMessage } from '../rooms/roomSystemMessages'
import { removeRoomDraft } from '../rooms/roomDraftStorage'
import type { RoomMemberView } from '../rooms/types'
import { useRoomDraftPersistence, type PendingRoomAttachment } from '../rooms/useRoomDraftPersistence'
import { useDesktopRoomConversationModel } from '../desktop-control/useDesktopRoomConversationModel'
import { DesktopRoomMentionPopover } from './DesktopRoomMentionPopover'
import { DesktopRoomPublicComposer } from './DesktopRoomPublicComposer'
import { requestAiDataConsent } from '../privacy/aiDataConsent'
import {
  acceptsDesktopRoomAttachmentKind,
  extractDesktopRoomClipboardImages,
  acquireDesktopRoomSend,
  getDesktopRoomComposerState,
  getDesktopRoomUnavailableKind,
  isDesktopRoomFollowingLatest,
  releaseDesktopRoomSend,
  visibleDesktopRoomMessages,
  type DesktopRoomAttachmentKind,
  type DesktopRoomSendMutex,
} from './desktopRoomComposer'

export function DesktopRoomPublicConversation({ roomId, readActive }: { roomId: string; readActive: boolean }) {
  const accountId = useAuthStore(state => state.user?.id ?? null)
  return <DesktopRoomPublicConversationContent key={`${accountId}:${roomId}`} roomId={roomId} readActive={readActive} accountId={accountId} />
}

function DesktopRoomPublicConversationContent({ roomId, readActive, accountId }: { roomId: string; readActive: boolean; accountId: string | null }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const networkStatus = useNetworkStatus()
  const appIsActive = useAppIsActive()
  const active = appIsActive && readActive
  const isOffline = networkStatus === 'offline'
  const [draft, setDraft] = useState('')
  const [draftSelection, setDraftSelection] = useState<{ start: number; end: number }>()
  const [selectedMentions, setSelectedMentions] = useState<RoomMemberView[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<PendingRoomAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [attachmentError, setAttachmentError] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const inputRef = useRef<TextInput>(null)
  const inputFocusedRef = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const scrollRef = useRef<DesktopRoomTimelineHandle>(null)
  const shouldAutoFollow = useRef(true)
  const readingPositionRestored = useRef(false)
  const sendMutex = useRef<DesktopRoomSendMutex>({ locked: false })
  const attachmentUploadLocks = useRef(new Set<string>())
  const attachmentScope = useRef(new AbortController())
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const controller = new AbortController()
    attachmentScope.current = controller
    return () => controller.abort()
  }, [accountId, roomId])

  const scrollToLatest = useCallback((animated: boolean, force = false) => {
    if (!activeRef.current || (!force && !shouldAutoFollow.current)) return
    requestAnimationFrame(() => {
      if (activeRef.current && (force || shouldAutoFollow.current)) {
        shouldAutoFollow.current = true
        setShowScrollToLatest(false)
        scrollRef.current?.scrollToOffset({ offset: 0, animated })
      }
    })
  }, [])
  const handleComposerFocusChange = useCallback((focused: boolean) => {
    if (inputFocusedRef.current === focused) return
    inputFocusedRef.current = focused
    setInputFocused(focused)
    if (focused) scrollToLatest(true, true)
    else setMentionOpen(false)
  }, [scrollToLatest])
  const onNewMessages = useCallback(() => scrollToLatest(true), [scrollToLatest])
  const model = useDesktopRoomConversationModel({ roomId, accountId, networkStatus, active: active && !showScrollToLatest, onNewMessages })
  const { room, membershipId, members, messages, hasOlder, loadingOlder, olderLoadFailed, state, loadInitial, loadOlderMessages } = model

  useEffect(() => {
    if (!active || state !== 'ready' || !room || readingPositionRestored.current) return
    const position = accountId
      ? desktopShellWindowState.getReadingPosition(accountId, { kind: 'room', id: roomId })
      : null
    readingPositionRestored.current = true
    if (!position) return
    const followsLatest = isDesktopRoomFollowingLatest(position.distanceFromBottom)
    shouldAutoFollow.current = followsLatest
    setShowScrollToLatest(!followsLatest)
    const frame = requestAnimationFrame(() => {
      if (activeRef.current) scrollRef.current?.scrollToOffset({ offset: position.scrollTop, animated: false })
    })
    return () => cancelAnimationFrame(frame)
  }, [accountId, active, room, roomId, state])

  useRoomDraftPersistence({ accountId, roomId, draft, setDraft, pendingAttachments, setPendingAttachments, members, selectedMentions, setSelectedMentions })
  useEscapeKey(attachmentMenuOpen, () => setAttachmentMenuOpen(false))
  // The composer keeps focus while the mention list is open, so it owns Escape (see handleComposerKey).
  useEffect(() => {
    if (mentionOpen && getMentionQuery(draft) === null) setMentionOpen(false)
  }, [draft, mentionOpen])

  const updateDraftFromVoice = useCallback((value: string) => {
    setDraft(value)
    setDraftSelection({ start: value.length, end: value.length })
  }, [])
  const voice = useVoiceDraft({
    sessionId: roomId,
    sessionDraftEnabled: false,
    currentDraft: draft,
    onListeningTextChange: updateDraftFromVoice,
    onDraftReady: result => { updateDraftFromVoice(result.draft); inputRef.current?.focus(); scrollToLatest(true, true) },
  })

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim()
    const attachmentIds = pendingAttachments.reduce<string[]>((ids, item) => {
      if (item.status === 'ready' && item.attachmentId) ids.push(item.attachmentId)
      return ids
    }, [])
    if ((!text && attachmentIds.length === 0) || !membershipId || isOffline || pendingAttachments.some(item => item.status === 'uploading')) return
    if (members.some(member => member.principalType === 'agent')) {
      const consented = await requestAiDataConsent({ accountId: accountId ?? '', kind: 'room',
        title: t('ai_consent_room_title'), message: t('ai_consent_room_body'),
        allowLabel: t('ai_consent_allow_room'), declineLabel: t('ai_consent_not_now'), privacyLabel: t('ai_consent_privacy') })
      if (!consented) return
    }
    if (!acquireDesktopRoomSend(sendMutex.current)) return
    setSending(true)
    setSendError(false)
    try {
      await model.sendMessage({
        clientMessageId: createRoomClientMessageId(),
        text,
        attachmentIds,
        mentionMembershipIds: selectedMentions.filter(member => containsMentionToken(text, member.displayAlias)).map(member => member.id),
      })
      if (!model.isCurrent()) return
      if (accountId) removeRoomDraft(accountId, roomId)
      setDraft('')
      setDraftSelection(undefined)
      setSelectedMentions([])
      setPendingAttachments([])
      shouldAutoFollow.current = true
      scrollToLatest(true, true)
    } catch {
      if (model.isCurrent()) setSendError(true)
    } finally {
      releaseDesktopRoomSend(sendMutex.current)
      if (model.isCurrent()) setSending(false)
    }
  }, [accountId, draft, isOffline, members, membershipId, model, pendingAttachments, roomId, scrollToLatest, selectedMentions, t])

  const sendCurrent = useCallback(async () => {
    if (voice.phase === 'listening') {
      const result = await voice.stopRecording({ skipRefine: true })
      await send(result?.draft)
      return
    }
    if (voice.phase === 'refining') {
      const visibleDraft = draft
      await voice.cancelRecording()
      await send(visibleDraft)
      return
    }
    await send()
  }, [draft, send, voice])

  const uploadAttachment = useCallback(async (item: PendingRoomAttachment) => {
    const signal = attachmentScope.current.signal
    if (signal.aborted || attachmentUploadLocks.current.has(item.id)) return
    attachmentUploadLocks.current.add(item.id)
    try {
      const attachmentId = await uploadRoomAttachment(roomId, item, signal)
      if (signal.aborted) return
      setPendingAttachments(current => current.map(candidate => candidate.id === item.id ? { ...candidate, attachmentId, status: 'ready' } : candidate))
    } catch {
      if (signal.aborted) return
      setAttachmentError(true)
      setPendingAttachments(current => current.map(candidate => candidate.id === item.id ? { ...candidate, status: 'failed' } : candidate))
    } finally {
      attachmentUploadLocks.current.delete(item.id)
    }
  }, [roomId])

  const uploadPickedAttachments = useCallback(async (picked: RoomPickedFile[]) => {
    setAttachmentError(false)
    const selected = picked.slice(0, 10 - pendingAttachments.length).map<PendingRoomAttachment>(item => ({ ...item, id: createRoomClientMessageId(), attachmentId: null, status: 'uploading' }))
    setPendingAttachments(current => [...current, ...selected])
    for (const item of selected) await uploadAttachment(item)
  }, [pendingAttachments.length, uploadAttachment])

  const retryAttachment = useCallback(async (item: PendingRoomAttachment) => {
    if (item.status !== 'failed' || isOffline || sending) return
    setAttachmentError(false)
    setPendingAttachments(current => current.map(candidate => candidate.id === item.id ? { ...candidate, status: 'uploading' } : candidate))
    await uploadAttachment({ ...item, status: 'uploading' })
  }, [isOffline, sending, uploadAttachment])

  const pickAttachment = useCallback(async (kind: DesktopRoomAttachmentKind) => {
    if (isOffline || sending || pendingAttachments.length >= 10) return
    setAttachmentMenuOpen(false)
    setAttachmentError(false)
    try {
      const file = await pickDesktopRoomAttachment()
      if (!file) return
      if (!acceptsDesktopRoomAttachmentKind(file.mimeType, kind, file.name)) throw new Error('desktop_room_attachment_type_mismatch')
      await uploadPickedAttachments([file])
    } catch {
      setAttachmentError(true)
    }
  }, [isOffline, pendingAttachments.length, sending, uploadPickedAttachments])

  useDesktopFileDrop(files => uploadPickedAttachments(files.map(file => ({
    name: file.name, mimeType: guessMimeType(file.name), size: file.size, readBytes: file.readBytes, handle: file.handle,
  }))), active && !isOffline && !sending && pendingAttachments.length < 10)

  const handlePasteImage = useCallback((event: ClipboardEvent) => {
    const files = extractDesktopRoomClipboardImages(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    if (!room || !getDesktopRoomComposerState(room.status, Boolean(membershipId), readActive, room.membershipStatus).active || isOffline || sending) return
    if (pendingAttachments.length >= 10) {
      setAttachmentError(true)
      return
    }
    void uploadPickedAttachments(files)
  }, [room, membershipId, readActive, isOffline, sending, pendingAttachments.length, uploadPickedAttachments])

  const mentionItems = useMemo(
    () => mentionOpen ? flattenMentionGroups(filterRoomMemberGroups(groupRoomMembers(members, accountId), getMentionQuery(draft) ?? '')) : [],
    [accountId, draft, members, mentionOpen],
  )
  const activeMentionIndex = Math.min(mentionIndex, Math.max(mentionItems.length - 1, 0))
  // `fromPicker` completes the typed `@query`; a mention started from a message is appended instead.
  const selectMention = useCallback((member: RoomMemberView, fromPicker = false) => {
    const insertion = createMentionInsertion(draftRef.current, member.displayAlias, fromPicker)
    setSelectedMentions(current => current.some(item => item.id === member.id) ? current : [...current, member])
    setDraft(insertion.text)
    setDraftSelection(insertion.selection)
    setMentionOpen(false)
    void InteractionManager.runAfterInteractions(() => inputRef.current?.focus())
  }, [])
  const handleComposerKey = useCallback((input: { key: string; shiftKey: boolean; isComposing: boolean }) => {
    if (!mentionOpen) return false
    const action = resolveDesktopMentionKey(input, activeMentionIndex, mentionItems.length)
    if (!action) return false
    if (action.type === 'move') setMentionIndex(action.index)
    else if (action.type === 'close') setMentionOpen(false)
    else selectMention(mentionItems[activeMentionIndex], true)
    return true
  }, [activeMentionIndex, mentionItems, mentionOpen, selectMention])
  const updateDraft = useCallback((value: string) => {
    if (voice.phase === 'refining') void voice.cancelRecording()
    const openMention = shouldOpenMentionPicker(draft, value)
    setDraft(value)
    if (draftSelection !== undefined) setDraftSelection(undefined)
    if (mentionIndex !== 0) setMentionIndex(0)
    if (selectedMentions.length > 0) {
      setSelectedMentions(current => {
        const retained = current.filter(member => containsMentionToken(value, member.displayAlias))
        return retained.length === current.length ? current : retained
      })
    }
    if (openMention) {
      setAttachmentMenuOpen(false)
      setMentionOpen(true)
    }
  }, [draft, draftSelection, mentionIndex, selectedMentions.length, voice])

  if (state !== 'ready' || !room) {
    return <DesktopRoomPublicLoadState state={state} offline={isOffline} retry={loadInitial} />
  }
  const composerState = getDesktopRoomComposerState(
    room.status,
    Boolean(membershipId),
    readActive,
    room.membershipStatus,
  )

  return <View testID="desktop-room-public-conversation" style={[styles.root, { backgroundColor: colors.bg }]}>
    {isOffline ? <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: colors.surfaceHover }]}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.textSecondary} />
      <Text style={[styles.offlineText, { color: colors.textSecondary }]}>{t('spaces_offline_draft_notice')}</Text>
    </View> : null}
    <DesktopRoomPublicTimeline
      accountId={accountId}
      activeRef={activeRef}
      hasOlder={hasOlder}
      loadingOlder={loadingOlder}
      olderLoadFailed={olderLoadFailed}
      loadOlderMessages={loadOlderMessages}
      members={members}
      messages={messages}
      onMention={selectMention}
      readingPositionRestored={readingPositionRestored}
      roomId={roomId}
      scrollRef={scrollRef}
      scrollToLatest={scrollToLatest}
      setShowScrollToLatest={setShowScrollToLatest}
      shouldAutoFollow={shouldAutoFollow}
      showScrollToLatest={showScrollToLatest}
    />
    <View style={styles.composerShell}>
      <DesktopRoomMentionPopover visible={mentionOpen} items={mentionItems} activeIndex={activeMentionIndex} onSelect={member => selectMention(member, true)} />
      <DesktopRoomPublicComposer active={composerState.active} readOnlyLabel={t(composerState.readOnlyKey)} roomName={room.name}
        draft={draft} selection={draftSelection} inputRef={inputRef} inputFocused={inputFocused}
        setInputFocused={handleComposerFocusChange}
        onKeyIntercept={handleComposerKey}
        mentionCombobox={mentionOpen ? { activeOptionId: mentionItems.length > 0 ? desktopMentionOptionId(mentionItems[activeMentionIndex].id) : null } : undefined}
        onChangeText={updateDraft} onSelectionChange={event => {
          if (!draftSelection) return
          const selection = event.nativeEvent.selection
          if (selection.start === draftSelection.start && selection.end === draftSelection.end) requestAnimationFrame(() => setDraftSelection(undefined))
        }}
        onPasteImage={handlePasteImage}
        onSend={() => { void sendCurrent() }} pendingAttachments={pendingAttachments} setPendingAttachments={setPendingAttachments}
        onRetryAttachment={item => { void retryAttachment(item) }}
        sendError={sendError} attachmentError={attachmentError} sending={sending} isOffline={isOffline} showMenu={attachmentMenuOpen}
        setShowMenu={next => { setMentionOpen(false); setAttachmentMenuOpen(next) }}
        onPickMedia={() => { void pickAttachment('media') }} onPickFiles={() => { void pickAttachment('file') }}
        voice={{ phase: voice.phase, meterLevel: voice.meterLevel, startRecording: voice.startRecording, stopRecording: voice.stopRecording }} colors={colors} />
    </View>
  </View>
}

const DesktopRoomPublicTimeline = memo(function DesktopRoomPublicTimeline({
  accountId,
  activeRef,
  hasOlder,
  loadingOlder,
  olderLoadFailed,
  loadOlderMessages,
  members,
  messages,
  onMention,
  readingPositionRestored,
  roomId,
  scrollRef,
  scrollToLatest,
  setShowScrollToLatest,
  shouldAutoFollow,
  showScrollToLatest,
}: {
  accountId: string | null
  activeRef: MutableRefObject<boolean>
  hasOlder: boolean
  loadingOlder: boolean
  olderLoadFailed: boolean
  loadOlderMessages(): Promise<void>
  members: RoomMemberView[]
  messages: RoomMessageView[]
  onMention(member: RoomMemberView): void
  readingPositionRestored: MutableRefObject<boolean>
  roomId: string
  scrollRef: RefObject<DesktopRoomTimelineHandle | null>
  scrollToLatest(animated: boolean, force?: boolean): void
  setShowScrollToLatest(value: boolean): void
  shouldAutoFollow: MutableRefObject<boolean>
  showScrollToLatest: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const previousHistoryOffset = useRef(0)
  const olderHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (olderHistoryTimer.current) clearTimeout(olderHistoryTimer.current)
  }, [])
  const membersById = useMemo(() => new Map(members.map(member => [member.id, member])), [members])
  const newestFirst = useMemo(() => visibleDesktopRoomMessages(messages).reverse(), [messages])

  return <View style={styles.messages}>
    <DesktopRoomMessageTimeline ref={scrollRef} data={newestFirst}
      onScroll={({ nativeEvent }) => {
        const offset = Math.max(0, nativeEvent.contentOffset.y)
        const distanceToOlder = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - offset
        const shouldLoadOlder = offset > previousHistoryOffset.current
          && distanceToOlder < Math.max(1600, nativeEvent.layoutMeasurement.height * 4)
          && hasOlder && !loadingOlder && !olderLoadFailed
        if (shouldLoadOlder && !olderHistoryTimer.current) olderHistoryTimer.current = setTimeout(() => {
          olderHistoryTimer.current = null
          if (activeRef.current) void loadOlderMessages()
        }, 32)
        previousHistoryOffset.current = offset
        const followsLatest = isDesktopRoomFollowingLatest(offset)
        shouldAutoFollow.current = followsLatest
        setShowScrollToLatest(!followsLatest)
        if (accountId && activeRef.current && readingPositionRestored.current) {
          desktopShellWindowState.setReadingPosition(
            accountId,
            { kind: 'room', id: roomId },
            { scrollTop: offset, distanceFromBottom: offset, savedAt: Date.now() },
          )
        }
      }}
      ListEmptyComponent={<View style={styles.empty}><Ionicons name="chatbubbles-outline" size={30} color={colors.textTertiary} /><Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('spaces_latest_message_empty')}</Text></View>}
      ListFooterComponent={<DesktopRoomHistoryState loading={loadingOlder} failed={hasOlder && olderLoadFailed} retry={loadOlderMessages} />}
      ListEndComponent={<Text style={[styles.latestBoundary, { color: colors.textTertiary }]}>{t('conversation_latest_boundary')}</Text>}
      renderItem={({ item, index }) => <View>
        {shouldShowRoomTimeSeparator(item.createdAt, newestFirst[index + 1]?.createdAt) ? <TimeSeparator ts={Date.parse(item.createdAt)} /> : null}
        <DesktopRoomPublicMessage message={item} roomId={roomId} currentUserId={accountId} mentionMember={membersById.get(item.author.membershipId)} onMention={onMention} />
      </View>} />
    {showScrollToLatest ? <DesktopScrollToLatestButton testID="desktop-room-scroll-latest" colors={colors} onPress={() => scrollToLatest(true, true)} /> : null}
  </View>
})

function DesktopRoomPublicLoadState({ state, offline, retry }: {
  state: 'loading' | 'ready' | 'forbidden' | 'failed'
  offline: boolean
  retry(): Promise<void>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (state === 'loading' || state === 'ready') return <View accessibilityRole="progressbar" style={styles.center}><ActivityIndicator color={colors.brand} /></View>
  const kind = getDesktopRoomUnavailableKind(state, offline)
  const forbidden = kind === 'forbidden'
  return <View testID={`desktop-room-public-${kind}`} accessibilityRole={!forbidden ? 'alert' : undefined} style={styles.center}>
    <Ionicons name={forbidden ? 'lock-closed-outline' : 'cloud-offline-outline'} size={34} color={colors.textTertiary} />
    <Text style={[styles.loadTitle, { color: colors.text }]}>{t(forbidden
      ? 'spaces_no_permission'
      : kind === 'offline'
        ? 'desktop_room_offline_unavailable'
        : 'spaces_load_failed')}</Text>
    {kind === 'failed' ? <Pressable accessibilityRole="button" accessibilityLabel={t('retry')} onPress={() => void retry()} style={styles.retry}><Text style={{ color: colors.brand }}>{t('retry')}</Text></Pressable> : null}
  </View>
}

function DesktopRoomHistoryState({ loading, failed, retry }: { loading: boolean; failed: boolean; retry(): Promise<void> }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (!loading && !failed) return null
  return <View testID={failed ? 'desktop-room-history-failed' : 'desktop-room-history-loading'} accessibilityRole={failed ? 'alert' : 'progressbar'} style={styles.history}>
    {loading ? <><ActivityIndicator size="small" color={colors.brand} /><Text style={[styles.historyText, { color: colors.textSecondary }]}>{t('conversation_history_loading')}</Text></> : <Pressable accessibilityRole="button" accessibilityLabel={t('retry')} onPress={() => void retry()} style={styles.historyRetry}><Text style={{ color: colors.brand }}>{t('spaces_load_failed')} · {t('retry')}</Text></Pressable>}
  </View>
}

const DesktopRoomPublicMessage = memo(function DesktopRoomPublicMessage({ message, roomId, currentUserId, mentionMember, onMention }: { message: RoomMessageView; roomId: string; currentUserId: string | null; mentionMember?: RoomMemberView; onMention(member: RoomMemberView): void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { typography } = useChatFontSize()
  const [hovered, setHovered] = useState(false)
  const [metaFocused, setMetaFocused] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
  }, [])
  if (message.kind === 'system') return <Text style={[styles.system, typography.system, { color: colors.textSecondary }]}>{formatRoomSystemMessage(message, t)}</Text>
  const ownHuman = isOwnRoomAuthor(message.author, currentUserId) && message.author.principalType !== 'agent'
  const agent = message.author.principalType === 'agent'
  const displayName = mentionMember?.displayAlias ?? message.author.displayName
  const aiSourceLabel = agent
    ? t(message.source === 'app' || message.source === 'cli'
      ? 'spaces_message_human_reply' : 'spaces_message_ai_generated')
    : message.source === 'managed_agent'
      ? t('spaces_message_ai_generated')
      : message.source === 'cli' ? t('spaces_message_ai_sent') : null
  const time = formatMessageTime(Date.parse(message.createdAt), { yesterdayLabel: t('time_yesterday') })
  const copy = () => {
    if (!message.text) return
    void Clipboard.setStringAsync(message.text).then(() => {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1600)
    })
  }
  const avatar = <RoomIdentityAvatar name={displayName} avatar={avatarFromSnapshot(message.author.avatar)} agent={agent} ownerAvatar={null} size={32} />
  return <View testID={`desktop-room-message-${message.id}`} style={[styles.messageRow, ownHuman && styles.ownRow]}>
    {!ownHuman ? avatar : null}
    <View
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={[styles.messageColumn, ownHuman && styles.ownColumn]}
    >
      {!ownHuman ? <Pressable disabled={!mentionMember} accessibilityRole={mentionMember ? 'button' : undefined}
        accessibilityLabel={mentionMember ? t('spaces_mention_member', { name: displayName }) : undefined}
        onPress={() => mentionMember && onMention(mentionMember)} style={styles.authorButton}>
        <Text numberOfLines={1} style={[styles.author, typography.author, { color: colors.textSecondary }]}>{displayName}</Text>
      </Pressable> : null}
      <View style={[styles.bubble, { backgroundColor: ownHuman ? colors.ownMessage : colors.surface }]}>
        {message.deletedAt || message.text ? <Text style={[styles.bodyText, roomMessageTextWrapStyle, typography.body, { color: colors.text }]}>{message.deletedAt ? t('spaces_message_deleted') : message.text}</Text> : null}
        {!message.deletedAt && message.attachments.length > 0 ? <View style={styles.messageAttachments}>{message.attachments.map(attachment => <RoomMessageAttachment key={attachment.attachmentId} roomId={roomId} attachment={attachment} attachments={message.attachments} />)}</View> : null}
      </View>
      {aiSourceLabel ? <Text style={[styles.aiSource, { color: colors.textTertiary }]}>{aiSourceLabel}</Text> : null}
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.messageMeta,
          ownHuman && styles.ownMessageMeta,
          { opacity: hovered || metaFocused || copied ? 1 : 0 },
        ]}
      >
        {time ? <Text style={[styles.messageTime, { color: colors.textTertiary }]}>{time}</Text> : null}
        {!message.deletedAt && message.text ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('copy')}
            onPress={copy}
            onFocus={() => setMetaFocused(true)}
            onBlur={() => setMetaFocused(false)}
            style={styles.copyButton}
          >
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={copied ? colors.brand : colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  </View>
})

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  center: { flex: 1, minHeight: 180, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadTitle: { ...desktopTypography.dialogTitle, textAlign: 'center' },
  retry: { minWidth: 72, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  offline: { minHeight: 34, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  offlineText: { minWidth: 0, ...desktopTypography.metadata },
  messages: { flex: 1 },
  messageContent: { flexGrow: 1, justifyContent: 'flex-end', width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 14 },
  separator: { height: 10 },
  listEnd: { height: 14 },
  empty: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 9 },
  emptyText: desktopTypography.body,
  history: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  historyText: desktopTypography.caption,
  latestBoundary: { paddingTop: 7, paddingBottom: 2, textAlign: 'center', ...desktopTypography.caption },
  historyRetry: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  composerShell: { position: 'relative' },
  messageRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingRight: 52 },
  ownRow: { justifyContent: 'flex-end', paddingLeft: 52, paddingRight: 0 },
  messageColumn: { position: 'relative', minWidth: 0, maxWidth: '100%', flexShrink: 1, alignItems: 'flex-start' },
  ownColumn: { alignItems: 'flex-end' },
  authorButton: {
    minWidth: 0,
    maxWidth: '100%',
    minHeight: 22,
    justifyContent: 'flex-start',
    alignSelf: 'flex-start',
  },
  author: { minWidth: 0, maxWidth: '100%', ...desktopTypography.metadata },
  bubble: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  bodyText: desktopTypography.chatBody,
  aiSource: { marginTop: 3, marginHorizontal: 2, ...desktopTypography.caption },
  messageAttachments: { marginTop: 8, gap: 6 },
  messageMeta: { position: 'absolute', bottom: -20, minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 2 },
  ownMessageMeta: { justifyContent: 'flex-end' },
  messageTime: desktopTypography.caption,
  copyButton: { width: 24, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  system: { ...desktopTypography.metadata, alignSelf: 'center', marginVertical: 4, textAlign: 'center' },
})
