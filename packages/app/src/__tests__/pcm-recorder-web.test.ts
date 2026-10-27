// @covers ../features/chat/audio/create-pcm-recorder.web.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPcmRecorder } from '../features/chat/audio/create-pcm-recorder.web'
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function setup() {
  const stopTrack = vi.fn()
  const media = { getTracks: () => [{ stop: stopTrack }] }
  const getUserMedia = vi.fn(async () => media)
  const closeContext = vi.fn(async () => undefined)
  const addModule = vi.fn(async () => undefined)
  const disconnect = vi.fn()
  const port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null as ((event: { data: ArrayBuffer }) => void) | null }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('AudioContext', class {
    audioWorklet = { addModule }
    close = closeContext
    createMediaStreamSource = () => ({ connect: vi.fn(), disconnect })
  })
  vi.stubGlobal('AudioWorkletNode', class { port = port; disconnect = disconnect })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:worklet')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  return { media, stopTrack, getUserMedia, closeContext, addModule, port, revoke }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('Web PCM capture cancellation', () => {
  it('releases audio tracks and context if worklet initialization fails before started', async () => {
    const h = setup(); h.addModule.mockRejectedValueOnce(new Error('module failed'))
    const recorder = createPcmRecorder(); const onError = vi.fn(); recorder.onError(onError)
    await expect(recorder.start()).rejects.toThrow('module failed')
    expect(h.stopTrack).toHaveBeenCalledOnce()
    expect(h.closeContext).toHaveBeenCalledOnce()
    expect(h.revoke).toHaveBeenCalledExactlyOnceWith('blob:worklet')
    expect(onError).toHaveBeenCalledOnce()
    await recorder.stop(); expect(h.stopTrack).toHaveBeenCalledOnce()
  })
  it('immediately closes microphone tracks granted after cancellation', async () => {
    const h = setup(); const grant = deferred<typeof h.media>(); h.getUserMedia.mockReturnValueOnce(grant.promise)
    const recorder = createPcmRecorder(); const pending = recorder.start()
    await recorder.stop(); grant.resolve(h.media)
    await expect(pending).rejects.toThrow('microphone_capture_cancelled')
    expect(h.stopTrack).toHaveBeenCalledOnce(); expect(h.addModule).not.toHaveBeenCalled()
  })
  it('does not create a late audio node after stop while a worklet module is loading', async () => {
    const h = setup(); const module = deferred<undefined>(); h.addModule.mockReturnValueOnce(module.promise)
    const recorder = createPcmRecorder(); const pending = recorder.start()
    await vi.waitFor(() => expect(h.addModule).toHaveBeenCalled())
    await recorder.stop(); module.resolve(undefined)
    await expect(pending).rejects.toThrow('microphone_capture_cancelled')
    expect(h.stopTrack).toHaveBeenCalledOnce(); expect(h.closeContext).toHaveBeenCalledOnce()
    expect(h.port.postMessage).not.toHaveBeenCalled()
  })
  it('invalidates an outstanding permission probe and stops its tracks', async () => {
    const h = setup(); const grant = deferred<typeof h.media>(); h.getUserMedia.mockReturnValueOnce(grant.promise)
    const recorder = createPcmRecorder(); const permission = recorder.requestPermission()
    await recorder.stop(); grant.resolve(h.media)
    expect(await permission).toBe(false); expect(h.stopTrack).toHaveBeenCalledOnce()
  })
  it('serializes concurrent startup and removes frame delivery when stopped', async () => {
    const h = setup(); const recorder = createPcmRecorder(); const onFrame = vi.fn(); recorder.onFrame(onFrame)
    await Promise.all([recorder.start(), recorder.start()])
    expect(h.getUserMedia).toHaveBeenCalledOnce()
    h.port.onmessage?.({ data: new Uint8Array([1, 2]).buffer })
    expect(onFrame).toHaveBeenCalledWith(new Uint8Array([1, 2]))
    await recorder.stop(); expect(h.port.onmessage).toBeNull(); expect(h.port.close).toHaveBeenCalledOnce()
    expect(h.stopTrack).toHaveBeenCalledOnce()
  })
})
