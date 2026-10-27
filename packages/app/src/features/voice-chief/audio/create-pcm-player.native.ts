// @arch docs/features/voice-shennian.md

import {
  addPcmErrorListener,
  addPcmPlaybackCompleteListener,
  enqueuePcmPlayback,
  finishPcmPlayback,
  flushPcmPlayback,
  setPcmOutputRoute,
  startPcmPlayback,
  stopPcmPlayback,
} from 'expo-pcm-recorder'
import type { PcmStreamPlayer } from './pcm-player'

type Subscription = { remove(): void } | null

export function createPcmPlayer(): PcmStreamPlayer {
  const completeListeners = new Set<(id: string) => void>()
  const errorListeners = new Set<(error: Error) => void>()
  let completeSub: Subscription = null
  let errorSub: Subscription = null
  let started = false

  const detach = () => {
    completeSub?.remove(); errorSub?.remove(); completeSub = null; errorSub = null
  }
  return {
    async start(sampleRate) {
      if (started) return
      completeSub = addPcmPlaybackCompleteListener((id) => completeListeners.forEach((listener) => listener(id)))
      errorSub = addPcmErrorListener((error) => errorListeners.forEach((listener) => listener(error)))
      await startPcmPlayback({ sampleRate })
      started = true
    },
    enqueue: enqueuePcmPlayback,
    finish: finishPcmPlayback,
    flush: flushPcmPlayback,
    async stop() { started = false; await stopPcmPlayback(); detach() },
    setOutputRoute: setPcmOutputRoute,
    onComplete(listener) { completeListeners.add(listener); return () => completeListeners.delete(listener) },
    onError(listener) { errorListeners.add(listener); return () => errorListeners.delete(listener) },
  }
}
