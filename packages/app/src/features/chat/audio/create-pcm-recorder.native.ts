import { acquirePcmLease, releasePcmLease } from './pcm-lease'
// @arch docs/architecture/app/chat-voice-draft.md

import {
  addPcmErrorListener,
  addPcmFrameListener,
  isPcmRecorderAvailable,
  requestPcmRecorderPermissions,
  startPcmRecorder,
  stopPcmRecorder,
} from 'expo-pcm-recorder'
import {
  DEFAULT_PCM_OPTIONS,
  type PcmErrorListener,
  type PcmFrameListener,
  type PcmRecorder,
  type PcmRecorderOptions,
} from './pcm-recorder'

type Subscription = { remove(): void } | null

export function createPcmRecorder(
  options: PcmRecorderOptions = DEFAULT_PCM_OPTIONS,
): PcmRecorder {
  const frameListeners = new Set<PcmFrameListener>()
  const errorListeners = new Set<PcmErrorListener>()
  let frameSub: Subscription = null
  let errorSub: Subscription = null
  const lease = Symbol('pcm-recorder')
  let started = false
  let starting = false
  let generation = 0

  function detachNativeSubscriptions() {
    frameSub?.remove()
    errorSub?.remove()
    frameSub = null
    errorSub = null
  }

  function emitError(error: Error) {
    for (const listener of errorListeners) listener(error)
  }

  return {
    isAvailable: () => isPcmRecorderAvailable(),
    requestPermission: () => requestPcmRecorderPermissions(),
    async start() {
      if (started || starting) return
      if (!isPcmRecorderAvailable()) {
        throw new Error('native_pcm_recorder_unavailable')
      }
      const startGeneration = ++generation
      acquirePcmLease(lease)
      starting = true
      frameSub = addPcmFrameListener((frame) => {
        for (const listener of frameListeners) listener(frame)
      })
      errorSub = addPcmErrorListener((error) => {
        emitError(error)
      })
      try {
        await startPcmRecorder({
          sampleRate: options.sampleRate,
          frameDurationMs: options.frameDurationMs,
          voiceChat: options.voiceChat,
        })
        if (startGeneration !== generation) { await stopPcmRecorder(); throw new Error('recording_cancelled') }
        started = true
        starting = false
      } catch (error) {
        starting = false
        releasePcmLease(lease)
        detachNativeSubscriptions()
        throw error
      }
    },
    async stop() {
      generation++
      if (starting) return
      if (!started) {
        detachNativeSubscriptions()
        return
      }
      started = false
      try {
        await stopPcmRecorder()
      } catch {
        // best effort
      } finally {
        releasePcmLease(lease)
        detachNativeSubscriptions()
      }
    },
    onFrame(listener) {
      frameListeners.add(listener)
      return () => frameListeners.delete(listener)
    },
    onError(listener) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
  }
}
