// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-stats.test.ts
import { MarkdownIt } from 'react-native-markdown-display'

export const diaryMarkdown = MarkdownIt({ html: false })
const validateLink = diaryMarkdown.validateLink
// These are resolved on the paired computer, never opened as phone URLs.
diaryMarkdown.validateLink = url => /^file:\/\//i.test(url) || validateLink(url)
const parser = diaryMarkdown
/** Count actual Markdown image nodes, not code examples or unused references. */
export function diaryStats(content: string) {
  let photoCount = 0
  type Token = { type: string; children?: Token[] | null }
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === 'image') photoCount++
      else if (token.children) visit(token.children)
    }
  }
  visit(parser.parse(content, {}) as Token[])
  return { characterCount: Array.from(content.replace(/\s/g, '')).length, photoCount }
}
