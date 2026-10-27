import { RecoverableSection } from '../../../components/RecoverableSection'
// @arch docs/features/network-rooms/ui.md#54-消息
// @test src/__tests__/room-conversation-screen.test.ts

import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import type { RoomMessageView } from '@shennian/wire'
import { useChatFontSize } from '../../../hooks/useChatFontSize'
import { roomTypography } from '../roomTypography'
import { useTheme } from '../../../hooks/useTheme'
import {
  getRoomMemberParticipation,
  isOwnRoomAuthor,
  isRoomImageOnlyMessage,
  roomMessageAvatars,
} from '../roomPresentation'
import { formatRoomSystemMessage, isHiddenRoomSystemMessage } from '../roomSystemMessages'
import type { RoomMemberView } from '../types'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'
import { RoomMessageAttachment } from './RoomMessageAttachment'
import { isRoomAgentIdentityDimmed } from './roomAgentStatusPresentation'
import { roomMessageTextWrapStyle } from '../roomMessageTextWrap'
import { SimpleMessageMarkdown } from '../../../components/chat/SimpleMessageMarkdown'

type Props = {
  message: RoomMessageView
  roomId: string
  currentUserId?: string | null
  mentionMember?: RoomMemberView
  memberCount?: number
  onMention: (member: RoomMemberView) => void
  onOpenProfile: (member: RoomMemberView) => void
  onPressMessage?: () => void
}

export function RoomMessageRow(props: Props) {
  const resetKey = typeof props.message?.id === 'string' ? props.message.id : undefined
  return <RecoverableSection scope="message" resetKey={resetKey}><RoomMessageContent {...props} /></RecoverableSection>
}

function RoomMessageContent({
  message,
  roomId,
  currentUserId,
  mentionMember,
  memberCount,
  onMention,
  onOpenProfile,
  onPressMessage,
}: Props) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const { typography } = useChatFontSize()
  if (isHiddenRoomSystemMessage(message, memberCount)) return null
  if (message.kind === 'system') {
    return (
      <Text style={[styles.systemMessage, typography.system, { color: colors.textSecondary }]}>
        {formatRoomSystemMessage(message, t)}
      </Text>
    )
  }

  const own = isOwnRoomAuthor(message.author, currentUserId)
  const agent = message.author.principalType === 'agent'
  const ownSent = own && (!agent || message.source === 'app' || message.source === 'cli')
  const { avatar, ownerAvatar } = roomMessageAvatars(message.author.avatar, mentionMember, agent)
  const displayName = mentionMember?.displayAlias ?? message.author.displayName
  const canMention = Boolean(mentionMember && !ownSent)
  const canOpenProfile = Boolean(mentionMember)
  const participation = getRoomMemberParticipation(mentionMember)
  const offline = agent && isRoomAgentIdentityDimmed(participation)
  const imageOnly = isRoomImageOnlyMessage(message)
  const participationLabel = participation ? t(`spaces_agent_status_${participation}`) : null
  const aiSourceLabel = agent
    ? t(message.source === 'app' || message.source === 'cli'
      ? 'spaces_message_human_reply' : 'spaces_message_ai_generated')
    : message.source === 'managed_agent'
      ? t('spaces_message_ai_generated')
    : message.source === 'cli'
      ? t('spaces_message_ai_sent')
      : null
  const mentionAuthor = () => {
    if (mentionMember && !ownSent) onMention(mentionMember)
  }
  const copyableText = message.deletedAt ? '' : (message.text?.trim() ?? '')
  const showMessageActions = () => {
    const actions = [
      ...(copyableText
        ? [{ label: t('copy'), run: () => void Clipboard.setStringAsync(message.text ?? '') }]
        : []),
      ...(canMention
        ? [{ label: t('spaces_mention_member', { name: displayName }), run: mentionAuthor }]
        : []),
    ]
    if (actions.length === 0) return

    if (Platform.OS === 'ios') {
      const cancelButtonIndex = actions.length
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...actions.map((action) => action.label), t('cancel')],
          cancelButtonIndex,
        },
        (selectedIndex) => actions[selectedIndex]?.run(),
      )
      return
    }

    Alert.alert(
      '',
      undefined,
      [
        ...actions.map((action) => ({ text: action.label, onPress: action.run })),
        { text: t('cancel'), style: 'cancel' as const },
      ],
      { cancelable: true },
    )
  }
  const identity = (
    <RoomIdentityAvatar
      name={displayName}
      avatar={avatar}
      agent={agent}
      ownerAvatar={ownerAvatar}
      ownerName={
        agent ? (message.author.ownerDisplayName ?? mentionMember?.ownerDisplayName) : null
      }
      size={32}
      offline={offline}
    />
  )
  const avatarView = canOpenProfile ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        participationLabel
          ? t('spaces_agent_status_accessibility', {
              name: displayName,
              status: participationLabel,
            })
          : t('spaces_view_member_profile', { name: displayName })
      }
      hitSlop={6}
      onPress={() => mentionMember && onOpenProfile(mentionMember)}
      onLongPress={canMention ? mentionAuthor : undefined}
      delayLongPress={350}
    >
      {identity}
    </Pressable>
  ) : (
    identity
  )

  return (
    <View
      testID={`room-message-${message.id}`}
      style={[styles.messageRow, ownSent && styles.ownRow]}
    >
      {!ownSent ? avatarView : null}
      <Pressable
        disabled={!canMention && !copyableText && !onPressMessage}
        delayLongPress={350}
        onPress={onPressMessage}
        onLongPress={showMessageActions}
        style={[styles.messageColumn, ownSent && styles.ownColumn]}
      >
        {!ownSent ? (
          <View style={styles.authorBlock}>
            <Text
              style={[
                styles.author,
                typography.author,
                { color: offline ? colors.textTertiary : colors.textSecondary },
              ]}
            >
              {displayName}
            </Text>
          </View>
        ) : null}
        <View
          style={[
            styles.bubble,
            imageOnly
              ? styles.imageOnlyBubble
              : { backgroundColor: ownSent
                ? Platform.OS === 'web' ? colors.ownMessage : isDark ? '#245FC7' : '#1683F7'
                : colors.surfaceHover },
          ]}
        >
          {message.deletedAt ? (
            <Text
              style={[
                styles.messageText,
                roomMessageTextWrapStyle,
                typography.body,
                { color: ownSent && Platform.OS !== 'web' ? '#fff' : colors.text },
              ]}
            >
              {t('spaces_message_deleted')}
            </Text>
          ) : message.text ? (
            <SimpleMessageMarkdown
              content={message.text}
              typography={typography.body}
              color={ownSent && Platform.OS !== 'web' ? '#fff' : colors.text}
              linkColor={ownSent && Platform.OS !== 'web' ? '#fff' : colors.brand}
              codeBackground={ownSent && Platform.OS !== 'web' ? 'rgba(0, 0, 0, 0.18)' : colors.surface}
            />
          ) : null}
          {!message.deletedAt && message.attachments.length > 0 ? (
            <View style={styles.messageAttachments}>
              {message.attachments.map((attachment) => (
                <RoomMessageAttachment
                  key={attachment.attachmentId}
                  roomId={roomId}
                  attachment={attachment}
                  attachments={message.attachments}
                />
              ))}
            </View>
          ) : null}
        </View>
        {aiSourceLabel ? (
          <Text style={[styles.aiSource, { color: colors.textTertiary }]}>{aiSourceLabel}</Text>
        ) : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingRight: 40,
  },
  ownRow: { justifyContent: 'flex-end', paddingLeft: 40, paddingRight: 0 },
  messageColumn: { minWidth: 0, maxWidth: '100%', flexShrink: 1, alignItems: 'flex-start' },
  ownColumn: { alignItems: 'flex-end' },
  authorBlock: {
    minHeight: 24,
    marginBottom: 3,
    marginLeft: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
  },
  author: roomTypography.author,
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  imageOnlyBubble: { paddingHorizontal: 0, paddingVertical: 0 },
  messageText: roomTypography.body,
  aiSource: { marginTop: 4, marginHorizontal: 2, fontSize: 11, lineHeight: 15 },
  messageAttachments: { marginTop: 8, gap: 6 },
  systemMessage: {
    alignSelf: 'center',
    ...roomTypography.system,
    textAlign: 'center',
    marginVertical: 4,
  },
})
