// @arch docs/architecture/app/chat-composer-keyboard.md
// @test src/__tests__/chat-keyboard-geometry.test.ts

/** Steward owns its top inset outside ChatScreen's keyboard-avoiding view. */
export function chatKeyboardVerticalOffset(stewardConversationView: boolean, topInset: number): number {
  return stewardConversationView && Number.isFinite(topInset) ? Math.max(0, topInset) : 0
}
