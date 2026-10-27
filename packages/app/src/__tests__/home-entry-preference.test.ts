// @vitest-environment happy-dom
// @arch docs/architecture/mobile-navigation.md
// @covers src/features/mobile-navigation/homeEntryPreference.ts
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined
let observed: any
const host = document.createElement('div')
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; vi.resetModules(); vi.clearAllMocks() })
async function load(raw: string | null = null) {
  storage.getItem.mockResolvedValue(raw)
  storage.setItem.mockResolvedValue(undefined)
  return import('../features/mobile-navigation/homeEntryPreference')
}
async function observe(module: Awaited<ReturnType<typeof load>>, account: string) {
  function Observer() { observed = module.useHomeEntries(account); return null }
  root ??= createRoot(host)
  await act(async () => root!.render(React.createElement(Observer)))
  return observed
}
it('defaults all four entries on and treats unknown or malformed fields as defaults', async () => {
  const module = await load('{broken')
  expect((await observe(module, 'owner')).entries).toEqual({ recording: true, schedules: true, diary: true, folders: true })
  expect(observed.hydrated).toBe(true)
  expect(module.normalizeHomeEntries({ diary: false, recording: 'false', extra: false })).toEqual({ recording: true, schedules: true, diary: false, folders: true })
})
it('serializes concurrent changes without losing other entries or accounts and restores on reload', async () => {
  const module = await load()
  await module.hydrateHomeEntries()
  await Promise.all([module.saveHomeEntry('a', 'diary', false), module.saveHomeEntry('a', 'folders', false), module.saveHomeEntry('b', 'recording', false)])
  const persisted = storage.setItem.mock.calls.at(-1)![1]
  expect((await observe(module, 'a')).entries).toMatchObject({ diary: false, folders: false, recording: true })
  expect((await observe(module, 'b')).entries).toMatchObject({ diary: true, recording: false })
  await act(async () => root!.unmount()); root = undefined
  vi.resetModules()
  const reloaded = await load(persisted)
  expect((await observe(reloaded, 'a')).entries).toMatchObject({ diary: false, folders: false })
})
it('does not publish a failed save and allows the next save to succeed', async () => {
  const module = await load()
  await module.hydrateHomeEntries()
  storage.setItem.mockRejectedValueOnce(new Error('disk full'))
  await expect(module.saveHomeEntry('a', 'recording', false)).rejects.toThrow('disk full')
  expect((await observe(module, 'a')).entries.recording).toBe(true)
  await act(async () => module.saveHomeEntry('a', 'diary', false))
  expect(observed.entries).toMatchObject({ recording: true, diary: false })
})
it('waits for hydration before merging an edit with saved preferences', async () => {
  let resolveRead!: (raw: string) => void
  const module = await load()
  storage.getItem.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
  const saving = module.saveHomeEntry('a', 'folders', false)
  resolveRead(JSON.stringify({ a: { diary: false } }))
  await saving
  expect((await observe(module, 'a')).entries).toMatchObject({ diary: false, folders: false })
})
