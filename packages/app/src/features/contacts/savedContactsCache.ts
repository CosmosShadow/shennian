import { normalizeContacts } from './contactValues'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { SavedContact } from './contactAccountClient'

const key = (accountId: string) => `shennian:saved-contacts:v1:${accountId}`

/** null means this account has never received a complete contacts snapshot. */
export async function readSavedContactsCache(accountId: string): Promise<SavedContact[] | null> {
  if (!accountId) return null
  try {
    const raw = await AsyncStorage.getItem(key(accountId))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return normalizeContacts(parsed).filter((value) => !value.owned)
  } catch {
    return null
  }
}

export async function writeSavedContactsCache(accountId: string, contacts: SavedContact[]): Promise<void> {
  if (!accountId) return
  await AsyncStorage.setItem(key(accountId), JSON.stringify(normalizeContacts(contacts).filter((item) => !item.owned)))
}

export async function removeSavedContactFromCache(accountId: string, contactId: string): Promise<void> {
  const current = await readSavedContactsCache(accountId)
  if (current === null) return
  await writeSavedContactsCache(accountId, current.filter((item) => item.id !== contactId))
}
