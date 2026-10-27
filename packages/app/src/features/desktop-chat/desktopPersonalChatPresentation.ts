// @arch docs/design/desktop/unified-desktop-control.md
// @test packages/app/src/__tests__/desktop-personal-chat-presentation.test.ts

export const DESKTOP_PERSONAL_CHAT_HEADER_COMPACT_BREAKPOINT = 640

export type DesktopPersonalChatHeaderDensity = 'regular' | 'compact'

export function resolveDesktopPersonalChatHeaderDensity(
  width: number,
): DesktopPersonalChatHeaderDensity {
  return width > 0 && width < DESKTOP_PERSONAL_CHAT_HEADER_COMPACT_BREAKPOINT
    ? 'compact'
    : 'regular'
}

function basename(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, '')
  if (!normalized) return ''
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? normalized
}

export function buildDesktopPersonalChatMetadata(input: {
  workDir: string
  machineName: string
  agentLabel: string
}): string[] {
  const candidates = [basename(input.workDir), input.machineName.trim(), input.agentLabel.trim()]
  const seen = new Set<string>()
  return candidates.filter((value) => {
    if (!value) return false
    const key = value.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
