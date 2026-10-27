// @covers packages/app/src/features/machines/utils/machineAccessPolicy.ts

import { describe, expect, it } from 'vitest'
import {
  getMachineSharingSurfaceState,
  isMachineOwner,
} from '../features/machines/utils/machineAccessPolicy'

describe('machine access presentation policy', () => {
  it('keeps legacy omitted roles owner-compatible but never promotes a grantee', () => {
    expect(isMachineOwner({})).toBe(true)
    expect(isMachineOwner({ role: 'owner' })).toBe(true)
    expect(isMachineOwner({ role: 'granted' })).toBe(false)
    expect(isMachineOwner(undefined)).toBe(false)
  })

  it('fails a direct sharing route closed for every granted permission', () => {
    for (const permission of ['view', 'use', 'full', 'admin'] as const) {
      const machine = { role: 'granted' as const, permission }
      expect(getMachineSharingSurfaceState(machine, { loading: false, remoteResolved: true })).toBe(
        'forbidden',
      )
    }
  })

  it('distinguishes inventory reconciliation from an authoritatively missing machine', () => {
    expect(getMachineSharingSurfaceState(undefined, { loading: true, remoteResolved: false })).toBe(
      'loading',
    )
    expect(
      getMachineSharingSurfaceState(undefined, { loading: false, remoteResolved: false }),
    ).toBe('loading')
    expect(getMachineSharingSurfaceState(undefined, { loading: false, remoteResolved: true })).toBe(
      'missing',
    )
  })
})
