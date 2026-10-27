// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
export function canSpeakFeedback(input: {
  active: boolean
  enabled: boolean
  speaking: boolean
  userSpeaking: boolean
  quietSince: number
  lastFrameAt: number
  now: number
}): boolean {
  return (
    input.active &&
    input.enabled &&
    !input.speaking &&
    !input.userSpeaking &&
    input.now - input.quietSince >= 2500 &&
    input.now - input.lastFrameAt <= 3000
  )
}
export function notificationSpeechKind(
  data: Record<string, unknown>,
): 'reminder' | null {
  if (
    data.sensitive === true ||
    data.sensitive === 'true' ||
    data.silent === true ||
    data.silent === 'true'
  )
    return null
  // Ordinary messages/task results never interrupt recording with generic speech.
  return data.personalReminderKey ? 'reminder' : null
}
