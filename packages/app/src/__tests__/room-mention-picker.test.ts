// @covers packages/app/src/features/rooms/components/RoomMentionPicker.tsx
// @covers packages/app/src/features/rooms/RoomConversationScreen.tsx
// @covers packages/app/src/features/rooms/roomMentions.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createMentionInsertion,
  getMentionQuery,
  insertMentionToken,
  shouldOpenMentionPicker,
} from '../features/rooms/roomMentions'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

describe('Room mention picker', () => {
  it('renders each human as a parent and only their own Agents as indented children', () => {
    const picker = read('../features/rooms/components/RoomMentionPicker.tsx')
    expect(picker).toContain('groupRoomMembers(members, currentUserId)')
    expect(picker).toContain('groups.map((group)')
    expect(picker).toContain('member={group.human}')
    expect(picker).toContain('group.agents.map((agent)')
    expect(picker).toContain('styles.agentBranch')
    expect(picker).toContain('styles.branchLine')
    expect(picker).not.toContain('spaces_agent_owned_by')
    expect(picker).not.toContain('agentBadge')
  })

  it('uses a near-full-screen searchable sheet with names as the primary content', () => {
    const picker = read('../features/rooms/components/RoomMentionPicker.tsx')
    expect(picker).toContain("height: '90%'")
    expect(picker).toContain('spaces_mention_search')
    expect(picker).toContain('keyboardShouldPersistTaps="handled"')
    expect(picker).toContain('{member.displayAlias}')
    expect(picker).toContain("{member.displayAlias}{agent ? ' · AI' : ''}")
    expect(picker).not.toContain('@{member.displayAlias}')
    expect(picker).not.toContain('spaces_mention_hint')
  })

  it('sends only explicitly selected Membership ids that still have visible mention text', () => {
    for (const conversation of [
      read('../features/rooms/RoomConversationScreen.tsx'),
      read('../features/rooms/ScopedRoomConversationScreen.tsx'),
    ]) {
      expect(conversation).toContain('mentionMembershipIds: selectedMentions')
      expect(conversation).toContain('containsMentionToken(text, member.displayAlias)')
      expect(conversation).toContain('.map((member) => member.id)')
      expect(conversation).toContain('current.some((item) => item.id === member.id)')
      expect(conversation).toContain('<RoomMentionPicker')
    }
  })

  it('opens from a typed @ and replaces that trigger without duplicating it', () => {
    expect(shouldOpenMentionPicker('', '@')).toBe(true)
    expect(shouldOpenMentionPicker('你好', '你好@')).toBe(true)
    expect(shouldOpenMentionPicker('你好@', '你好@')).toBe(false)
    expect(shouldOpenMentionPicker('hello', 'hello')).toBe(false)
    expect(insertMentionToken('@', '设计助手')).toBe('@设计助手 ')
    expect(insertMentionToken('请看@', '设计助手')).toBe('请看@设计助手 ')
    expect(insertMentionToken('请看', '设计助手')).toBe('请看 @设计助手 ')
  })

  it('completes the typed @query only when the picker asks for it', () => {
    expect(getMentionQuery('你好@')).toBe('')
    expect(getMentionQuery('你好@八')).toBe('八')
    expect(getMentionQuery('@八仙 ')).toBeNull()
    expect(getMentionQuery('没有提及')).toBeNull()
    expect(insertMentionToken('请看@八', '八仙', true)).toBe('请看@八仙 ')
    expect(insertMentionToken('请看@', '八仙', true)).toBe('请看@八仙 ')
    expect(insertMentionToken('请看', '八仙', true)).toBe('请看 @八仙 ')
    // Mentioning from a message appends and never rewrites text that merely looks like a query.
    expect(insertMentionToken('mail me@example', '八仙')).toBe('mail me@example @八仙 ')
  })

  it('controls the native caret through the first change after mention insertion', () => {
    const insertion = createMentionInsertion('前置内容@', 'WorkBuddy')
    expect(insertion).toEqual({
      text: '前置内容@WorkBuddy ',
      selection: { start: 15, end: 15 },
    })
    expect(
      `${insertion.text.slice(0, insertion.selection.start)}继续输入${insertion.text.slice(insertion.selection.end)}`,
    ).toBe('前置内容@WorkBuddy 继续输入')

    const conversation = read('../features/rooms/RoomConversationScreen.tsx')
    expect(conversation).toContain('InteractionManager.runAfterInteractions')
    expect(conversation).toContain('setDraftSelection(insertion.selection)')
    expect(conversation).toContain('selection={draftSelection}')
    expect(conversation).toContain('onSelectionChange={handleDraftSelectionChange}')
    expect(conversation).toContain('setDraftSelection(undefined)')
    expect(conversation).not.toContain('setNativeProps({ selection: insertion.selection })')

    const card = read('../features/chat/components/ComposerInputCard.tsx')
    expect(card).toContain("selection?: TextInputProps['selection']")
    expect(card).toContain('selection={selection}')
    expect(card).toContain('onSelectionChange={onSelectionChange}')
  })

  it('opens profiles from avatars and keeps mention available in long-press actions', () => {
    const messageRow = read('../features/rooms/components/RoomMessageRow.tsx')
    expect(messageRow).toContain('mentionMember?: RoomMemberView')
    expect(messageRow).toContain('onOpenProfile(mentionMember)')
    expect(messageRow).toContain('onLongPress={canMention ? mentionAuthor : undefined}')
    expect(messageRow).toContain('onLongPress={showMessageActions}')
    expect(messageRow).toContain("run: mentionAuthor")
    expect(messageRow).toContain('delayLongPress={350}')
  })
})
