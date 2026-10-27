// @arch docs/features/listening.md
// @test src/__tests__/listening-controls.test.ts
import { create } from 'zustand'
type Preference = { accountId: string | null; enabled: boolean | null }
export const useEnglishPreference = create<Preference>(() => ({ accountId: null, enabled: null }))
/** Cached hydration must not replace a newer value already known in this process. */
export function rememberEnglishPreference(accountId: string, enabled: boolean, seed = false) {
  const previous = useEnglishPreference.getState()
  if (seed && previous.accountId === accountId && previous.enabled !== null) return
  useEnglishPreference.setState({ accountId, enabled })
}
