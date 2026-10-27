// @arch docs/features/builtin-personal-agent.md
// @test src/__tests__/steward-display.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import type { ChatMessage } from '@shennian/shared'

const key = (accountId: string, machineId: string) => `shennian:steward:display:v1:${accountId}:${machineId}`
const listeners = new Set<() => void>()

/** Presentation only: never delete a body replica or mutate a native Agent session. */
export function visibleAfterStewardClear(messages: readonly ChatMessage[], clearedAt = 0): ChatMessage[] {
  return clearedAt > 0 ? messages.filter(message => message.ts > clearedAt) : [...messages]
}
export async function readStewardDisplayFloor(accountId: string, machineId: string): Promise<number> {
  const raw = await AsyncStorage.getItem(key(accountId, machineId))
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}
export async function clearStewardDisplay(accountId: string, machineId: string): Promise<void> {
  if (!accountId || !machineId) throw new Error('steward_display_scope_missing')
  await AsyncStorage.setItem(key(accountId, machineId), String(Date.now()))
  listeners.forEach(listener => listener())
}
export function useStewardDisplayFloor(accountId: string, machineId: string | undefined) {
  const [floor, setFloor] = useState<{ scope: string; value: number } | null>(null)
  const scope = `${accountId}:${machineId}`
  useFocusEffect(useCallback(() => {
    let active = true
    let generation = 0
    const refresh = () => {
      if (!accountId || !machineId) return
      const request = ++generation
      void readStewardDisplayFloor(accountId, machineId).then(value => {
        if (active && generation === request) setFloor({ scope, value })
      }).catch(() => { /* retain an already loaded floor on a transient read failure */ })
    }
    listeners.add(refresh)
    refresh()
    return () => { active = false; listeners.delete(refresh) }
  }, [accountId, machineId, scope]))
  // Do not flash hidden history before the persisted floor has loaded.
  return floor?.scope === scope ? floor.value : Number.MAX_SAFE_INTEGER
}
