// @arch docs/features/voice-shennian.md
// @test packages/app/src/__tests__/voice-chief-audio.test.ts

import { Platform, requireNativeModule, type EventSubscription } from 'expo-modules-core'

export type PcmRecorderStartOptions = {
  sampleRate: number
  frameDurationMs: number
  voiceChat?: boolean
}

export type PcmPlaybackOptions = { sampleRate: number }
export type PcmOutputRoute = 'system' | 'speaker' | 'earpiece'

type FramePayload = { data: string; samples: number }
type ErrorPayload = { code: string; message: string }
type PlaybackCompletePayload = { responseId: string }

export interface ExpoPcmRecorderNativeModule {
  start(options: PcmRecorderStartOptions): Promise<void>
  stop(): Promise<void>
  requestPermissions(): Promise<{ granted: boolean }>
  isAvailable(): boolean
  startPlayback(options: PcmPlaybackOptions): Promise<void>
  enqueuePlayback(payload: { data: string; responseId: string }): Promise<void>
  finishPlayback(responseId: string): Promise<void>
  flushPlayback(): Promise<void>
  stopPlayback(): Promise<void>
  setOutputRoute(route: PcmOutputRoute): Promise<void>
  addListener<Name extends 'onFrame' | 'onError' | 'onPlaybackComplete'>(
    eventName: Name,
    listener: (
      event: Name extends 'onFrame'
        ? FramePayload
        : Name extends 'onPlaybackComplete'
          ? PlaybackCompletePayload
          : ErrorPayload,
    ) => void,
  ): EventSubscription
}

let nativeModule: ExpoPcmRecorderNativeModule | null = null
function getNativeModule(): ExpoPcmRecorderNativeModule | null {
  if (Platform.OS === 'web') return null
  if (nativeModule) return nativeModule
  try {
    nativeModule = requireNativeModule<ExpoPcmRecorderNativeModule>('ExpoPcmRecorder')
    return nativeModule
  } catch {
    return null
  }
}

export function isPcmRecorderAvailable(): boolean {
  const mod = getNativeModule()
  if (!mod) return false
  try {
    return typeof mod.isAvailable === 'function' ? mod.isAvailable() : true
  } catch {
    return false
  }
}

export async function requestPcmRecorderPermissions(): Promise<boolean> {
  const mod = getNativeModule()
  if (!mod) return false
  try {
    return Boolean((await mod.requestPermissions()).granted)
  } catch {
    return false
  }
}

export async function startPcmRecorder(options: PcmRecorderStartOptions): Promise<void> {
  const mod = getNativeModule()
  if (!mod) throw new Error('expo_pcm_recorder_unavailable')
  await mod.start(options)
}
export async function stopPcmRecorder(): Promise<void> {
  await getNativeModule()?.stop()
}
export async function startPcmPlayback(options: PcmPlaybackOptions): Promise<void> {
  const mod = getNativeModule()
  if (!mod) throw new Error('expo_pcm_playback_unavailable')
  await mod.startPlayback(options)
}
export async function enqueuePcmPlayback(responseId: string, data: Uint8Array): Promise<void> {
  const mod = getNativeModule()
  if (!mod) throw new Error('expo_pcm_playback_unavailable')
  await mod.enqueuePlayback({ responseId, data: encodeBase64(data) })
}
export async function finishPcmPlayback(responseId: string): Promise<void> {
  await getNativeModule()?.finishPlayback(responseId)
}
export async function flushPcmPlayback(): Promise<void> {
  await getNativeModule()?.flushPlayback()
}
export async function stopPcmPlayback(): Promise<void> {
  await getNativeModule()?.stopPlayback()
}
export async function setPcmOutputRoute(route: PcmOutputRoute): Promise<void> {
  await getNativeModule()?.setOutputRoute(route)
}

export function addPcmFrameListener(
  listener: (frame: Uint8Array) => void,
): EventSubscription | null {
  return (
    getNativeModule()?.addListener('onFrame', (event) => listener(decodeBase64(event.data))) ?? null
  )
}
export function addPcmErrorListener(listener: (error: Error) => void): EventSubscription | null {
  return (
    getNativeModule()?.addListener('onError', (event) =>
      listener(new Error(`${event.code}: ${event.message}`)),
    ) ?? null
  )
}
export function addPcmPlaybackCompleteListener(
  listener: (responseId: string) => void,
): EventSubscription | null {
  return (
    getNativeModule()?.addListener('onPlaybackComplete', (event) => listener(event.responseId)) ??
    null
  )
}
function decodeBase64(value: string): Uint8Array {
  const atobImpl = (globalThis as typeof globalThis & { atob?: (input: string) => string }).atob
  if (atobImpl) {
    const binary = atobImpl(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff
    return bytes
  }
  const buffer = (
    globalThis as typeof globalThis & {
      Buffer?: { from: (input: string, encoding: string) => Uint8Array }
    }
  ).Buffer
  if (buffer) return new Uint8Array(buffer.from(value, 'base64'))
  throw new Error('expo_pcm_recorder_base64_unsupported')
}

function encodeBase64(value: Uint8Array): string {
  const btoaImpl = (globalThis as typeof globalThis & { btoa?: (input: string) => string }).btoa
  if (btoaImpl) {
    let binary = ''
    const block = 0x8000
    for (let offset = 0; offset < value.length; offset += block) {
      binary += String.fromCharCode(
        ...value.subarray(offset, Math.min(offset + block, value.length)),
      )
    }
    return btoaImpl(binary)
  }
  const buffer = (
    globalThis as typeof globalThis & {
      Buffer?: { from: (input: Uint8Array) => { toString: (encoding: string) => string } }
    }
  ).Buffer
  if (buffer) return buffer.from(value).toString('base64')
  throw new Error('expo_pcm_playback_base64_unsupported')
}
