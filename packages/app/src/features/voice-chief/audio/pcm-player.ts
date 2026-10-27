// @arch docs/features/voice-shennian.md

export type PcmPlaybackCompleteListener = (responseId: string) => void
export type PcmPlayerErrorListener = (error: Error) => void
export type PcmOutputRoute = 'system' | 'speaker' | 'earpiece'

export interface PcmStreamPlayer {
  start(sampleRate: number): Promise<void>
  enqueue(responseId: string, pcm16: Uint8Array): Promise<void>
  finish(responseId: string): Promise<void>
  flush(): Promise<void>
  stop(): Promise<void>
  setOutputRoute(route: PcmOutputRoute): Promise<void>
  onComplete(listener: PcmPlaybackCompleteListener): () => void
  onError(listener: PcmPlayerErrorListener): () => void
}
