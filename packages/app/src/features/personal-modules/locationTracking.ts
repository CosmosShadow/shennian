// @arch docs/features/recording-location.md
// @test src/__tests__/recording-location.test.ts
/** Web/old capability fallback. Metro selects the guarded native implementation. */
export function locationAvailable() {
  return false
}
export async function initializeLocation(_account: string) {}
export async function setLocationEnabled(_account: string, _enabled: boolean, _session?: string) {
  throw new Error('location_upgrade')
}
export async function startLocation(_account: string, _session: string) {}
export async function stopLocation() {}
export async function locationHeartbeat(_account: string, _session: string) {}
