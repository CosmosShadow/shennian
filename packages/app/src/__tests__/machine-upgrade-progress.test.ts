// @covers packages/app/src/features/machines/hooks/useMachineUpgrade.ts
// @covers packages/app/src/features/machines/utils/upgradeProgress.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { upgradeProgressIndex } from '../features/machines/utils/upgradeProgress'
describe('machine upgrade progress', () => {
  it('maps restart and verification states without an empty progress indicator', () => {
    expect(upgradeProgressIndex()).toBe(0)
    expect(upgradeProgressIndex('downloading')).toBe(0)
    expect(upgradeProgressIndex('installing')).toBe(1)
    expect(upgradeProgressIndex('verifying')).toBe(1)
    expect(upgradeProgressIndex('restarting')).toBe(0)
    expect(upgradeProgressIndex('starting')).toBe(2)
    expect(upgradeProgressIndex('recovering')).toBe(3)
  })
  it('does not recheck on version push or infer success from machine presence', () => {
    const source = readFileSync(new URL('../features/machines/hooks/useMachineUpgrade.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('[machine.cliVersion, t]')
    expect(source).not.toContain('liveMachine.cliVersion !== originalVersion')
    expect(source).toContain('generation !== checkGenerationRef.current || operationActiveRef.current')
  })
})
