// @arch docs/architecture/app/chat-composer-keyboard.md
// @test src/__tests__/head-ellipsis-text.test.ts

// react-native-web ignores ellipsizeMode and always truncates the tail, so the web path flips the
// text direction to push the ellipsis to the left. LRM at both ends keeps edge punctuation
// ("-", ")") from being reordered by the RTL paragraph.
const LRM = '‎'

export type HeadEllipsisTextSpec = {
  text: string
  ellipsizeMode?: 'head'
  style?: { direction: 'rtl'; textAlign: 'left' }
}

/** Runtime data can outlive its TypeScript shape (for example a saved { id, name } selection).
 * Never pass an unchecked object through to a native Text child.
 */
export function normalizeDisplayText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { name, id } = value as { name?: unknown; id?: unknown }
    if (typeof name === 'string' && name.trim()) return name
    if (typeof id === 'string') return id
  }
  return ''
}

export function resolveHeadEllipsisText(label: unknown, platform: string): HeadEllipsisTextSpec {
  const text = normalizeDisplayText(label)
  if (platform !== 'web') return { text, ellipsizeMode: 'head' }
  return { text: `${LRM}${text}${LRM}`, style: { direction: 'rtl', textAlign: 'left' } }
}
