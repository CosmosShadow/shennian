// @arch docs/architecture/app/chat-voice-draft.md
// @test src/__tests__/voice-capture-feedback.test.ts
import { Platform, Vibration } from 'react-native'

function vibrate(ending: boolean) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return
  try {
    // iOS arrays contain pauses only; Android arrays alternate pause/duration.
    Vibration.vibrate(ending ? (Platform.OS === 'ios' ? [0, 65] : [0, 25, 65, 25]) : 15)
  } catch {
    // Haptics must never prevent recording, stopping, or resource cleanup.
  }
}

/** One feedback pair per user capture, not per PCM chunk or ASR result. */
export function createVoiceCaptureFeedback() {
  let active = false
  return {
    start() {
      if (active) return
      active = true
      vibrate(false)
    },
    end() {
      if (!active) return
      active = false
      vibrate(true)
    },
  }
}
