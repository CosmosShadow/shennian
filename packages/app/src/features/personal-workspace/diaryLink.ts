// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-link.test.ts
/** Only a date, never a remote-supplied filesystem path or arbitrary app route. */
export function diaryLinkDate(href: string): string | null {
  const match = /^shennian:\/\/diary\/(\d{4}-\d{2}-\d{2})$/.exec(href)
  if (!match) return null
  const date = new Date(`${match[1]}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1]! : null
}
