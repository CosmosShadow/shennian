// @arch docs/features/personal-modules.md
import type { PcmStreamPlayer } from '../voice-chief/audio/pcm-player'
export function createFeedbackPlayer(): PcmStreamPlayer {
  throw new Error('native_recording_required')
}
