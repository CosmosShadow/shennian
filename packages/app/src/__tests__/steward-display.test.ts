// @vitest-environment happy-dom
// @covers packages/app/src/features/steward/stewardDisplay.ts
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shennian/shared'
const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value) }),
} }))
vi.mock('expo-router', async () => { const React = await import('react'); return { useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]) } })
import AsyncStorage from '@react-native-async-storage/async-storage'
import { clearStewardDisplay, readStewardDisplayFloor, visibleAfterStewardClear, useStewardDisplayFloor } from '../features/steward/stewardDisplay'
beforeEach(() => { storage.clear(); vi.restoreAllMocks() })
it('persists an account-and-machine scoped display floor without changing Agent data', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(100)
  await clearStewardDisplay('account-a', 'machine-a')
  expect(await readStewardDisplayFloor('account-a', 'machine-a')).toBe(100)
  expect(await readStewardDisplayFloor('account-b', 'machine-a')).toBe(0)
  expect(await readStewardDisplayFloor('account-a', 'machine-b')).toBe(0)
  const messages: ChatMessage[] = [
    { id: 'old', ts: 10, content: 'old context', role: 'user' },
    { id: 'divider', ts: 100, content: '', divider: 'new', role: 'agent' },
    { id: 'next', ts: 101, content: 'new reply', role: 'agent' },
  ]
  expect(visibleAfterStewardClear(messages, await readStewardDisplayFloor('account-a', 'machine-a')).map(m => m.id)).toEqual(['next'])
  expect(messages).toHaveLength(3)
  expect(visibleAfterStewardClear(messages)).toEqual(messages)
})
it('propagates write failure and rejects missing scope', async () => {
  vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk failed'))
  await expect(clearStewardDisplay('a', 'm')).rejects.toThrow('disk failed')
  expect(await readStewardDisplayFloor('a', 'm')).toBe(0)
  await expect(clearStewardDisplay('', 'm')).rejects.toThrow('scope_missing')
})

it('retains the display floor after remount, refreshes on clear, and isolates account switches', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'), root = createRoot(host)
  const observed: number[] = []
  function Probe({ account }: { account: string }) {
    const floor = useStewardDisplayFloor(account, 'm')
    observed.push(floor)
    return React.createElement('span', null, floor)
  }
  try {
    await act(async () => root.render(React.createElement(Probe, { account: 'a' })))
    expect(host.textContent).toBe('0')
    vi.spyOn(Date, 'now').mockReturnValue(200)
    await act(async () => clearStewardDisplay('a', 'm'))
    expect(host.textContent).toBe('200')
    await act(async () => root.render(null))
    observed.length = 0
    await act(async () => root.render(React.createElement(Probe, { account: 'a' })))
    expect(observed[0]).toBe(Number.MAX_SAFE_INTEGER)
    expect(host.textContent).toBe('200')
    await act(async () => root.render(React.createElement(Probe, { account: 'b' })))
    expect(host.textContent).toBe('0')
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
