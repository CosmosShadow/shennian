// @arch docs/architecture/session-organization.md#桌面端--web
// @test src/__tests__/keyboard-shortcuts.test.ts

type SessionShortcutCandidate = {
  id: string
  agentIdentityId?: string | null
}

function activeChatSessionId(pathname: string): string | null {
  const match = pathname.match(/(?:^|\/)chat\/([^/?#]+)/)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/**
 * Project navigation shortcuts only own ordinary Project conversations.
 * An unresolved Chat is disabled conservatively until its ownership is known,
 * so ArrowUp/ArrowDown remain available for scrolling managed Agent Chat.
 */
export function shouldEnableProjectSessionShortcuts(
  pathname: string,
  sessions: readonly SessionShortcutCandidate[],
): boolean {
  const sessionId = activeChatSessionId(pathname)
  if (!sessionId) return true
  const activeSession = sessions.find((session) => session.id === sessionId)
  return activeSession ? activeSession.agentIdentityId == null : false
}
