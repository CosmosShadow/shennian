// @covers packages/app/src/features/contacts/savedContactsCache.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedContact } from '../features/contacts/contactAccountClient'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value) },
  },
}))

import {
  readSavedContactsCache, removeSavedContactFromCache, writeSavedContactsCache,
} from '../features/contacts/savedContactsCache'

const contact: SavedContact = {
  id: 'saved-1', kind: 'human', displayName: '联系人', avatar: null, userId: 'user-2',
}

beforeEach(() => storage.clear())

describe('saved contacts local replica', () => {
  it('distinguishes never synchronized from a synchronized empty list', async () => {
    expect(await readSavedContactsCache('account-1')).toBeNull()
    await writeSavedContactsCache('account-1', [])
    expect(await readSavedContactsCache('account-1')).toEqual([])
  })

  it('keeps account lists separate and excludes owned agents', async () => {
    await writeSavedContactsCache('account-1', [contact, { ...contact, id: 'own:agent-1', owned: true }])
    expect(await readSavedContactsCache('account-1')).toEqual([contact])
    expect(await readSavedContactsCache('account-2')).toBeNull()
  })

  it('removes a saved contact after a confirmed server removal', async () => {
    await writeSavedContactsCache('account-1', [contact])
    await removeSavedContactFromCache('account-1', contact.id)
    expect(await readSavedContactsCache('account-1')).toEqual([])
  })
})

it('isolates malformed entries and normalizes cached display data without rewriting the snapshot', async () => {
  const raw = JSON.stringify([contact, null, { id: {}, kind: 'human' },
    { id: 'agent-a', kind: 'agent', displayName: { name: 'Agent A' }, avatar: { smallUrl: {} } }])
  storage.set('shennian:saved-contacts:v1:account-1', raw)
  expect(await readSavedContactsCache('account-1')).toEqual([
    contact, { id: 'agent-a', kind: 'agent', displayName: 'Agent A', avatar: null },
  ])
  expect(storage.get('shennian:saved-contacts:v1:account-1')).toBe(raw)
})
