// @arch docs/features/session-message-queue.md

import Svg, { Path } from 'react-native-svg'
import Feather from '@expo/vector-icons/Feather'
import { useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { QueuedChatMessage } from '@shennian/wire'
import type { Colors } from '../../../hooks/useTheme'
import { useChatFontSize } from '../../../hooks/useChatFontSize'
import BottomSheet from '../../../components/BottomSheet'

// Both glyphs share the same 3..21 optical bounds, not just a nominal font size.
// Centering them in 48pt controls gives equal outer and text-side whitespace.
function QueueActionIcon({ kind, color }: { kind: 'delete' | 'send'; color: string }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24" accessible={false}>
    <Path fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      d={kind === 'send'
        ? 'M12 21V3M3 12l9-9 9 9'
        : 'M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6M10 10v7M14 10v7'} />
  </Svg>
}

export function QueuedMessagePanel({
  messages,
  localPendingIds,
  action,
  actionFailed,
  onDelete,
  onPromote,
  colors,
}: {
  messages: QueuedChatMessage[]
  localPendingIds?: ReadonlySet<string>
  action: { id: string; kind: 'delete' | 'promote' } | null
  actionFailed?: boolean
  onDelete: (id: string) => void
  onPromote: (id: string) => void
  colors: Colors
}) {
  const { t } = useTranslation()
  const { typography } = useChatFontSize()
  const [detailMessageId, setDetailMessageId] = useState<string | null>(null)
  const detailMessage = useMemo(
    () => messages.find((message) => message.id === detailMessageId) ?? null,
    [detailMessageId, messages],
  )
  const rowBodyRefs = useRef(new Map<string, View | null>())
  const returnFocusRef = useRef<unknown>(null)
  if (!messages.length) return null
  return (
    <View>
    {actionFailed ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.errorText }]}>
      {t('queue_action_failed')}
    </Text> : null}
    <ScrollView style={styles.panel}
      contentContainerStyle={styles.content} showsVerticalScrollIndicator>
      {messages.map((message) => {
        const localPending = localPendingIds?.has(message.id) === true
        const busy = action?.id === message.id
        const disabled = action != null
        const canDelete = localPending || message.canDelete !== false
        const canPromote = !localPending && message.canPromote !== false
        return (
          <View key={message.id} style={[styles.row, {
            backgroundColor: colors.surfaceHover,
            borderColor: colors.border,
          }]}>
            {canDelete ? (
              <Pressable accessibilityRole="button"
                accessibilityLabel={t('queue_delete_with_summary', { summary: message.text.slice(0, 32) })}
                accessibilityState={{ busy: busy && action?.kind === 'delete', disabled }}
                disabled={disabled} onPress={() => onDelete(message.id)}
                style={({ pressed }) => [styles.button, { opacity: pressed || disabled ? 0.45 : 1 }]}>
                {busy && action?.kind === 'delete'
                  ? <ActivityIndicator size="small" color={colors.textSecondary} />
                  : <QueueActionIcon kind="delete" color={colors.textSecondary} />}
              </Pressable>
            ) : <View style={styles.button} />}
            <Pressable
              ref={(node) => {
                if (node) rowBodyRefs.current.set(message.id, node)
                else rowBodyRefs.current.delete(message.id)
              }}
              accessibilityRole="button"
              accessibilityLabel={t('queue_view_full_message')}
              onPress={() => {
                returnFocusRef.current = rowBodyRefs.current.get(message.id) ?? null
                setDetailMessageId(message.id)
              }}
              style={({ pressed }) => [styles.messageButton, pressed && { opacity: 0.65 }]}
            >
              <Text numberOfLines={1} style={[styles.text, typography.body, { color: colors.text }]}>{message.text}</Text>
            </Pressable>
            {!canPromote ? (
              <View
                accessible
                accessibilityLabel={t('chat_waiting_to_send')}
                style={styles.button}
              >
                <Feather name="clock" size={17} color={colors.textSecondary} />
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={t('send')}
                accessibilityState={{ busy: busy && action?.kind === 'promote', disabled }}
                disabled={disabled} onPress={() => onPromote(message.id)}
                style={({ pressed }) => [styles.button, { opacity: pressed || disabled ? 0.45 : 1 }]}>
                {busy && action?.kind === 'promote'
                  ? <ActivityIndicator size="small" color={colors.brand} />
                  : <QueueActionIcon kind="send" color={colors.brand} />}
              </Pressable>
            )}
          </View>
        )
      })}
    </ScrollView>
    <BottomSheet
      isOpen={detailMessage !== null}
      onClose={() => setDetailMessageId(null)}
      title={t('queue_full_message_title')}
      closeButtonStyle="icon"
      preferDialogOnWeb
      avoidKeyboard={false}
      returnFocusRef={returnFocusRef}
    >
      <Text
        selectable
        accessibilityRole="text"
        style={[styles.detailText, typography.body, { color: colors.text }]}
      >
        {detailMessage?.text ?? ''}
      </Text>
    </BottomSheet>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { maxHeight: 174, marginBottom: 8, marginHorizontal: 12 },
  content: { gap: 8 },
  row: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  messageButton: { flex: 1, alignSelf: 'stretch', minWidth: 0, justifyContent: 'center' },
  text: { flexShrink: 1 },
  detailText: { fontSize: 16, lineHeight: 24, paddingBottom: 8 },
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  error: { fontSize: 13, marginHorizontal: 16, marginBottom: 4 },
})
