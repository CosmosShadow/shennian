// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/session-previews.test.ts

/** Display only: never rewrite canonical messages or the replicated index. */
export function cleanPreviewDisplayText(value: string): string {
  return value
    // Retain link labels, including local filenames; discard destinations.
    .replace(/!?\[([^\]\n]*)\]\((?:<[^>]*>|(?:[^()\n]|\([^()\n]*\))*)\)/g, '$1')
    // Old index previews may already end halfway through a link destination.
    .replace(/!?\[([^\]\n]*)\]\([^\n]*$/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+)/gm, '')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_match, stars, underscores) => stars ?? underscores)
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?，。！？]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}
