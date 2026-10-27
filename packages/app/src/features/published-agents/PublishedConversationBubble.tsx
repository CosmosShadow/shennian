// @arch docs/features/published-agent-direct-conversations.md
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { SimpleMessageMarkdown } from '../../components/chat/SimpleMessageMarkdown'
import { useChatFontSize } from '../../hooks/useChatFontSize'
import { useTheme } from '../../hooks/useTheme'
import { getMyPublishedConversationAttachment, type PublishedConversationMessage } from './directConversationClient'
import { isOwnPublishedMessage } from './conversationPresentation'

export function PublishedConversationBubble({ message, role, agentName, visitorName, conversationId,
  statusText, onDownloadError }: {
  message: PublishedConversationMessage; role: 'owner' | 'visitor'; agentName: string; visitorName: string
  conversationId: string; statusText: string; onDownloadError: () => void
}) {
  const { colors } = useTheme()
  const { typography } = useChatFontSize()
  const own = isOwnPublishedMessage(role, message.authorRole)
  return <View style={[styles.message, { alignSelf: own ? 'flex-end' : 'flex-start' }]}
    testID={`published-message-${message.id}`}>
    <Text style={[typography.author, { color: colors.textSecondary, textAlign: own ? 'right' : 'left' }]}>
      {message.authorRole === 'agent' ? agentName : visitorName}
    </Text>
    <View style={[styles.bubble, { backgroundColor: own ? colors.ownMessage : colors.surface }]}>
      <SimpleMessageMarkdown content={message.text ?? ''} color={colors.text} linkColor={colors.brand}
        codeBackground={colors.surfaceHover} typography={typography.body} />
      {message.attachments?.map((file) => <Pressable key={file.attachmentId}
        accessibilityRole="button" disabled={!file.available}
        onPress={() => void getMyPublishedConversationAttachment(conversationId, file.attachmentId)
          .then((result) => {
            if (result.downloadUrl.startsWith('https://')) return Linking.openURL(result.downloadUrl)
          }).catch(onDownloadError)} style={styles.attachment}>
        <Text style={[typography.author, { color: colors.brand, opacity: file.available ? 1 : 0.6 }]}>
          {file.mediaKind === 'image' ? '▧' : file.mediaKind === 'video' ? '▶' : '▤'} {file.name}
        </Text>
      </Pressable>)}
      {statusText ? <Text style={[typography.author, { color: colors.textSecondary, marginTop: 6 }]}>
        {statusText}</Text> : null}
    </View>
  </View>
}
const styles = StyleSheet.create({
  message: { maxWidth: '88%', gap: 4 },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  attachment: { minHeight: 44, justifyContent: 'center' },
})
