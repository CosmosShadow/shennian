// @covers packages/app/src/hooks/networkStatusState.ts

import { describe, expect, it } from 'vitest'
import { nativeNetworkStatus } from '../hooks/networkStatusState'

describe('native network status', () => {
  it('keeps unknown separate from confirmed online and offline states', () => {
    expect(nativeNetworkStatus({ isConnected: null })).toBe('unknown')
    expect(nativeNetworkStatus({ isConnected: true })).toBe('online')
    expect(nativeNetworkStatus({ isConnected: false })).toBe('offline')
  })
})
