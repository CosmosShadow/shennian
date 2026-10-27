// @covers packages/app/src/features/voice/voiceCaptureFeedback.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ Platform: { OS: 'android' }, Vibration: { vibrate: vi.fn() } }))
vi.mock('react-native', () => native)
import { createVoiceCaptureFeedback } from '../features/voice/voiceCaptureFeedback'

beforeEach(() => {
  native.Platform.OS = 'android'
  native.Vibration.vibrate.mockReset()
})

describe('voice capture feedback', () => {
  it('signals successful start once, then stop once despite duplicate terminal callbacks', () => {
    const feedback = createVoiceCaptureFeedback()
    feedback.end() // Permission denied or cancelled before recording started.
    expect(native.Vibration.vibrate).not.toHaveBeenCalled()
    feedback.start()
    feedback.start() // ASR ready/partial and repeated actions must not double buzz.
    expect(native.Vibration.vibrate.mock.calls).toEqual([[15]])
    feedback.end() // User stop, timeout, cancellation, or recorder/ASR failure.
    feedback.end() // Socket close after error must not buzz again.
    expect(native.Vibration.vibrate.mock.calls).toEqual([[15], [[0, 25, 65, 25]]])
  })

  it('signals resumed recognition and keeps simultaneous capture sessions independent', () => {
    const capture = createVoiceCaptureFeedback(), borrowed = createVoiceCaptureFeedback()
    capture.start()
    borrowed.start()
    borrowed.end()
    capture.end()
    capture.start()
    capture.end()
    expect(native.Vibration.vibrate).toHaveBeenCalledTimes(6)
  })

  it('uses pause-only iOS vibration patterns', () => {
    native.Platform.OS = 'ios'
    const feedback = createVoiceCaptureFeedback()
    feedback.start()
    feedback.end()
    expect(native.Vibration.vibrate.mock.calls).toEqual([[15], [[0, 65]]])
  })

  it('does not vibrate on web or unsupported platforms', () => {
    for (const os of ['web', 'macos', 'windows']) {
      native.Platform.OS = os
      const feedback = createVoiceCaptureFeedback()
      feedback.start()
      feedback.end()
    }
    expect(native.Vibration.vibrate).not.toHaveBeenCalled()
  })

  it('never lets a vibration failure break start or cleanup', () => {
    native.Vibration.vibrate.mockImplementation(() => { throw new Error('unavailable') })
    const feedback = createVoiceCaptureFeedback()
    expect(() => feedback.start()).not.toThrow()
    expect(() => feedback.end()).not.toThrow()
    expect(() => feedback.end()).not.toThrow()
    expect(native.Vibration.vibrate).toHaveBeenCalledTimes(2)
  })
})
