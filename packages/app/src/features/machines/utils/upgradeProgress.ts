// @arch docs/architecture/cli/upgrade.md
// @test src/__tests__/machine-upgrade-progress.test.ts
export function upgradeProgressIndex(state?: string): number {
  // Legacy restarting is emitted at handoff, before installation has finished.
  if (state === 'starting') return 2
  if (state === 'recovering') return 3
  if (state === 'installing' || state === 'verifying') return 1
  return 0
}

