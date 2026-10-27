// @arch docs/tasks/20260929-1455_神念管家本机入口.md
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import type { ChatMessage, ChatRunPhase } from '@shennian/shared'
import { useTheme } from '../../../hooks/useTheme'
import { TimeSeparator } from '../../../components/chat/TimeSeparator'
import type { StewardImagePreviewRequest } from './StewardImageAttachment'
import { StewardMessageRow } from './StewardMessageRow'
import { TypingIndicator } from './TypingIndicator'
import { buildInvertedStewardMessageRows, type StewardMessageRowItem } from '../stewardMessageRows'

export type StewardMessageListHandle = { scrollToBottom: (animated?: boolean) => void }

type Props = {
  messages: ChatMessage[]
  onResourcePress?: (path: string) => void
  onAttachmentPreviewRequest?: StewardImagePreviewRequest
  stewardName: string
  runPhase: ChatRunPhase
  isTyping: boolean
  presentationToken?: string | null
  active?: boolean
  ready: boolean
  /** Changes when a newer server attention index arrives after the body already painted. */
  paintKey?: string
  onConversationPainted?: (token: string | null) => void
}

/** Keeps the latest message at the list origin so opening never visibly scrolls through history. */
export const StewardMessageList = forwardRef<StewardMessageListHandle, Props>(function StewardMessageList(
  { messages, onResourcePress, onAttachmentPreviewRequest, runPhase, isTyping, presentationToken, active, ready, paintKey, onConversationPainted },
  ref,
) {
  const { colors } = useTheme()
  const listRef = useRef<FlatList<StewardMessageRowItem>>(null)
  const [laidOut, setLaidOut] = useState(false)
  const paintedCallback = useRef(onConversationPainted)
  paintedCallback.current = onConversationPainted
  const rows = useMemo(() => buildInvertedStewardMessageRows(messages), [messages])
  const lastMessage = messages[messages.length - 1]
  const showTypingIndicator =
    isTyping || ((runPhase === 'thinking' || runPhase === 'tool_running') && (!lastMessage || lastMessage.role === 'user'))

  useImperativeHandle(ref, () => ({
    scrollToBottom: (animated = true) => listRef.current?.scrollToOffset({ offset: 0, animated }),
  }))

  useEffect(() => {
    if (!ready) setLaidOut(false)
  }, [ready])

  // The steward uses a native FlatList, not the normal chat WebView. Acknowledge
  // the same snapshot only after this list has laid out and crossed a paint frame.
  useEffect(() => {
    if (!laidOut || !active || !ready || !paintKey) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => paintedCallback.current?.(presentationToken ?? null))
    })
    return () => {
      cancelAnimationFrame(first)
      if (second) cancelAnimationFrame(second)
    }
  }, [laidOut, active, ready, presentationToken, paintKey])

  // Loading can briefly expose an introduction, an earlier conversation, or
  // another session's store contents. Mount the inverted list only with this
  // session's first local snapshot; preserving that transient row's position
  // can otherwise move it before the native auto-scroll animates back down.
  if (!ready) return <View style={[styles.list, { backgroundColor: colors.bg }]} />

  return (
    <FlatList
      ref={listRef}
      onLayout={() => setLaidOut(true)}
      style={[styles.list, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
      data={rows}
      inverted
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => (
        <View>
          {item.showTimeSeparator ? <TimeSeparator ts={item.message.ts} /> : null}
          <StewardMessageRow message={item.message} onResourcePress={onResourcePress} onAttachmentPreviewRequest={onAttachmentPreviewRequest} />
        </View>
      )}
      ListHeaderComponent={showTypingIndicator ? <TypingIndicator /> : null}
      maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 40 }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    />
  )
})

const styles = StyleSheet.create({
  list: { flex: 1 },
  // Inverted list: top padding is the visual bottom, leaving the floating shortcut clear of the latest message.
  content: { paddingHorizontal: 16, paddingTop: 64, paddingBottom: 8, gap: 8 },
})
