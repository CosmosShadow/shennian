import { useMemo, useState } from 'react'
import { ActivityIndicator, View, Text, Pressable, StyleSheet, Platform, Share } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '@shennian/shared'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { CodeBlock } from './CodeBlock'
import { useTheme } from '../../hooks/useTheme'

const markdownRules: RenderRules = {
  fence: (node: ASTNode) => {
    const lang = node.sourceType !== 'fence' ? node.sourceType : undefined
    return (
      <CodeBlock key={node.key} language={lang}>
        {node.content}
      </CodeBlock>
    )
  },
}

function StatusIndicator({
  status,
}: {
  status?: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (!status) return null

  if (status === 'sending') {
    return (
      <View style={statusStyles.container}>
        <View style={statusStyles.sendingRow}>
          <ActivityIndicator size="small" color={colors.brand} />
          <Text style={[statusStyles.sendingText, { color: colors.textSecondary }]}>
            {t('msg_sending')}
          </Text>
        </View>
      </View>
    )
  }

  if (status === 'error') {
    return (
      <View style={statusStyles.container}>
        <Text style={[statusStyles.errorText, { color: colors.error }]}>{t('msg_send_failed')}</Text>
      </View>
    )
  }

  return null
}

export function MessageBubble({
  msg,
}: {
  msg: ChatMessage
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [agentHovered, setAgentHovered] = useState(false)

  const copyText = (text: string) => {
    if (Platform.OS === 'web') {
      navigator.clipboard?.writeText(text)
    } else {
      Share.share({ message: text })
    }
  }

  const mdDynamic = useMemo(() => StyleSheet.create({
    body: { fontSize: 16, color: colors.text, lineHeight: 24 },
    paragraph: { marginTop: 3, marginBottom: 7 },
    heading1: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const, marginTop: 8, marginBottom: 5, color: colors.text },
    heading2: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const, marginTop: 8, marginBottom: 5, color: colors.text },
    heading3: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const, marginTop: 8, marginBottom: 5, color: colors.text },
    heading4: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const, marginTop: 8, marginBottom: 5, color: colors.text },
    heading5: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const, marginTop: 8, marginBottom: 5, color: colors.text },
    heading6: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const, marginTop: 8, marginBottom: 5, color: colors.text },
    code_inline: {
      backgroundColor: colors.surfaceHover,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 6,
      paddingHorizontal: 5,
      paddingVertical: 1,
      fontSize: 14,
      lineHeight: 21,
      fontFamily: monoFamily,
      color: colors.text,
    },
    fence: {
      backgroundColor: colors.surfaceHover,
      borderRadius: 8,
      padding: 12,
      fontSize: 13,
      fontFamily: monoFamily,
      color: colors.text,
    },
    strong: { fontWeight: '700' as const },
    bullet_list: { marginVertical: 5 },
    ordered_list: { marginVertical: 5 },
    list_item: { marginVertical: 3, flexDirection: 'row' as const, alignItems: 'flex-start' as const },
    bullet_list_icon: { color: colors.textSecondary, marginLeft: 2, marginRight: 8, lineHeight: 24 },
    bullet_list_content: { flex: 1, minWidth: 0 },
    ordered_list_icon: { color: colors.textSecondary, marginLeft: 2, marginRight: 8, lineHeight: 24 },
    ordered_list_content: { flex: 1, minWidth: 0 },
    link: { color: colors.brand },
    blockquote: { borderLeftColor: colors.border, paddingLeft: 12, opacity: 0.8 },
  }), [colors])

  if (msg.role === 'user') {
    return (
      <View style={styles.userRow}>
        <Pressable
          onLongPress={() => copyText(msg.content)}
          style={[styles.userBubble, { backgroundColor: colors.ownMessage }]}
        >
          <Text style={[styles.userText, { color: colors.text }]}>{msg.content}</Text>
        </Pressable>
        <StatusIndicator status={msg.status} />
      </View>
    )
  }

  if (msg.channelDelivery) {
    const delivery = msg.channelDelivery
    const title = delivery.status === 'manual_review'
      ? t('wechat_delivery_manual_review_title')
      : delivery.reasonCode === 'user_active_timeout' || delivery.status === 'failed:user_active_timeout'
        ? t('wechat_delivery_timeout_title')
        : t('wechat_delivery_failed_title')
    const copyOriginal = delivery.copyText?.trim() ?? ''
    const detail = !copyOriginal && delivery.content && delivery.content !== title
      ? delivery.content
      : ''
    return (
      <View style={styles.agentRow}>
        <View style={[styles.deliveryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.deliveryKicker, { color: colors.warning }]}>
            {t('wechat_delivery_status_kicker')}
          </Text>
          <Text style={[styles.deliveryTitle, { color: colors.text }]}>{title}</Text>
          {detail ? <Text style={[styles.deliveryDetail, { color: colors.textSecondary }]}>{detail}</Text> : null}
          {copyOriginal ? (
            <>
              <Text style={[styles.deliveryOriginalLabel, { color: colors.textSecondary }]}>
                {t('wechat_delivery_original_content')}
              </Text>
              <Text style={[styles.deliveryOriginal, { color: colors.text, backgroundColor: colors.surfaceHover }]}>
                {copyOriginal}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('wechat_delivery_copy_original')}
                onPress={() => copyText(copyOriginal)}
                style={[styles.deliveryCopyBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.deliveryCopyText, { color: colors.text }]}>
                  {t('wechat_delivery_copy_original')}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    )
  }

  return (
    <View style={styles.agentRow}>
      <Pressable onLongPress={() => msg.content && copyText(msg.content)} style={styles.agentBubbleWrap}>
        {msg.thinking ? <ThinkingBlock content={msg.thinking} /> : null}
        {msg.toolCalls?.map((tc, i) => (
          <ToolCallBlock
            key={i}
            name={tc.name}
            args={tc.args}
            result={tc.result}
            status={tc.status}
            resultOmitted={tc.resultOmitted}
            command={tc.command}
            argsSummary={tc.argsSummary}
            detailStatus={tc.detailStatus}
          />
        ))}
        {msg.content ? (
          <View
            style={Platform.OS === 'web' ? styles.agentBubbleContentWrapWeb : undefined}
            {...(Platform.OS === 'web'
              ? {
                  onMouseEnter: () => setAgentHovered(true),
                  onMouseLeave: () => setAgentHovered(false),
                }
              : {})}
          >
            {Platform.OS === 'web' && agentHovered ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('copy')}
                onPress={() => msg.content && copyText(msg.content)}
                style={[styles.agentCopyBtn, { backgroundColor: colors.surfaceHover }]}
              >
                <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
            <View
              style={[
                styles.agentBubble,
                { backgroundColor: colors.surface },
                Platform.OS === 'web' && styles.agentBubbleWeb,
              ]}
            >
              <Markdown style={mdDynamic} rules={markdownRules}>
                {msg.content}
              </Markdown>
            </View>
            {msg.wechatRpaDelivery ? (
              <View
                accessibilityLabel={t('wechat_delivery_status_kicker')}
                style={[
                  styles.deliveryInline,
                  { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}45` },
                ]}
              >
                <View style={[styles.deliveryInlineDot, { backgroundColor: colors.warning }]} />
                <Text style={[styles.deliveryInlineText, { color: colors.textSecondary }]} numberOfLines={2}>
                  {wechatRpaInlineDeliveryText(msg.wechatRpaDelivery, t)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

function wechatRpaInlineDeliveryText(
  delivery: NonNullable<ChatMessage['wechatRpaDelivery']>,
  t: (key: string) => string,
): string {
  if (delivery.status === 'sending') return t('wechat_delivery_inline_sending')
  if (delivery.status === 'sent_unconfirmed') return t('wechat_delivery_inline_confirming')
  const reason = delivery.reasonCode || ''
  if (
    reason === 'recent_mouse_activity' ||
    reason === 'recent_mouse_click' ||
    reason === 'recent_scroll_activity' ||
    reason === 'recent_keyboard_activity' ||
    reason === 'frontmost_app_changed'
  ) {
    return t('wechat_delivery_inline_waiting_idle')
  }
  return t('wechat_delivery_inline_queued')
}

const statusStyles = StyleSheet.create({
  container: {
    alignSelf: 'flex-end',
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 2,
  },
  sendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sendingText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
})

const monoFamily = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

const styles = StyleSheet.create({
  userRow: {
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 4,
  },
  userBubble: {
    maxWidth: '80%',
    borderRadius: 18,
    borderBottomRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  userText: {
    fontSize: 16,
    lineHeight: 24,
  },
  agentRow: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  agentBubbleWrap: {
    maxWidth: '90%',
  },
  agentBubbleContentWrapWeb: {
    position: 'relative',
  },
  agentCopyBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
    padding: 4,
    borderRadius: 6,
    cursor: 'pointer',
  },
  agentBubble: {
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  agentBubbleWeb: {
    // @ts-expect-error web: CSS `default` cursor; RN CursorValue typing is incomplete
    cursor: 'default',
  },
  deliveryCard: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  deliveryKicker: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  deliveryTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  deliveryDetail: {
    fontSize: 13,
    lineHeight: 19,
  },
  deliveryOriginalLabel: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  deliveryOriginal: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    lineHeight: 19,
  },
  deliveryCopyBtn: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deliveryCopyText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  deliveryInline: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  deliveryInlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  deliveryInlineText: {
    fontSize: 12,
    lineHeight: 16,
  },
})
