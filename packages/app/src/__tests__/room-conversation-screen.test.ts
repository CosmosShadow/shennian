// @covers packages/app/src/features/rooms/RoomConversationScreen.tsx
// @covers packages/app/src/features/rooms/useRoomConversationModel.native.ts
// @covers packages/app/src/features/rooms/components/RoomHistoryLoadState.tsx
// @covers packages/app/src/features/rooms/components/RoomMessageRow.tsx
// @covers packages/app/src/features/rooms/components/RoomMemberGrid.tsx
// @covers packages/app/src/features/rooms/components/RoomIdentityAvatar.tsx
// @covers packages/app/src/features/chat/components/ComposerInputCard.tsx
// @covers packages/app/src/features/rooms/components/RoomComposer.tsx
// @covers open-source/packages/shared/src/i18n/zh-core-part-2.ts

import { readI18nSource } from './i18n-source-test-helper'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
import en from '../../../../open-source/packages/shared/src/i18n/en'

describe('Room conversation screen structure', () => {
  it('loads details, members and incrementally ordered messages from the Room APIs', () => {
    const screen = readFileSync(
      resolve(__dirname, '../features/rooms/RoomConversationScreen.tsx'),
      'utf8',
    )
    const native = readFileSync(
      resolve(__dirname, '../features/rooms/useRoomConversationModel.native.ts'),
      'utf8',
    )
    const source = screen + native
    expect(screen).toContain("from './useRoomConversationModel'")
    expect(screen).not.toContain('db.')
    const historyState = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomHistoryLoadState.tsx'),
      'utf8',
    )
    expect(source).toContain('roomAccountClient.getRoom(roomId)')
    expect(source).toContain('roomAccountClient.listMembers(roomId)')
    expect(source).toContain('roomAccountClient.listMessages(roomId, {')
    expect(source).toContain('before,')
    expect(source).toContain('after,')
    expect(source).toContain('roomAccountClient.updateReadState(roomId, sequence)')
    expect(source).not.toContain('authApi')
    expect(source).toContain('subscribeRoomEvents')
    expect(source).toContain("event.event === 'room.message.created'")
    expect(source).toContain("event.event === 'room.sync.request'")
    expect(source).toContain('compareSequence(event.message.sequence, expected) > 0')
    expect(native).toContain('setRoom((current) => current && compareSequence(event.message.sequence, current.lastSequence) > 0')
    expect(native).toContain('setRoom((current) => current && compareSequence(message.sequence, current.lastSequence) > 0')
    expect(native).toContain('setRoom((current) => current && compareSequence(after, current.lastSequence) > 0')
    expect(native).toMatch(/compareSequence\(event\.message\.sequence, expected\) > 0\) \{\s+\/\/[^\n]+\s+pendingGapRef\.current = true\s+void recoverNewMessages\(\)\s+return/)
    expect(source).toContain("previous === 'offline' && networkStatus === 'online'")
    expect(source).not.toContain('setInterval(() => void pullNewMessages(), 3000)')
    expect(source).not.toContain('setInterval(() => void recoverNewMessages(), 15_000)')
    expect(source).toContain('publishRoomLocalRead(roomId, sequence)')
    expect(source).toContain('const isScreenFocused = useIsFocused()')
    expect(source).toContain('compareSequence(sequence, roomLastSequence) !== 0')
    expect(source).toContain('shouldReportRoomRead(lastReportedReadRef.current, scope, sequence)')
    expect(historyState).toContain("t('spaces_load_failed')")
    expect(historyState).toContain('testID="room-history-retry"')
    expect(source).toContain('maintainVisibleContentPosition')
    expect(source).toMatch(
      /onEndReached=\{\(\) => \{\s+if \(!shouldAutoFollow\.current\) void loadOlderMessages\(\)/,
    )
    expect(source).toContain('onEndReachedThreshold={0.2}')
    expect(source).toContain('if (!before || !hasOlder || loadingOlderRef.current) return')
    expect(source).toContain('loadingOlderRef.current = true')
    expect(source).toContain('loadingOlderRef.current = false')
    expect(source).toContain('hasOlder && olderLoadFailed')
    expect(source).toContain('cachedMessages.length > ROOM_MESSAGE_PAGE_SIZE')
    expect(source).toContain('inverted')
    expect(source).toContain('data={newestFirstMessages}')
    expect(source).toContain('[...messages].reverse()')
    expect(source).toContain('newestFirstMessages[index + 1]?.createdAt')
    expect(source).toContain('scrollToOffset({ offset: 0, animated })')
    expect(source).not.toContain('scrollToEnd(')
    expect(source).not.toContain('initialScrollPending')
    expect(source).not.toContain('onContentSizeChange')
    expect(source).toContain(
      'setMessages((current) => mergeMessages(current, messageData.messages).filter',
    )
    expect(source).toContain('detail.room.historyThroughSequence')
    expect(source).toContain('if (!cachedSequence) setHasOlder(messageData.hasMore)')
    expect(source).toContain('conversationActive ? { autoscrollToTopThreshold: 120 } : {}')
    expect(source).toContain(
      'if (!activeRef.current || (!force && !shouldAutoFollow.current)) return',
    )
    expect(source).toContain('ItemSeparatorComponent={RoomMessageSeparator}')
    expect(source).toContain('ListHeaderComponent={RoomMessageFooter}')
    expect(source).toContain('shouldShowRoomTimeSeparator(message.createdAt')
    expect(source).toContain('<TimeSeparator ts={Date.parse(message.createdAt)} />')
  })

  it('keeps people and Agents visually distinct behind one lightweight details entry', () => {
    const conversation = readFileSync(
      resolve(__dirname, '../features/rooms/RoomConversationScreen.tsx'),
      'utf8',
    )
    const members = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomMemberGrid.tsx'),
      'utf8',
    )
    const avatar = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomIdentityAvatar.tsx'),
      'utf8',
    )
    const messageRow = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomMessageRow.tsx'),
      'utf8',
    )
    const messageAttachment = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomMessageAttachment.tsx'),
      'utf8',
    )
    const scopedConversation = readFileSync(
      resolve(__dirname, '../features/rooms/ScopedRoomConversationScreen.tsx'),
      'utf8',
    )
    expect(scopedConversation).not.toContain('setInterval(() => void recover(), 15000)')
    const memberProfile = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomMemberProfileSheet.tsx'),
      'utf8',
    )
    expect(messageRow).toContain("message.author.principalType === 'agent'")
    expect(messageRow).toContain('testID={`room-message-${message.id}`}')
    expect(messageRow).toContain("const ownSent = own && (!agent || message.source === 'app' || message.source === 'cli')")
    expect(messageRow).toContain('{!ownSent ? (')
    expect(messageRow).toContain('style={[styles.messageRow, ownSent && styles.ownRow]}')
    expect(messageRow).not.toContain('{ownSent ? avatarView : null}')
    expect(messageRow).toContain(
      'const displayName = mentionMember?.displayAlias ?? message.author.displayName',
    )
    expect(messageRow).toContain('{displayName}')
    expect(messageRow).toContain(
      "? Platform.OS === 'web' ? colors.ownMessage : isDark ? '#245FC7' : '#1683F7'",
    )
    expect(scopedConversation).toContain(
      'backgroundColor: own ? colors.ownMessage : colors.surfaceHover',
    )
    expect(messageRow).toContain("alignItems: 'flex-start'")
    expect(messageRow).not.toContain('testID={`room-message-${message.id}-mention`}')
    expect(messageRow).not.toContain('>@</Text>')
    expect(messageRow).toContain('onLongPress={showMessageActions}')
    expect(messageRow).toContain("label: t('copy')")
    expect(messageRow).toContain('onLongPress={canMention ? mentionAuthor : undefined}')
    expect(messageRow).toContain('author: roomTypography.author')
    expect(messageRow).not.toContain('agentName:')
    expect(messageRow).not.toContain('>Agent</Text>')
    expect(messageRow).toContain("message.source === 'cli'")
    expect(messageRow).toContain("'spaces_message_human_reply' : 'spaces_message_ai_generated'")
    expect(messageRow).toContain("t('spaces_message_ai_generated')")
    expect(messageRow).toContain("t('spaces_message_ai_sent')")
    expect(messageRow).not.toContain('>· AI</Text>')
    expect(messageRow).toContain('onOpenProfile(mentionMember)')
    expect(messageRow).toContain('getRoomMemberParticipation(mentionMember)')
    expect(messageRow).toContain('isRoomAgentIdentityDimmed(participation)')
    expect(messageRow).toContain('offline={offline}')
    expect(messageRow).toContain("t('spaces_agent_status_accessibility'")
    expect(messageRow).toContain("ownSent && Platform.OS !== 'web' ? '#fff' : colors.text")
    expect(messageRow).not.toContain('spaces_agent_status_${participation}</Text>')
    expect(conversation).toContain('<RoomMemberProfileSheet')
    expect(memberProfile).toContain('member.description?.trim()')
    expect(memberProfile).toContain("t('spaces_member_owner')")
    expect(memberProfile).toContain("t('spaces_member_kind_agent')")
    expect(memberProfile).not.toContain('ownerAgents')
    expect(memberProfile).not.toContain("t('spaces_agent_count'")
    expect(memberProfile).not.toContain('chevron-forward')
    expect(memberProfile).toContain('{agent ? (')
    expect(memberProfile).toContain('<OwnerRow member={owner} />')
    expect(conversation).toContain('members={members}')
    expect(conversation).not.toContain('onSelectMember={setProfileMember}')
    expect(avatar).toContain('borderRadius: avatarBorderRadius(size, variant)')
    expect(conversation).toContain('<RoomDetailsPanel')
    expect(conversation).toContain('<RoomHeaderTitle')
    expect(conversation).toContain('count={members.length}')
    const detailsButton = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomDetailsButton.tsx'),
      'utf8',
    )
    expect(conversation).toContain('<RoomDetailsButton')
    expect(detailsButton).toContain('<ActionIcon')
    expect(detailsButton).toContain('icon="more"')
    expect(conversation).not.toContain('<RoomHumanAvatarStack')
    expect(members).toContain("member.principalType === 'agent'")
    expect(members).not.toContain('linkedAgentSessionId')
    expect(members).not.toContain('/(main)/chat/')
    expect(members).toContain('testID="room-member-grid"')
    expect(avatar).toContain('const sharedSource = agent ? (source ?? ownerSource) : source')
    expect(avatar).toContain('ownerName')
    expect(avatar).not.toContain('agent-offline-dot')
    expect(avatar).toContain('filter: [{ grayscale: 1 }]')
    expect(memberProfile).toContain('getRoomMemberParticipation(member)')
    expect(memberProfile).toContain('spaces_agent_status_full_${participation}')
    expect(memberProfile).toContain(
      "<ProfileField label={t('spaces_agent_work_mode')} value={status} />",
    )
    expect(memberProfile).toContain('canChangeRoomAgentMode(member, currentUserId)')
    expect(memberProfile).toContain('<RoomAgentModePicker')
    expect(memberProfile).not.toContain('recoverAgent')
    expect(memberProfile).not.toContain('detachedReason')
    expect(memberProfile).not.toContain('unavailableReason')
    expect(messageRow).toContain('<RoomMessageAttachment')
    expect(messageAttachment).toContain("attachment.mediaKind === 'image'")
    expect(messageAttachment).toContain('<Image')
    expect(messageAttachment).toContain('name="download-outline"')
    expect(messageAttachment).toContain('onPress={openViewer}')
    expect(messageAttachment).toContain('<RoomImageViewer')
    expect(messageAttachment).toContain('presentationStyle="fullScreen"')
    expect(messageRow).toContain('attachments={message.attachments}')
    expect(messageAttachment).toContain('<MessageImageGallery')
    const gallery = readFileSync(
      resolve(__dirname, '../components/MessageImageGallery.tsx'),
      'utf8',
    )
    expect(gallery).toContain('paddingTop: insets.top')
    expect(gallery).toContain('testID="image-gallery-close"')
    expect(gallery).toContain('maximumZoomScale={5}')
    expect(gallery).toMatch(/horizontal\s+pagingEnabled/)
    expect(messageAttachment).not.toContain('Linking.openURL')
  })

  it('does not expose CLI message provenance in user-facing copy', () => {
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')
    expect(zh).not.toContain('spaces_message_sent_by_ai_assistant')
    expect(en).not.toContain('spaces_message_sent_by_ai_assistant')
  })

  it('uses conversation wording for the Room input placeholder', () => {
    const composer = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomComposer.tsx'),
      'utf8',
    )
    expect(zh.spaces_message_placeholder).toBe('发送消息…')
    expect(en.spaces_message_placeholder).toBe('Send a message…')
    expect(composer).toContain("placeholder={t('spaces_message_placeholder')}")
  })

  it('keeps the draft visible and blocks sending while the device is offline', () => {
    const screen = readFileSync(
      resolve(__dirname, '../features/rooms/RoomConversationScreen.tsx'),
      'utf8',
    )
    const composer = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomComposer.tsx'),
      'utf8',
    )
    const source = `${screen}\n${composer}`
    expect(source).toContain('const networkStatus = useNetworkStatus()')
    expect(source).toContain("const isOffline = networkStatus === 'offline'")
    expect(source).toContain("t('spaces_offline_draft_notice')")
    expect(source).toMatch(/!membershipId\s*\|\|\s*isOffline/)
    expect(source).toContain("props.pendingAttachments.some((item) => item.status === 'ready')")
    expect(source).toMatch(
      /hasUploadingAttachment\s*\|\|\s*props\.sending\s*\|\|\s*props\.isOffline/,
    )
    expect(source).not.toContain("setDraft('')\n    setSendError(true)")
  })

  it('persists Room drafts only through the device-local draft store', () => {
    const screen = readFileSync(
      resolve(__dirname, '../features/rooms/RoomConversationScreen.tsx'),
      'utf8',
    )
    const persistence = readFileSync(
      resolve(__dirname, '../features/rooms/useRoomDraftPersistence.ts'),
      'utf8',
    )
    expect(screen).toContain('useRoomDraftPersistence({')
    expect(screen).toContain('removeRoomDraft(user.id, roomId)')
    expect(persistence).toContain('hydrateRoomDraftStorage()')
    expect(persistence).toContain('saveRoomDraft(accountId, roomId')
    expect(persistence).not.toContain('authApi')
    expect(persistence).not.toContain('SyncEngine')
  })

  it('does not acknowledge Room messages as read while the App is backgrounded', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/rooms/RoomConversationScreen.tsx'),
      'utf8',
    )
    const appState = readFileSync(resolve(__dirname, '../hooks/useAppIsActive.ts'), 'utf8')

    expect(source).toContain('const appIsActive = useAppIsActive()')
    expect(source).toContain(
      'const conversationActive = appIsActive && isScreenFocused && readActive',
    )
    expect(source).toContain('active: conversationActive')
    expect(appState).toContain("AppState.currentState === 'active'")
    expect(appState).toContain("AppState.addEventListener('change'")
  })

  it('obtains Room AI consent before dismissing the keyboard and sending', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/rooms/RoomConversationScreen.tsx'),
      'utf8',
    )
    const sendBody = source.slice(source.indexOf('const send = useCallback('))
    expect(sendBody).toMatch(
      /pendingAttachments\.some\(\(item\) => item\.status === 'uploading'\)[\s\S]*?requestAiDataConsent\([\s\S]*?if \(!consented\) return\s+}\s+dismissComposerKeyboard\(\)\s+setSending\(true\)/,
    )
  })

  it('keeps Room dictation sendable while voice work is still active', () => {
    const screen = readFileSync(
      resolve(__dirname, '../features/rooms/RoomConversationScreen.tsx'),
      'utf8',
    )
    const composer = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomComposer.tsx'),
      'utf8',
    )
    expect(screen).toMatch(
      /onListeningTextChange: \(nextText\) => \{\s*setDraftSelection\(undefined\)\s*setDraft\(nextText\)/,
    )
    expect(screen).toMatch(
      /onDraftReady: \(result\) => \{\s*setDraftSelection\(undefined\)\s*setDraft\(result\.draft\)/,
    )
    expect(screen).toMatch(
      /handleComposerFocusChange[\s\S]*?setInputFocused\(focused\)\s*if \(!focused\) setDraftSelection\(undefined\)/,
    )
    expect(screen).toContain('setInputFocused={handleComposerFocusChange}')
    expect(screen).not.toContain(
      'setDraftSelection({ start: nextDraft.length, end: nextDraft.length })',
    )
    expect(screen).toContain("if (voice.phase === 'listening')")
    expect(screen).toContain('voice.stopRecording({ skipRefine: true })')
    expect(screen).toContain('await send(result?.draft)')
    expect(`${screen}\n${composer}`).toMatch(
      /if \(voice\.phase === 'refining'\)[\s\S]*?await voice\.cancelRecording\(\)[\s\S]*?await send\(visibleDraft\)[\s\S]*?const sendDisabled =\s*\(!props\.draft\.trim\(\)/,
    )
    expect(composer).not.toContain("props.voice.phase !== 'idle' ||")
    expect(screen).toContain('onSend={() => void handleComposerSend()}')
  })

  it('shares the Agent composer controls while keeping Room-specific context actions', () => {
    const screen = readFileSync(
      resolve(__dirname, '../features/rooms/RoomConversationScreen.tsx'),
      'utf8',
    )
    const room = [
      screen,
      readFileSync(resolve(__dirname, '../features/rooms/components/RoomComposer.tsx'), 'utf8'),
      readFileSync(
        resolve(__dirname, '../features/rooms/RoomConversationScreen.styles.ts'),
        'utf8',
      ),
    ].join('\n')
    const agent = readFileSync(
      resolve(__dirname, '../features/chat/components/ChatComposer.tsx'),
      'utf8',
    )
    const card = readFileSync(
      resolve(__dirname, '../features/chat/components/ComposerInputCard.tsx'),
      'utf8',
    )
    expect(room).toContain('<ComposerInputCard')
    expect(agent).toContain('<ComposerInputCard')
    expect(room).toContain('<ComposerActionMenu')
    expect(room).toContain('testID="room-composer-more-btn"')
    expect(room).toContain("label: t('composer_menu_photos')")
    expect(room).toContain("label: t('composer_menu_files')")
    expect(room).not.toContain("label: t('file_browser')")
    expect(room).not.toContain("label: t('agent_capabilities_action')")
    expect(room).toMatch(/Platform\.OS !== 'web'[\s\S]*?<ComposerVoiceControl/)
    expect(agent).toContain('<ComposerVoiceControl')
    expect(room).toContain("mediaTypes: ['images', 'videos']")
    expect(room).toContain('isInlineImage(item)')
    expect(room).toContain('source={{ uri: item.uri }}')
    expect(room).toContain('style={styles.thumb}')
    expect(room).toContain('style={styles.progress}')
    expect(room).toContain('backgroundColor: `${props.colors.brand}10`')
    expect(room).toContain('sessionDraftEnabled: false')
    expect(room).toContain('onChangeText={handleDraftChange}')
    expect(room).toContain('shouldOpenMentionPicker(draft, value)')
    expect(room).not.toContain('name="at-sign"')
    expect(room).not.toContain('compact')
    expect(room).toContain('styles.mobileTitle')
    expect(room).toContain('fontSize: 16, lineHeight: 21')
    expect(card).toContain('compact && styles.cardCompact')
    expect(card).toContain('inputFocused && styles.cardFocused')
  })
})
