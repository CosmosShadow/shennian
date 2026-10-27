// @arch docs/architecture/app/chat-composer-keyboard.md
// @test src/__tests__/chat-composer-input.test.ts

type ComposerInputChangeParams = {
  nextValue: string
  pendingClearedValue: string | null
}

export type ComposerInputChangeDecision =
  | 'accept'
  | 'keep-clear-guard'
  | 'ignore-stale-replay'

export function resolveComposerInputChange({
  nextValue,
  pendingClearedValue,
}: ComposerInputChangeParams): ComposerInputChangeDecision {
  if (!pendingClearedValue) return 'accept'
  if (nextValue === pendingClearedValue) return 'ignore-stale-replay'

  // Native TextInput.clear() can synchronously emit onChangeText('') before React
  // commits the controlled empty value. Keep the guard alive for the stale full
  // value that some iOS IMEs replay immediately afterwards.
  if (nextValue.length === 0) return 'keep-clear-guard'

  return 'accept'
}

export function hasSendableComposerContent(
  input: string,
  attachmentCount: number,
): boolean {
  return input.trim().length > 0 || attachmentCount > 0
}
