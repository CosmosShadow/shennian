// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-room-public-conversation.test.ts

import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { RoomAgentStatusLabel } from '../rooms/components/RoomAgentStatusLabel'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { getRoomMemberParticipation } from '../rooms/roomPresentation'
import type { RoomMemberView } from '../rooms/types'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import {
  DESKTOP_MENTION_LIST_ID,
  DESKTOP_MENTION_LIST_INSET,
  DESKTOP_MENTION_ROW_HEIGHT,
  desktopMentionOptionId,
  desktopMentionScrollOffset,
} from './desktopRoomMention'

/**
 * Non-modal combobox list: focus stays in the composer textarea, which owns the keyboard
 * (`aria-activedescendant` points at the highlighted option). Rows are already filtered and
 * flattened in visual order by the conversation.
 */
export function DesktopRoomMentionPopover({ visible, items, activeIndex, onSelect }: {
  visible: boolean
  items: RoomMemberView[]
  activeIndex: number
  onSelect(member: RoomMemberView): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const listRef = useRef<ScrollView>(null)
  const scrollTop = useRef(0)
  const viewportHeight = useRef(0)
  useEffect(() => {
    if (!visible || items.length === 0 || viewportHeight.current === 0) return
    const offset = desktopMentionScrollOffset({ index: activeIndex, scrollTop: scrollTop.current, viewportHeight: viewportHeight.current })
    if (offset !== scrollTop.current) listRef.current?.scrollTo({ y: offset, animated: false })
  }, [activeIndex, items.length, visible])
  if (!visible) return null

  // Keep focus and caret in the textarea: a mouse press inside the list must not blur it (blur dismisses the list).
  return <View testID="desktop-room-mention-popover"
    {...({ onMouseDown: (event: { preventDefault(): void }) => event.preventDefault() } as object)}
    style={[styles.panel, { backgroundColor: colors.bg, borderColor: colors.border, shadowColor: colors.text }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Text numberOfLines={1} style={[styles.hint, { color: colors.textSecondary }]}>{t('desktop_room_mention_hint')}</Text>
    </View>
    <ScrollView ref={listRef} nativeID={DESKTOP_MENTION_LIST_ID} {...({ role: 'listbox' } as object)} aria-label={t('spaces_mention_title')}
      keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.listContent}
      scrollEventThrottle={16}
      onLayout={event => { viewportHeight.current = event.nativeEvent.layout.height }}
      onScroll={event => { scrollTop.current = event.nativeEvent.contentOffset.y }}>
      {items.map((member, index) => <MentionOption key={member.id} member={member} active={index === activeIndex} onSelect={onSelect} />)}
      {items.length === 0 ? <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('spaces_mention_empty')}</Text> : null}
    </ScrollView>
  </View>
}

function MentionOption({ member, active, onSelect }: { member: RoomMemberView; active: boolean; onSelect(member: RoomMemberView): void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const agent = member.principalType === 'agent'
  const participation = getRoomMemberParticipation(member)
  const status = participation ? t(`spaces_agent_status_${participation}`) : null
  return <Pressable accessibilityRole="button" role="option" aria-selected={active} nativeID={desktopMentionOptionId(member.id)}
    accessibilityLabel={status ? `${t('spaces_mention_member', { name: member.displayAlias })}，${status}` : t('spaces_mention_member', { name: member.displayAlias })}
    onPress={() => onSelect(member)}
    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
      styles.option,
      agent && styles.agentOption,
      { backgroundColor: active ? colors.brandLight : pressed || hovered ? colors.surfaceHover : 'transparent' },
    ]}>
    <RoomIdentityAvatar name={member.displayAlias} avatar={member.avatar} agent={agent}
      ownerAvatar={member.ownerAvatar} ownerName={member.ownerDisplayName} size={24} />
    <Text numberOfLines={1} style={[styles.optionName, { color: colors.text }]}>{member.displayAlias}{agent ? ' · AI' : ''}</Text>
    {status && participation ? <RoomAgentStatusLabel participation={participation} label={status} /> : null}
  </Pressable>
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 16, bottom: 116, width: 320, maxHeight: 380, zIndex: 30, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  header: { height: 28, paddingHorizontal: 12, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  hint: { ...desktopTypography.caption },
  list: {},
  listContent: { paddingHorizontal: 6, paddingVertical: DESKTOP_MENTION_LIST_INSET },
  option: { height: DESKTOP_MENTION_ROW_HEIGHT, borderRadius: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  agentOption: { marginLeft: 22 },
  optionName: { minWidth: 0, flex: 1, ...desktopTypography.body, lineHeight: 20 },
  empty: { padding: 20, textAlign: 'center', fontSize: 13, lineHeight: 19 },
})
