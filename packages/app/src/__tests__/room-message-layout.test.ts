// @covers packages/app/src/features/rooms/RoomConversationScreen.tsx
// @covers packages/app/src/features/rooms/ScopedRoomConversationScreen.tsx
// @covers packages/app/src/features/rooms/components/RoomMessageRow.tsx
// @covers packages/app/src/features/rooms/roomMessageTextWrap.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

describe('Room message width layout', () => {
  it('wraps paths and other uninterrupted text without changing native whitespace behavior', () => {
    const wrapStyle = read('../features/rooms/roomMessageTextWrap.ts')
    expect(wrapStyle).toContain("platform === 'web'")
    expect(wrapStyle).toContain("overflowWrap: 'anywhere'")
    expect(wrapStyle).toContain("whiteSpace: 'pre-wrap'")
    expect(wrapStyle).toContain("wordBreak: 'break-word'")
    expect(wrapStyle).toContain("maxWidth: '100%'")
    expect(wrapStyle).toContain('flexShrink: 1')

    for (const path of [
      '../features/rooms/components/RoomMessageRow.tsx',
      '../features/rooms/ScopedRoomConversationScreen.tsx',
    ]) {
      const source = read(path)
      expect(source).toContain('<SimpleMessageMarkdown')
      expect(source).toContain("minWidth: 0, maxWidth: '100%'")
    }
    expect(read('../components/chat/SimpleMessageMarkdown.tsx')).toContain('roomMessageTextWrapStyle')
    expect(read('../features/desktop-rooms/DesktopRoomPublicConversation.tsx')).toContain('roomMessageTextWrapStyle')
  })

  it('shares the readable Room scale across message surfaces and their composers', () => {
    const typography = read('../features/chat/preferences/chatFontSize.ts')
    expect(typography).toContain('body: { fontSize: 17, lineHeight: 25 }')
    expect(typography).toContain('system: { fontSize: 14, lineHeight: 20 }')
    const row = read('../features/rooms/components/RoomMessageRow.tsx')
    const scoped = read('../features/rooms/ScopedRoomConversationScreen.tsx')
    const composer = read('../features/rooms/components/RoomComposer.tsx')
    expect(row).toContain('messageText: roomTypography.body')
    expect(row).toContain('...roomTypography.system')
    expect(row).toContain('styles.systemMessage, typography.system, { color: colors.textSecondary }')
    expect(scoped).toContain('body: roomTypography.body')
    expect(scoped).toContain('styles.system, typography.system, { color: colors.textSecondary }')
    for (const source of [scoped, composer]) {
      expect(source).toMatch(/inputStyle=\{(?:roomTypography|typography)\.body\}/)
      expect(source).not.toContain('allowFontScaling={false}')
    }
    expect(row).not.toContain('numberOfLines=')
    const card = read('../features/chat/components/ComposerInputCard.tsx')
    expect(card).toContain(
      'compact && styles.inputCompact,\n          desktop && styles.inputDesktop,\n          inputStyle,',
    )
  })

  it('uses the full lane between the two avatar slots on mobile', () => {
    const row = read('../features/rooms/components/RoomMessageRow.tsx')

    expect(row).toContain("width: '100%'")
    expect(row).toContain("authorBlock: {\n    minHeight: 24")
    expect(row).toContain("flexDirection: 'row',\n    alignItems: 'flex-start',\n    gap: 5")
    expect(row).toContain('paddingRight: 40')
    expect(row).toContain(
      "ownRow: { justifyContent: 'flex-end', paddingLeft: 40, paddingRight: 0 }",
    )
    expect(row).toContain("messageColumn: { minWidth: 0, maxWidth: '100%', flexShrink: 1")
    expect(row).not.toContain("maxWidth: '76%'")
  })

  it('centers an 860px message canvas on Web while preserving the avatar lane', () => {
    const conversationStyles = read('../features/rooms/RoomConversationScreen.styles.ts')
    const scoped = read('../features/rooms/ScopedRoomConversationScreen.tsx')

    expect(conversationStyles).toContain('maxWidth: 860')
    expect(scoped).toContain('maxWidth: 860')
    expect(scoped).toContain('paddingRight: 38')
    expect(scoped).toContain('paddingLeft: 38, paddingRight: 0')
    expect(scoped).not.toContain("maxWidth: '82%'")
  })

  it('models bottom spacing as a list footer so scrollToEnd reaches the true end', () => {
    const conversation = read('../features/rooms/RoomConversationScreen.tsx')
    const conversationStyles = read('../features/rooms/RoomConversationScreen.styles.ts')

    expect(conversation).toContain('ItemSeparatorComponent={RoomMessageSeparator}')
    expect(conversation).toContain('ListHeaderComponent={RoomMessageFooter}')
    expect(conversationStyles).toContain('messageSeparator: { height: 8 }')
    expect(conversationStyles).toContain('messageFooter: { height: 14 }')
    expect(conversationStyles).not.toContain('paddingVertical: 14')
    expect(conversationStyles).not.toContain('gap: 8')
  })
})
