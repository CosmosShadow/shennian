// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-message-row.test.ts
import { useState } from 'react'
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { ChatMessage } from '@shennian/shared'
import { useTranslation } from 'react-i18next'
import { useChatFontSize } from '../../../hooks/useChatFontSize'
import { useTheme } from '../../../hooks/useTheme'
import { SimpleMessageMarkdown } from '../../../components/chat/SimpleMessageMarkdown'
import BottomSheet from '../../../components/BottomSheet'
import { stripInlinePreviewAttachmentRefs } from '../../chat/utils/attachments'
import { StewardImageAttachment, type StewardImagePreviewRequest } from './StewardImageAttachment'
import { stewardMessagePreview } from '../stewardMessagePreview'
import { stewardVisibleUserText } from '../contextualSteward'

type Props = {
  message: ChatMessage
  onResourcePress?: (path: string) => void
  onAttachmentPreviewRequest?: StewardImagePreviewRequest
}

/** The steward's own message-style timeline: a plain bubble list, like messaging a contact. */
export function StewardMessageRow({ message, onResourcePress, onAttachmentPreviewRequest }: Props) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const { typography } = useChatFontSize()
  const [showFullMessage, setShowFullMessage] = useState(false)
  const content = message.role === 'user' ? stewardVisibleUserText(message.content ?? '') : message.content ?? ''
  const images = message.attachments?.filter(file => file.kind === 'image') ?? []
  const displayContent = stripInlinePreviewAttachmentRefs(content, images)
  const preview = stewardMessagePreview(displayContent)

  if (message.divider) {
    return (
      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        <Text style={[styles.dividerText, { color: colors.textTertiary }]}>{message.divider}</Text>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
      </View>
    )
  }

  const own = message.role === 'user'

  if (!own && message.approval) {
    const approval = message.approval
    return (
      <View style={[styles.messageRow]}>
        <View style={styles.messageColumn}>
          <View style={[styles.approvalCard, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
            <Text style={[styles.approvalKicker, { color: colors.brand }]}>{t('steward_approval_kicker', '等待确认')}</Text>
            <Text style={[styles.approvalTitle, typography.body, { color: colors.text }]}>
              {approval.title || t('steward_approval_title', '需要用户确认')}
            </Text>
            {approval.content ? (
              <Text style={[styles.approvalContent, typography.body, { color: colors.textSecondary }]}>
                {approval.content}
              </Text>
            ) : null}
            <Text style={[styles.approvalHint, { color: colors.textTertiary }]}>
              {approval.actionHint || t('steward_approval_hint', '当前神念暂不支持远程确认，请回到运行 Codex 的电脑/终端完成确认。')}
            </Text>
          </View>
        </View>
      </View>
    )
  }

  if (!content.trim() && !images.length) return null

  const copyMessage = () => void Clipboard.setStringAsync(content)
  const showMessageActions = () => {
    const label = t('copy')
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [label, t('cancel')], cancelButtonIndex: 1 },
        (selectedIndex) => {
          if (selectedIndex === 0) copyMessage()
        },
      )
      return
    }
    Alert.alert(
      '',
      undefined,
      [
        { text: label, onPress: copyMessage },
        { text: t('cancel'), style: 'cancel' as const },
      ],
      { cancelable: true },
    )
  }

  return (
    <>
      <View style={[styles.messageRow, own && styles.ownRow]}>
        <Pressable
          accessibilityRole={preview.collapsed ? 'button' : undefined}
          accessibilityHint={preview.collapsed ? t('steward_message_view_more') : undefined}
          onPress={preview.collapsed ? () => setShowFullMessage(true) : undefined}
          delayLongPress={350}
          onLongPress={showMessageActions}
          style={[styles.messageColumn, own && styles.ownColumn]}
        >
          <View
            style={[
              styles.bubble,
              {
                backgroundColor: own
                  ? Platform.OS === 'web' ? colors.ownMessage : isDark ? '#245FC7' : '#1683F7'
                  : colors.surfaceHover,
              },
            ]}
          >
            {images.map(attachment => <StewardImageAttachment key={attachment.path} attachment={attachment}
              onOpen={onResourcePress} requestPreview={onAttachmentPreviewRequest} />)}
            {message.workerSource ? <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }}>{t('schedules_execution_worker')}</Text> : null}
            {preview.collapsed ? (
              <>
                <Text numberOfLines={20} style={[typography.body, { color: own && Platform.OS !== 'web' ? '#fff' : colors.text }]}>
                  {preview.text}
                </Text>
                <Text style={[styles.viewMore, { color: own && Platform.OS !== 'web' ? '#fff' : colors.brand }]}>
                  {t('steward_message_view_more')}
                </Text>
              </>
            ) : <SimpleMessageMarkdown
              content={displayContent}
              onResourcePress={onResourcePress}
              typography={typography.body}
              color={own && Platform.OS !== 'web' ? '#fff' : colors.text}
              linkColor={own && Platform.OS !== 'web' ? '#fff' : colors.brand}
              codeBackground={colors.surface}
            />}
          </View>
          {message.status === 'error' ? (
            <Text style={[styles.errorText, { color: colors.error }]}>{t('msg_send_failed')}</Text>
          ) : null}
        </Pressable>
      </View>
      {showFullMessage ? (
        <BottomSheet isOpen onClose={() => setShowFullMessage(false)} title={t('steward_message_full')}
          closeButtonStyle="icon" preferDialogOnWeb
          headerRight={
            <Pressable accessibilityRole="button" accessibilityLabel={t('copy')} onPress={copyMessage} style={styles.copyButton}>
              <Text style={{ color: colors.brand }}>{t('copy')}</Text>
            </Pressable>
          }
        >
          {images.map(attachment => <StewardImageAttachment key={attachment.path} attachment={attachment}
            requestPreview={onAttachmentPreviewRequest}
            onOpen={onResourcePress ? (path) => { setShowFullMessage(false); onResourcePress(path) } : undefined} />)}
          <SimpleMessageMarkdown
            content={displayContent}
            onResourcePress={onResourcePress ? (path) => { setShowFullMessage(false); onResourcePress(path) } : undefined}
            typography={typography.body}
            color={colors.text}
            linkColor={colors.brand}
            codeBackground={colors.surface}
          />
        </BottomSheet>
      ) : null}
    </>
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
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  viewMore: { fontSize: 14, marginTop: 8, fontWeight: '500' },
  copyButton: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  errorText: { marginTop: 4, marginHorizontal: 2, fontSize: 12 },
  approvalCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4, maxWidth: 320 },
  approvalKicker: { fontSize: 11, fontWeight: '600' },
  approvalTitle: { fontWeight: '600' },
  approvalContent: {},
  approvalHint: { fontSize: 12, marginTop: 2 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 12 },
})
