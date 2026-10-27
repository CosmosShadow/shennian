// @vitest-environment happy-dom
// @covers packages/app/src/features/personal-workspace/usePrimaryMachine.ts
import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  accountId: 'a',
  cachedDisplay: false,
  read: vi.fn(), write: vi.fn(),
  get: vi.fn(),
  focus: undefined as undefined | (() => void | (() => void)),
}))
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    state.focus = callback
    useEffect(callback, [callback])
  },
}))
vi.mock('../config/auth', () => ({
  useAuthStore: Object.assign(
    (select: (s: any) => unknown) => select({ user: { id: state.accountId } }),
    { getState: () => ({ user: { id: state.accountId } }) },
  ),
}))
vi.mock('../features/personal-workspace/client', () => ({
  primaryMachineClient: { get: state.get },
  personalErrorKey: () => 'request_failed',
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: state.read, setItem: state.write } }))
vi.mock('../config/server', () => ({ getServerUrl: () => 'https://shennian.net' }))
import { usePrimaryMachine } from '../features/personal-workspace/usePrimaryMachine'

let host: HTMLDivElement, root: Root
let snapshot: ReturnType<typeof usePrimaryMachine>
function Probe() {
  snapshot = usePrimaryMachine({ cachedDisplay: state.cachedDisplay })
  return null
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  state.accountId = 'a'
  state.cachedDisplay = false
  state.read.mockReset().mockResolvedValue(null)
  state.write.mockReset().mockResolvedValue(undefined)
  state.get.mockReset()
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()) })

it('retains the same primary snapshot during focus refresh, then applies a changed primary', async () => {
  const first = { revision: 1, machine: { id: 'mac-a' } }
  const next = { revision: 2, machine: { id: 'mac-b' } }
  state.get.mockResolvedValueOnce(first)
  await act(async () => root.render(React.createElement(Probe)))
  expect(snapshot.record).toBe(first)
  const refresh = deferred<typeof next>()
  state.get.mockReturnValueOnce(refresh.promise)
  await act(async () => { state.focus!() })
  expect(snapshot.record).toBe(first)
  expect(snapshot.loading).toBe(true)
  await act(async () => refresh.resolve(next))
  expect(snapshot.record).toBe(next)
  expect(snapshot.loading).toBe(false)
})

it('does not keep a stale primary after a failed refresh', async () => {
  state.get.mockResolvedValueOnce({ revision: 1, machine: { id: 'mac-a' } })
  await act(async () => root.render(React.createElement(Probe)))
  state.get.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { state.focus!() })
  expect(snapshot.record).toBeUndefined()
  expect(snapshot.error).toBe('request_failed')
  expect(snapshot.loading).toBe(false)
})

it('never carries another account snapshot into the new account or accepts its late response', async () => {
  state.get.mockResolvedValueOnce({ revision: 1, machine: { id: 'mac-a' } })
  await act(async () => root.render(React.createElement(Probe)))
  const old = deferred<unknown>(), current = deferred<unknown>()
  state.get.mockReturnValueOnce(old.promise)
  await act(async () => { state.focus!() })
  state.accountId = 'b'
  state.get.mockReturnValueOnce(current.promise)
  await act(async () => root.render(React.createElement(Probe)))
  expect(snapshot.record).toBeUndefined()
  expect(snapshot.loading).toBe(true)
  await act(async () => old.resolve({ revision: 2, machine: { id: 'mac-a' } }))
  expect(snapshot.record).toBeUndefined()
  await act(async () => current.resolve({ revision: 1, machine: { id: 'mac-b' } }))
  expect(snapshot.record?.machine?.id).toBe('mac-b')
})

const cachedPrimary = { revision: 1, machine: { id: 'mac-a', name: 'Mac', online: true } }
it('shows a cold-start local primary before the network returns and persists the authoritative replacement', async () => {
  state.cachedDisplay = true
  state.read.mockResolvedValue(JSON.stringify(cachedPrimary))
  const remote = deferred<typeof cachedPrimary>()
  state.get.mockReturnValue(remote.promise)
  await act(async () => root.render(React.createElement(Probe)))
  expect(snapshot.record).toEqual(cachedPrimary)
  expect(snapshot.loading).toBe(true)
  expect(state.read).toHaveBeenCalledWith('shennian:primary-machine:v1:https://shennian.net:a')
  const next = { revision: 2, machine: { id: 'mac-b', name: 'New Mac', online: true } }
  await act(async () => remote.resolve(next))
  expect(snapshot.record).toEqual(next)
  expect(state.write).toHaveBeenCalledWith(expect.any(String), JSON.stringify(next))
})
it('keeps cached history routing available offline without hiding the revalidation error', async () => {
  state.cachedDisplay = true
  state.read.mockResolvedValue(JSON.stringify(cachedPrimary))
  state.get.mockRejectedValue(new Error('offline'))
  await act(async () => root.render(React.createElement(Probe)))
  expect(snapshot.record).toEqual(cachedPrimary)
  expect(snapshot.error).toBe('request_failed')
  expect(snapshot.loading).toBe(false)
})
it('does not let a slow disk read overwrite a confirmed removal of the primary', async () => {
  state.cachedDisplay = true
  const disk = deferred<string>()
  state.read.mockReturnValue(disk.promise)
  state.get.mockResolvedValue({ revision: 2, machine: null })
  await act(async () => root.render(React.createElement(Probe)))
  await act(async () => disk.resolve(JSON.stringify(cachedPrimary)))
  expect(snapshot.record).toEqual({ revision: 2, machine: null })
})
it('ignores corrupt local routing and continues with the network result', async () => {
  state.cachedDisplay = true
  state.read.mockResolvedValue('{broken')
  const remote = deferred<typeof cachedPrimary>()
  state.get.mockReturnValue(remote.promise)
  await act(async () => root.render(React.createElement(Probe)))
  expect(snapshot.record).toBeUndefined()
  await act(async () => remote.resolve(cachedPrimary))
  expect(snapshot.record).toEqual(cachedPrimary)
})
it('never displays another account late disk cache', async () => {
  state.cachedDisplay = true
  const disk = deferred<string>()
  state.read.mockReturnValueOnce(disk.promise).mockResolvedValue(null)
  state.get.mockReturnValue(new Promise(() => {}))
  await act(async () => root.render(React.createElement(Probe)))
  state.accountId = 'b'
  await act(async () => root.render(React.createElement(Probe)))
  await act(async () => disk.resolve(JSON.stringify(cachedPrimary)))
  expect(snapshot.record).toBeUndefined()
})
