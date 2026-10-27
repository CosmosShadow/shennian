// @arch docs/features/network-rooms/ui.md#五web--desktop-web
// @test src/__tests__/room-conversation-screen.test.ts
// @test src/__tests__/chat-keyboard-avoider.test.ts

import { uploadRoomAttachment, pickDesktopRoomAttachment } from './roomAccountAttachments'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { HeaderBackButton } from '../../components/AppPageHeader'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useIsFocused } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import type { RoomMessageView } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useAppIsActive } from '../../hooks/useAppIsActive'
import { useTheme } from '../../hooks/useTheme'
import type { RoomMemberView } from './types'
import { RoomDetailsPanel } from './components/RoomDetailsPanel'
import { RoomDetailsButton } from './components/RoomDetailsButton'
import { RoomHeaderTitle } from './components/RoomHeaderTitle'
import type { RoomSettingsPage } from './RoomSettingsScreen'
import { RoomMentionPicker } from './components/RoomMentionPicker'
import { RoomMessageRow } from './components/RoomMessageRow'
import { TimeSeparator } from '../../components/chat/TimeSeparator'
import { RoomMemberProfileSheet } from './components/RoomMemberProfileSheet'
import { useComposerBottomInset } from '../chat/hooks/useComposerBottomInset'
import { useVoiceDraft } from '../chat/hooks/useVoiceDraft'
import { guessMimeType } from '../../components/chat/fileOperations'
import { isDesktopControlSurfaceEnabled } from '../../utils/controlSurfaceLayout'
import { useDesktopFileDrop } from '../desktop-control/useDesktopFileDrop'
import {
  buildNativeRoomPickedMedia,
  type RoomPickedFile,
} from './roomAttachments'
import {
  containsMentionToken,
  createMentionInsertion,
  shouldOpenMentionPicker,
} from './roomMentions'
import { usesInlineRoomDetails } from './roomAgentNavigation'
import { shouldShowRoomTimeSeparator } from './roomMessageTimeline'
import { RoomComposer } from './components/RoomComposer'
import { RoomLoadState } from './components/RoomLoadState'
import { RoomHistoryLoadState } from './components/RoomHistoryLoadState'
import { roomConversationStyles as styles } from './RoomConversationScreen.styles'
import { createRoomClientMessageId as createClientMessageId } from './roomConversationUtils'
import { removeRoomDraft } from './roomDraftStorage'
import { useRoomDraftPersistence, type PendingRoomAttachment } from './useRoomDraftPersistence'
import { useRoomConversationModel } from './useRoomConversationModel'
import { requestAiDataConsent } from '../privacy/aiDataConsent'

type Props = {
  roomId: string
  embedded?: boolean
  hideHeader?: boolean
  readActive?: boolean
  onClose?: () => void
}

function RoomMessageSeparator() {
  return <View style={styles.messageSeparator} />
}

function RoomMessageFooter() {
  return <View style={styles.messageFooter} />
}

export function RoomConversationScreen(props: Props) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return <RoomConversationContent key={JSON.stringify([accountId, props.roomId])} {...props} />
}

function RoomConversationContent({
  roomId,
  embedded = false,
  hideHeader = false,
  readActive = true,
  onClose,
}: Props) {
  const router = useRouter()
  const isScreenFocused = useIsFocused()
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const composerBottomInset = useComposerBottomInset(insets.bottom)
  const networkStatus = useNetworkStatus()
  const appIsActive = useAppIsActive()
  const { width } = useWindowDimensions()
  const user = useAuthStore((state) => state.user)
  const attachmentScope = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController()
    attachmentScope.current = controller
    return () => controller.abort()
  }, [roomId, user?.id])
  const [draft, setDraft] = useState('')
  const [draftSelection, setDraftSelection] = useState<{ start: number; end: number } | undefined>()
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsPage, setDetailsPage] = useState<RoomSettingsPage>('overview')
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [selectedMentions, setSelectedMentions] = useState<RoomMemberView[]>([])
  const [profileMember, setProfileMember] = useState<RoomMemberView | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<PendingRoomAttachment[]>([])
  const [inputFocused, setInputFocused] = useState(false)
  const [showComposerMenu, setShowComposerMenu] = useState(false)
  const scrollRef = useRef<FlatList<RoomMessageView>>(null)
  const inputRef = useRef<TextInput>(null)
  const shouldAutoFollow = useRef(true)
  const [readingHistory, setReadingHistory] = useState(false)
  const conversationActive = appIsActive && isScreenFocused && readActive
  const activeRef = useRef(conversationActive)
  activeRef.current = conversationActive
  const isDesktop = isDesktopControlSurfaceEnabled() && usesInlineRoomDetails(width)
  const showDesktopDetails = isDesktop && !embedded
  const isOffline = networkStatus === 'offline'
  const useKeyboardAvoider = !embedded && (Platform.OS === 'ios' || Platform.OS === 'android')
  const keyboardAvoidingBehavior = Platform.OS === 'android' ? 'height' : 'padding'

  const scrollToLatest = useCallback((animated: boolean, force = false) => {
    if (!activeRef.current || (!force && !shouldAutoFollow.current)) return
    requestAnimationFrame(() => {
      if (activeRef.current && (force || shouldAutoFollow.current)) {
        scrollRef.current?.scrollToOffset({ offset: 0, animated })
      }
    })
  }, [])

  const onNewMessages = useCallback(() => scrollToLatest(true), [scrollToLatest])
  const model = useRoomConversationModel({ roomId, accountId: user?.id ?? null, networkStatus,
    active: conversationActive, onNewMessages })
  const { room, membershipId, members, messages, hasOlder, loadingOlder, olderLoadFailed, state,
    setRoom, setMembers, loadInitial, loadOlderMessages } = model

  useRoomDraftPersistence({
    accountId: user?.id ?? null,
    roomId,
    draft,
    setDraft,
    pendingAttachments,
    setPendingAttachments,
    members,
    selectedMentions,
    setSelectedMentions,
  })

  const voice = useVoiceDraft({
    sessionId: roomId,
    active: conversationActive,
    sessionDraftEnabled: false,
    currentDraft: draft,
    onListeningTextChange: (nextText) => {
      setDraftSelection(undefined)
      setDraft(nextText)
    },
    onDraftReady: (result) => {
      setDraftSelection(undefined)
      setDraft(result.draft)
      scrollToLatest(true, true)
    },
  })

  const handleComposerFocus = useCallback(() => {
    if (voice.phase === 'listening' || voice.phase === 'refining') void voice.cancelRecording()
    shouldAutoFollow.current = true
    setReadingHistory(false)
    setInputFocused(true)
    scrollToLatest(false, true)
  }, [scrollToLatest, voice])

  // 选 @成员后的受控光标只服务插入后的第一次落位；失焦即释放，避免残留后把光标拉回旧位置。
  const handleComposerFocusChange = useCallback((focused: boolean) => {
    setInputFocused(focused)
    if (!focused) setDraftSelection(undefined)
  }, [])

  const dismissComposerKeyboard = useCallback(() => {
    inputRef.current?.blur()
    Keyboard.dismiss()
    setInputFocused(false)
    setShowComposerMenu(false)
  }, [])

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? draft).trim()
      const attachmentIds = pendingAttachments.reduce<string[]>((ids, item) => {
        if (item.status === 'ready' && item.attachmentId) ids.push(item.attachmentId)
        return ids
      }, [])
      if (
        (!text && attachmentIds.length === 0) ||
        sending ||
        !membershipId ||
        isOffline ||
        pendingAttachments.some((item) => item.status === 'uploading')
      )
        return
      if (members.some((member) => member.principalType === 'agent')) {
        const consented = await requestAiDataConsent({
          accountId: user?.id ?? '',
          kind: 'room',
          title: t('ai_consent_room_title'),
          message: t('ai_consent_room_body'),
          allowLabel: t('ai_consent_allow_room'),
          declineLabel: t('ai_consent_not_now'),
          privacyLabel: t('ai_consent_privacy'),
        })
        if (!consented) return
      }
      dismissComposerKeyboard()
      setSending(true)
      setSendError(false)
      try {
        await model.sendMessage({
          clientMessageId: createClientMessageId(),
          text,
          attachmentIds,
          mentionMembershipIds: selectedMentions
            .filter((member) => containsMentionToken(text, member.displayAlias))
            .map((member) => member.id),
        })
        if (!model.isCurrent()) return
        if (user?.id) removeRoomDraft(user.id, roomId)
        setDraft('')
        setDraftSelection(undefined)
        setSelectedMentions([])
        setPendingAttachments([])
        shouldAutoFollow.current = true
        scrollToLatest(true, true)
      } catch {
        if (model.isCurrent()) setSendError(true)
      } finally {
        if (model.isCurrent()) setSending(false)
      }
    },
    [
      draft,
      model,
      dismissComposerKeyboard,
      isOffline,
      membershipId,
      members,
      pendingAttachments,
      roomId,
      scrollToLatest,
      selectedMentions,
      sending,
      t,
      user?.id,
    ],
  )

  const handleComposerSend = useCallback(async () => {
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

  const uploadPickedAttachments = useCallback(
    async (picked: RoomPickedFile[]) => {
      const signal = attachmentScope.current.signal
      const selected: PendingRoomAttachment[] = picked
        .slice(0, 10 - pendingAttachments.length)
        .map((item) => ({
          ...item,
          id: createClientMessageId(),
          attachmentId: null,
          status: 'uploading',
        }))
      setPendingAttachments((current) => [...current, ...selected])
      for (const item of selected) {
        if (signal.aborted) break
        try {
          const attachmentId = await uploadRoomAttachment(roomId, item, signal)
          if (signal.aborted) break
          setPendingAttachments((current) =>
            current.map((candidate) =>
              candidate.id === item.id
                ? { ...candidate, attachmentId, status: 'ready' }
                : candidate,
            ),
          )
        } catch {
          if (signal.aborted) break
          setPendingAttachments((current) =>
            current.map((candidate) =>
              candidate.id === item.id ? { ...candidate, status: 'failed' } : candidate,
            ),
          )
        }
      }
    },
    [pendingAttachments.length, roomId],
  )

  useDesktopFileDrop(
    (files) =>
      uploadPickedAttachments(
        files.map((file) => ({
          name: file.name,
          mimeType: guessMimeType(file.name),
          size: file.size,
          readBytes: file.readBytes,
          handle: file.handle,
        })),
      ),
    !isOffline && !sending && pendingAttachments.length < 10,
  )

  const pickFiles = useCallback(async () => {
    if (isOffline || sending || pendingAttachments.length >= 10) return
    setShowComposerMenu(false)
    dismissComposerKeyboard()
    try {
      if (Platform.OS === 'web') {
        const desktopFile = await pickDesktopRoomAttachment()
        if (desktopFile) await uploadPickedAttachments([desktopFile])
        return
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (result.canceled) return
      await uploadPickedAttachments(
        result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? 'application/octet-stream',
          size: asset.size ?? 0,
          ...(asset.file ? { file: asset.file } : {}),
        })),
      )
    } catch {
      // Cancellation and picker permission errors leave the draft unchanged.
    }
  }, [
    dismissComposerKeyboard,
    isOffline,
    pendingAttachments.length,
    sending,
    uploadPickedAttachments,
  ])

  const pickMedia = useCallback(async () => {
    if (isOffline || sending || pendingAttachments.length >= 10) return
    setShowComposerMenu(false)
    dismissComposerKeyboard()
    try {
      if (Platform.OS === 'web') {
        const desktopFile = await pickDesktopRoomAttachment()
        if (desktopFile) await uploadPickedAttachments([desktopFile])
        return
      }
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) return
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        quality: 0.85,
      })
      if (result.canceled) return
      const stamp = Date.now()
      await uploadPickedAttachments(
        result.assets.map((asset, index) => buildNativeRoomPickedMedia(asset, stamp, index)),
      )
    } catch {
      // Cancellation and picker permission errors leave the draft unchanged.
    }
  }, [
    dismissComposerKeyboard,
    isOffline,
    pendingAttachments.length,
    sending,
    uploadPickedAttachments,
  ])

  const takePhoto = useCallback(async () => {
    if (Platform.OS === 'web' || isOffline || sending || pendingAttachments.length >= 10) return
    setShowComposerMenu(false)
    dismissComposerKeyboard()
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) return
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
      if (result.canceled) return
      const stamp = Date.now()
      await uploadPickedAttachments(result.assets.map((asset, index) => buildNativeRoomPickedMedia(asset, stamp, index)))
    } catch {
      // Cancellation and camera permission errors leave the draft unchanged.
    }
  }, [dismissComposerKeyboard, isOffline, pendingAttachments.length, sending, uploadPickedAttachments])

  const selectMention = useCallback(
    (member: RoomMemberView) => {
      const insertion = createMentionInsertion(draft, member.displayAlias)
      setSelectedMentions((current) =>
        current.some((item) => item.id === member.id) ? current : [...current, member],
      )
      setDraft(insertion.text)
      setDraftSelection(insertion.selection)
      setMentionPickerOpen(false)
      void InteractionManager.runAfterInteractions(() => {
        inputRef.current?.focus()
      })
    },
    [draft],
  )

  const handleDraftChange = useCallback(
    (value: string) => {
      if (voice.phase === 'refining') void voice.cancelRecording()
      const openMentionPicker = shouldOpenMentionPicker(draft, value)
      setDraftSelection(undefined)
      setDraft(value)
      setSelectedMentions((current) =>
        current.filter((member) => containsMentionToken(value, member.displayAlias)),
      )
      if (openMentionPicker) {
        dismissComposerKeyboard()
        setMentionPickerOpen(true)
      }
    },
    [dismissComposerKeyboard, draft, voice],
  )

  const handleDraftSelectionChange = useCallback(
    (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
      if (!draftSelection) return
      const { selection } = event.nativeEvent
      if (selection.start !== draftSelection.start || selection.end !== draftSelection.end) return
      requestAnimationFrame(() =>
        setDraftSelection((current) =>
          current?.start === selection.start && current.end === selection.end ? undefined : current,
        ),
      )
    },
    [draftSelection],
  )

  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  )
  const newestFirstMessages = useMemo(() => [...messages].reverse(), [messages])

  if (state !== 'ready' || !room) {
    return <RoomLoadState state={state} retry={loadInitial} />
  }

  const details = (
    <RoomDetailsPanel
      roomId={roomId}
      room={room}
      members={members}
      currentUserId={user?.id}
      page={detailsPage}
      onPageChange={setDetailsPage}
      onRoomUpdated={setRoom}
      onMembersUpdated={setMembers}
    />
  )
  const conversationLayout = (
    <View style={styles.layout}>
      <View style={styles.conversation}>
        {!hideHeader ? (
          <View style={[styles.header, { borderBottomColor: colors.separator ?? colors.border }]}>
            {embedded && onClose ? (
              <Pressable
                testID="room-panel-close"
                style={styles.headerButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('close')}
              >
                <Ionicons name="chevron-forward" size={21} color={colors.textSecondary} />
              </Pressable>
            ) : !isDesktop ? (
              <HeaderBackButton testID="room-back-action" onPress={() => router.back()} />
            ) : null}
            <RoomHeaderTitle name={room.name} count={members.length} style={styles.headerCenter} textStyle={[styles.title, !isDesktop && styles.mobileTitle]} />
            <RoomDetailsButton
              roomId={roomId}
              canApprove={room.status === 'active' && members.some((member) => member.principalType === 'human' && member.ownerUserId === user?.id && member.role === 'owner')}
              active={detailsOpen} style={styles.detailsButton}
              onBeforeOpen={dismissComposerKeyboard}
              onOpenInline={() => { if (!detailsOpen) setDetailsPage('overview'); setDetailsOpen((open) => !open) }}
              inline={showDesktopDetails || embedded}
            />
          </View>
        ) : null}
        {isOffline ? (
          <View
            style={[styles.offlineBanner, { backgroundColor: colors.surfaceHover }]}
            accessibilityRole="alert"
          >
            <Ionicons name="cloud-offline-outline" size={15} color={colors.textSecondary} />
            <Text style={[styles.offlineText, { color: colors.textSecondary }]}>
              {t('spaces_offline_draft_notice')}
            </Text>
          </View>
        ) : null}
        <FlatList
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messageContent}
          inverted
          data={newestFirstMessages}
          keyExtractor={(message) => message.id}
          initialNumToRender={24}
          maxToRenderPerBatch={20}
          windowSize={9}
          ItemSeparatorComponent={RoomMessageSeparator}
          ListHeaderComponent={RoomMessageFooter}
          ListFooterComponentStyle={styles.messageHeader}
          // Anchor only while reading history. In a short, top-aligned inverted
          // list, keyboard resizing moves every cell's frame; native anchoring
          // mistakes that layout change for inserted content and scrolls it away.
          maintainVisibleContentPosition={readingHistory ? {
            minIndexForVisible: 0,
            ...(conversationActive ? { autoscrollToTopThreshold: 120 } : {}),
          } : undefined}
          onEndReached={() => {
            if (!shouldAutoFollow.current) void loadOlderMessages()
          }}
          onEndReachedThreshold={0.2}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={({ nativeEvent }) => {
            // Threshold must not exceed the actual scrollable range: on a short
            // conversation the list can't scroll past a few px, so a fixed 120px
            // band would always read as "at bottom" and the next unrelated
            // scrollToLatest call (e.g. a background message refresh) would snap
            // the view back down even though the user just scrolled to the top.
            const maxOffset = Math.max(
              0,
              nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height,
            )
            const threshold = Math.min(120, maxOffset)
            shouldAutoFollow.current = nativeEvent.contentOffset.y < threshold || maxOffset === 0
            setReadingHistory(!shouldAutoFollow.current)
          }}
          ListFooterComponent={
            <RoomHistoryLoadState
              state={loadingOlder ? 'loading' : hasOlder && olderLoadFailed ? 'failed' : 'idle'}
              retry={loadOlderMessages}
            />
          }
          renderItem={({ item: message, index }) => (
            <View>
              {shouldShowRoomTimeSeparator(message.createdAt, newestFirstMessages[index + 1]?.createdAt) ? (
                <TimeSeparator ts={Date.parse(message.createdAt)} />
              ) : null}
              <RoomMessageRow
                message={message}
                roomId={roomId}
                currentUserId={user?.id}
                mentionMember={membersById.get(message.author.membershipId)}
                memberCount={members.length}
                onMention={selectMention}
                onOpenProfile={setProfileMember}
                onPressMessage={dismissComposerKeyboard}
              />
            </View>
          )}
        />
        {Platform.OS !== 'web' && showComposerMenu ? (
          <Pressable
            style={styles.composerMenuBackdrop}
            onPress={() => setShowComposerMenu(false)}
          />
        ) : null}
        <RoomComposer
          roomId={roomId}
          active={Boolean(membershipId && room.status === 'active')}
          readonlyMessage={
            room.membershipStatus === 'removed'
              ? t('spaces_removed_readonly')
              : room.membershipStatus === 'left'
                ? t('spaces_left_readonly')
                : room.status !== 'active'
                  ? t('spaces_archived_readonly')
                  : undefined
          }
          draft={draft}
          selection={draftSelection}
          inputRef={inputRef}
          inputFocused={inputFocused}
          setInputFocused={handleComposerFocusChange}
          onFocus={handleComposerFocus}
          onChangeText={handleDraftChange}
          onSelectionChange={handleDraftSelectionChange}
          onSend={() => void handleComposerSend()}
          pendingAttachments={pendingAttachments}
          setPendingAttachments={setPendingAttachments}
          sendError={sendError}
          sending={sending}
          isOffline={isOffline}
          showMenu={showComposerMenu}
          setShowMenu={setShowComposerMenu}
          onPickMedia={() => void pickMedia()}
          onTakePhoto={() => void takePhoto()}
          onPickFiles={() => void pickFiles()}
          voice={voice}
          colors={colors}
          isDark={isDark}
          bottomInset={composerBottomInset}
        />
      </View>
      {showDesktopDetails && detailsOpen ? (
        <View
          style={[
            styles.details,
            { borderLeftColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          {detailsOpen ? details : null}
        </View>
      ) : null}
    </View>
  )
  return (
    <SafeAreaView
      testID={embedded ? 'room-conversation-embedded' : 'room-conversation-page'}
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={embedded ? [] : ['top']}
    >
      {useKeyboardAvoider ? (
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior}
          style={styles.keyboardView}
          onLayout={() => {
            if (inputFocused) scrollToLatest(false, true)
          }}
        >
          {conversationLayout}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.keyboardView}>{conversationLayout}</View>
      )}
      <RoomMentionPicker
        visible={mentionPickerOpen}
        members={members}
        currentUserId={user?.id}
        onSelect={selectMention}
        onClose={() => setMentionPickerOpen(false)}
      />
      <RoomMemberProfileSheet
        member={profileMember}
        members={members}
        visible={Boolean(profileMember)}
        roomId={roomId}
        currentUserId={user?.id}
        onMemberUpdated={(updated) => {
          setMembers((current) =>
            current.map((member) => (member.id === updated.id ? updated : member)),
          )
          setProfileMember(updated)
        }}
        onClose={() => setProfileMember(null)}
      />
    </SafeAreaView>
  )
}
