// @arch docs/architecture/app/chat-voice-draft.md
// @test ../../../__tests__/pcm-recorder-web.test.ts

import {
  DEFAULT_PCM_OPTIONS,
  type PcmErrorListener,
  type PcmFrameListener,
  type PcmRecorder,
  type PcmRecorderOptions,
} from './pcm-recorder'

type MediaStreamLike = {
  getTracks(): Array<{ stop(): void }>
}

type AudioContextCtor = new (options?: { sampleRate?: number }) => AudioContext
type AudioContextLike = AudioContext & {
  audioWorklet?: {
    addModule: (url: string) => Promise<void>
  }
}
type AudioWorkletNodeCtor = new (
  context: AudioContextLike,
  name: string,
) => AudioNode & {
  port: MessagePort
}

const WORKLET_MODULE_NAME = 'shennian-pcm-worklet'

/**
 * Inline AudioWorklet processor:
 * - converts input Float32 samples to Int16 little-endian
 * - batches into ~40ms frames (sampleRate * frameMs / 1000 samples)
 * - posts ArrayBuffer back to main thread via `port.postMessage`
 */
const WORKLET_SOURCE = `
class ShennianPcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.samplesPerFrame = options?.processorOptions?.samplesPerFrame ?? 640
    this.buffer = new Int16Array(this.samplesPerFrame)
    this.offset = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]))
      this.buffer[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      if (this.offset >= this.samplesPerFrame) {
        const out = new ArrayBuffer(this.samplesPerFrame * 2)
        new Int16Array(out).set(this.buffer)
        this.port.postMessage(out, [out])
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('${WORKLET_MODULE_NAME}', ShennianPcmProcessor)
`

function getAudioContextCtor(): AudioContextCtor | null {
  const globalWindow = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return globalWindow.AudioContext ?? globalWindow.webkitAudioContext ?? null
}

function createWorkletModuleUrl(): string {
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
}

export function createPcmRecorder(
  options: PcmRecorderOptions = DEFAULT_PCM_OPTIONS,
): PcmRecorder {
  const frameListeners = new Set<PcmFrameListener>()
  const errorListeners = new Set<PcmErrorListener>()
  let stream: MediaStreamLike | null = null
  let audioContext: AudioContextLike | null = null
  let workletNode: (AudioNode & { port: MessagePort }) | null = null
  let source: AudioNode | null = null
  let workletUrl: string | null = null
  let started = false
  let generation = 0
  let starting: Promise<void> | null = null

  function emitError(error: Error) {
    for (const listener of errorListeners) listener(error)
  }

  async function isAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false
    const Ctor = getAudioContextCtor() as unknown as (AudioContextCtor & {
      prototype: AudioContextLike
    })
    if (!Ctor) return false
    const temp = new Ctor()
    try {
      return Boolean((temp as AudioContextLike).audioWorklet?.addModule)
    } finally {
      try {
        await (temp as AudioContext).close()
      } catch {
        // noop
      }
    }
  }

  async function requestPermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false
    }
    try {
      const request = generation
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      probe.getTracks().forEach((track) => track.stop())
      return request === generation
    } catch {
      return false
    }
  }

  async function start(): Promise<void> {
    if (started) return
    const request = generation
    const Ctor = getAudioContextCtor()
    if (!Ctor) {
      throw new Error('AudioContext not supported')
    }

    try {
      const acquired = (await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })) as unknown as MediaStreamLike
      if (request !== generation) {
        acquired.getTracks().forEach((track) => track.stop())
        throw new Error('microphone_capture_cancelled')
      }
      stream = acquired
    } catch (error) {
      throw new Error(`microphone_permission_denied: ${(error as Error).message}`, { cause: error })
    }

    const context = new Ctor({ sampleRate: options.sampleRate }) as AudioContextLike
    audioContext = context
    if (!audioContext.audioWorklet?.addModule) {
      throw new Error('AudioWorklet not supported')
    }

    workletUrl = createWorkletModuleUrl()
    await audioContext.audioWorklet.addModule(workletUrl)
    if (request !== generation) throw new Error('microphone_capture_cancelled')

    const globalWindow = globalThis as typeof globalThis & {
      AudioWorkletNode?: AudioWorkletNodeCtor
    }
    const AudioWorkletNodeImpl = globalWindow.AudioWorkletNode
    if (!AudioWorkletNodeImpl) {
      throw new Error('AudioWorkletNode not supported')
    }

    const samplesPerFrame = Math.max(
      1,
      Math.floor((options.sampleRate * options.frameDurationMs) / 1000),
    )

    const node = new AudioWorkletNodeImpl(audioContext, WORKLET_MODULE_NAME)
    node.port.postMessage({ samplesPerFrame })
    node.port.onmessage = (event: MessageEvent) => {
      const buffer = event.data instanceof ArrayBuffer ? event.data : null
      if (!buffer) return
      const view = new Uint8Array(buffer)
      for (const listener of frameListeners) listener(view)
    }

    source = audioContext.createMediaStreamSource(stream as unknown as MediaStream)
    source.connect(node)
    workletNode = node
    started = true
  }

  async function stop(): Promise<void> {
    generation++
    started = false
    const oldNode = workletNode; workletNode = null
    const oldSource = source; source = null
    const oldStream = stream; stream = null
    const oldContext = audioContext; audioContext = null
    const oldUrl = workletUrl; workletUrl = null
    try {
      if (oldNode) {
        oldNode.port.onmessage = null
        oldNode.port.close()
        oldNode.disconnect()
      }
    } catch {
      // noop
    }
    try {
      oldSource?.disconnect()
    } catch {
      // noop
    }
    try {
      oldStream?.getTracks().forEach((track) => track.stop())
    } catch {
      // noop
    }
    try {
      await oldContext?.close()
    } catch {
      // noop
    }
    if (oldUrl) {
      try {
        URL.revokeObjectURL(oldUrl)
      } catch {
        // noop
      }
    }
  }

  return {
    isAvailable,
    requestPermission,
    start: () => {
      if (starting) return starting
      const request = generation
      const pending = start().catch(async (error: Error) => {
        if (request === generation) {
          await stop().catch(() => {})
          emitError(error)
        }
        throw error
      }).finally(() => { if (starting === pending) starting = null })
      starting = pending
      return pending
    },
    stop,
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
