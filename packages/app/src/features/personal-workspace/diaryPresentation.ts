// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-presentation.test.ts
import type { DiaryEntry } from './diarySync'

/** Dates belong to the date label; legacy Markdown headings often repeat them. */
export function diaryPresentation(entry: DiaryEntry) {
  const date = entry.date ?? /\d{4}-\d{2}-\d{2}/.exec(entry.path)?.[0] ?? ''
  const title = (entry.title ?? '').replace(/^#\s*/, '').trim()
  const heading = title.startsWith(date) && date
    ? title.slice(date.length).replace(/^[\s|｜:：—–-]+/, '').trim()
    : title
  const summary = (entry.summary ?? '').replace(/^>\s*/, '').replace(/^概要[：:]\s*/, '').trim()
  // A summary-only entry needs no repeated headline or body excerpt.
  return { date, heading, summary: summary === heading ? '' : summary }
}

/** Present legacy date-prefixed headings without rewriting the original file. */
export function diaryBody(entry: DiaryEntry & { content: string }) {
  const first = /^#\s+(.+)$/m.exec(entry.content)
  if (!first) return entry.content
  const heading = diaryPresentation({ ...entry, title: first[1] }).heading
  return entry.content.replace(first[0], heading ? `# ${heading}` : '').trimStart()
}
