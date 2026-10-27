// @arch docs/architecture/app/chat-composer-keyboard.md

export const COMPOSER_TEXT_INPUT_MIN_HEIGHT = 30
// Five 20pt lines plus the input's 2pt top/bottom padding.
export const COMPOSER_TEXT_INPUT_MAX_HEIGHT = 104
export const COMPOSER_TEXT_INPUT_COMPACT_MIN_HEIGHT = 24
export const COMPOSER_TEXT_INPUT_COMPACT_MAX_HEIGHT = 96

export function getComposerTextInputBounds(compact: boolean, lineHeight = compact ? 19 : 20) {
  return {
    minHeight: compact ? COMPOSER_TEXT_INPUT_COMPACT_MIN_HEIGHT : Math.max(COMPOSER_TEXT_INPUT_MIN_HEIGHT, lineHeight + 4),
    maxHeight: compact ? COMPOSER_TEXT_INPUT_COMPACT_MAX_HEIGHT : lineHeight * 5 + 4,
  }
}

export function clampComposerTextInputHeight(height: number): number {
  if (!Number.isFinite(height)) return COMPOSER_TEXT_INPUT_MIN_HEIGHT
  return Math.max(
    COMPOSER_TEXT_INPUT_MIN_HEIGHT,
    Math.min(Math.ceil(height), COMPOSER_TEXT_INPUT_MAX_HEIGHT),
  )
}

export function resolveComposerInputStyleHeight(
  platform: string,
  value: string,
  measuredHeight: number,
): number | undefined {
  // iOS Fabric reports content size from layout updates: fixing the height
  // would prevent soft wraps from producing the next measurement. Only pin
  // empty content so sending/clearing still resets stale multiline layout.
  if (platform === 'web' || (platform === 'ios' && value.length > 0)) return undefined
  return measuredHeight
}

export function resolveComposerTextInputHeight(input: {
  contentHeight: number
  value: string
  compact: boolean
  lineHeight?: number
}): number {
  const lineHeight = input.lineHeight ?? (input.compact ? 19 : 20)
  const { minHeight, maxHeight } = getComposerTextInputBounds(input.compact, lineHeight)

  if (input.value.length === 0 || !Number.isFinite(input.contentHeight)) return minHeight
  // Explicit newlines must expand immediately, even before the native size event.
  const explicitLinesHeight = input.value.split('\n').length * lineHeight + 4
  return Math.max(minHeight, Math.min(Math.ceil(Math.max(input.contentHeight, explicitLinesHeight)), maxHeight))
}
