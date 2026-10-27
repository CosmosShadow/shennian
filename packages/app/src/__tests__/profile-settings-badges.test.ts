// @covers packages/app/src/features/profile/settingsBadges.ts

import { describe, expect, it } from 'vitest'
import {
  getSettingsUpgradeBadges,
  hasMachineCliUpgradeBadge,
} from '../features/profile/settingsBadges'

function machine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    name: 'Mac',
    os: 'darwin',
    agentList: [],
    paired: true,
    online: true,
    lastSeen: '2026-07-03T00:00:00.000Z',
    cliVersion: '0.2.100',
    ...overrides,
  } as never
}

describe('profile settings upgrade badges', () => {
  it('marks machines when CLI is blocked or older than the latest known version', () => {
    expect(hasMachineCliUpgradeBadge([machine({ cliVersion: '0.2.74' })], '0.2.100')).toBe(true)
    expect(hasMachineCliUpgradeBadge([machine({ cliVersion: '0.2.100' })], '0.2.101')).toBe(true)
    expect(hasMachineCliUpgradeBadge([machine({ cliVersion: '0.2.101' })], '0.2.101')).toBe(false)
  })

  it('keeps the settings dot traceable to computers until all computers are current', () => {
    const current = machine({ cliVersion: '0.2.101' })
    const outdated = machine({ cliVersion: '0.2.100' })
    expect(getSettingsUpgradeBadges({ machines: [current, outdated], latestCliVersion: '0.2.101', ota: false }))
      .toEqual({ any: true, machines: true, ota: false })
    expect(getSettingsUpgradeBadges({ machines: [current, current], latestCliVersion: '0.2.101', ota: false }))
      .toEqual({ any: false, machines: false, ota: false })
    expect(getSettingsUpgradeBadges({ machines: [], latestCliVersion: null, ota: false }))
      .toEqual({ any: false, machines: false, ota: false })
    expect(getSettingsUpgradeBadges({ machines: [outdated], latestCliVersion: '0.2.101', ota: true }))
      .toEqual({ any: true, machines: true, ota: true })
  })

  it('fans out top-level settings and machine badges', () => {
    expect(
      getSettingsUpgradeBadges({
        machines: [machine({ cliVersion: '0.2.100' })],
        latestCliVersion: '0.2.100',
        ota: true,
      }),
    ).toEqual({ any: true, machines: false, ota: true })
    expect(
      getSettingsUpgradeBadges({
        machines: [
          machine({
            cliVersion: '0.2.101',
          }),
        ],
        latestCliVersion: '0.2.101',
        ota: false,
      }),
    ).toEqual({ any: false, machines: false, ota: false })
  })
})
