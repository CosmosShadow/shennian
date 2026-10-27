import AsyncStorage from '@react-native-async-storage/async-storage'

const key = (accountId: string, agentId: string) => `shennian:agent-plaza-listed:v1:${accountId}:${agentId}`

/** null means this account/agent pair has never received a publication status. */
export async function readAgentPlazaListedCache(accountId: string, agentId: string): Promise<boolean | null> {
  if (!accountId || !agentId) return null
  try {
    const raw = await AsyncStorage.getItem(key(accountId, agentId))
    return raw === 'true' ? true : raw === 'false' ? false : null
  } catch {
    return null
  }
}

export async function writeAgentPlazaListedCache(accountId: string, agentId: string, plazaListed: boolean): Promise<void> {
  if (!accountId || !agentId) return
  await AsyncStorage.setItem(key(accountId, agentId), plazaListed ? 'true' : 'false').catch(() => {})
}
