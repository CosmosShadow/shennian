// @arch docs/features/personal-modules.md
// @test src/__tests__/steward-message-preview.test.ts

/** Bound the timeline preview without splitting emoji surrogate pairs. Full text stays intact. */
export function stewardMessagePreview(content: string): { text: string; collapsed: boolean } {
  const characters = Array.from(content)
  const lines = content.split(/\r?\n/)
  const collapsed = characters.length > 500 || lines.length > 20
  if (!collapsed) return { text: content, collapsed: false }
  return {
    text: Array.from(lines.slice(0, 20).join('\n')).slice(0, 500).join('').trimEnd() + '…',
    collapsed: true,
  }
}
