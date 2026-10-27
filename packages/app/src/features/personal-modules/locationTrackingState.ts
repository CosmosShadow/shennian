// @arch docs/features/recording-location.md
// @test src/__tests__/recording-location.test.ts
import { create } from 'zustand'
export const useLocationTracking = create<{
  account: string | null
  enabled: boolean
  active: boolean
  error: string | null
  revision: number
}>(() => ({ account: null, enabled: false, active: false, error: null, revision: 0 }))
