// @covers packages/app/src/components/chat/SimpleMessageMarkdown.tsx
// @covers packages/app/src/features/rooms/components/RoomMessageRow.tsx
// @covers packages/app/src/features/rooms/ScopedRoomConversationScreen.tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, '../components/chat/SimpleMessageMarkdown.tsx'), 'utf8')


describe('simple conversation Markdown', () => {
  it('auto-links bare URLs and renders basic emphasis, explicit links and code', () => {
    expect(source).toContain('linkify: true')

  })

  it('only opens safe external schemes and does not fetch Markdown images', () => {
    expect(source).toContain('isOpenableMessageLink(url)')
    expect(source).toContain('image: (node) => <Text')
    expect(source).toContain('onLinkPress={handleLinkPress}')
  })

  it('pairs outgoing native white code text with a dark overlay, not the light surface', () => {
    const row = readFileSync(resolve(__dirname, '../features/rooms/components/RoomMessageRow.tsx'), 'utf8')
    expect(row).toContain("color={ownSent && Platform.OS !== 'web' ? '#fff' : colors.text}")
    expect(row).toContain("codeBackground={ownSent && Platform.OS !== 'web' ? 'rgba(0, 0, 0, 0.18)' : colors.surface}")
    // Inline snippets and fenced blocks share the caller's contrast-safe background.
    expect(source).toContain("backgroundColor: Platform.OS === 'web' ? 'transparent' : codeBackground")
    expect(source).toContain('color, backgroundColor: codeBackground')
  })

  it('uses the Markdown renderer in Room, steward and public AI conversations', () => {
    for (const path of [
      '../features/rooms/components/RoomMessageRow.tsx',
      '../features/rooms/ScopedRoomConversationScreen.tsx',
      '../features/steward/components/StewardMessageRow.tsx',
      '../features/published-agents/PublishedAgentLanding.tsx',
      '../features/published-agents/PublishedAgentManagement.tsx',
    ]) {
      expect(readFileSync(resolve(__dirname, path), 'utf8')).toContain('<SimpleMessageMarkdown')
    }
  })
})
