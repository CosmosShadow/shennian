// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
import type { PcmRecorder, PcmFrameListener, PcmErrorListener } from './pcm-recorder'

// One explicit all-day owner; dictation borrows only future frames, never the
// microphone lease or historical audio. Closing a borrower cannot stop its owner.
type SharedSource = {
  readonly borrowed: boolean
  publish(frame: Uint8Array): void
  close(): void
  borrow(): PcmRecorder
}
let source: SharedSource | null = null
export function hasSharedRecordingSource() {
  return source !== null
}
export function createSharedRecordingSource(): SharedSource {
  const borrowers = new Set<{ frame: PcmFrameListener; error: PcmErrorListener }>()
  const current = {
    get borrowed() {
      return borrowers.size > 0
    },
    publish(frame: Uint8Array) {
      for (const borrower of borrowers) borrower.frame(frame)
    },
    close() {
      if (source === current) source = null
      for (const borrower of [...borrowers]) borrower.error(new Error('recording_interrupted'))
      borrowers.clear()
    },
    borrow(): PcmRecorder {
      const frames = new Set<PcmFrameListener>(),
        errors = new Set<PcmErrorListener>()
      const listener = {
        frame: (frame: Uint8Array) => {
          for (const fn of frames) fn(frame)
        },
        error: (error: Error) => {
          for (const fn of errors) fn(error)
        },
      }
      return {
        isAvailable: () => source === current,
        requestPermission: async () => source === current,
        async start() {
          if (source !== current) throw new Error('recording_interrupted')
          borrowers.add(listener)
        },
        async stop() {
          borrowers.delete(listener)
        },
        onFrame(fn) {
          frames.add(fn)
          return () => {
            frames.delete(fn)
          }
        },
        onError(fn) {
          errors.add(fn)
          return () => {
            errors.delete(fn)
          }
        },
      }
    },
  }
  source?.close()
  source = current
  return current
}
export function borrowSharedRecording(): PcmRecorder | null {
  return source?.borrow() ?? null
}
