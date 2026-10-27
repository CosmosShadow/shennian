// @arch docs/features/network-rooms/ui.md#54-消息
// @test src/__tests__/room-mention-picker.test.ts

export function shouldOpenMentionPicker(previous: string, next: string): boolean {
  return next.length > previous.length && next.endsWith('@') && !previous.endsWith('@')
}

const TRAILING_MENTION_QUERY = /@([^\s@]*)$/

/** The text typed after a trailing `@` while a mention is being composed, or null when there is none. */
export function getMentionQuery(draft: string): string | null {
  return TRAILING_MENTION_QUERY.exec(draft)?.[1] ?? null
}

/**
 * `replaceQuery` completes a trailing `@query` typed for the picker; without it the token
 * is appended so that mentioning from a message never rewrites text the user already typed.
 */
export function insertMentionToken(
  draft: string,
  displayAlias: string,
  replaceQuery = false,
): string {
  const trailing = replaceQuery ? TRAILING_MENTION_QUERY.exec(draft) : null
  if (trailing) return `${draft.slice(0, trailing.index + 1)}${displayAlias} `
  if (draft.endsWith('@')) return `${draft}${displayAlias} `
  return `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}@${displayAlias} `
}

export function createMentionInsertion(
  draft: string,
  displayAlias: string,
  replaceQuery = false,
): {
  text: string
  selection: { start: number; end: number }
} {
  const text = insertMentionToken(draft, displayAlias, replaceQuery)
  return { text, selection: { start: text.length, end: text.length } }
}

export function containsMentionToken(text: string, displayAlias: string): boolean {
  return text.includes(`@${displayAlias}`)
}
