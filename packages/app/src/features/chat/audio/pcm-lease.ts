// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
// All native recorder instances share one hardware microphone. Fail rather than steal it.
let owner: symbol | null = null
export function acquirePcmLease(id: symbol) {
  if (owner !== null && owner !== id) throw new Error('microphone_in_use')
  owner = id
}
export function releasePcmLease(id: symbol) {
  if (owner === id) owner = null
}

export function isPcmLeaseHeld() {
  return owner !== null
}

export function ownsPcmLease(id: symbol) {
  return owner === id
}
