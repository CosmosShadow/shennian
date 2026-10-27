// @covers open-source/packages/cli/src/session/run-recovery/barrier.ts

import { describe, expect, it } from 'vitest'
import { RunRecoveryBarrier } from '../session/run-recovery/barrier.js'

describe('RunRecoveryBarrier', () => {
  it('serializes one session without blocking unrelated sessions', async () => {
    const barrier = new RunRecoveryBarrier()
    barrier.begin('a')
    expect(barrier.isRecovering('a')).toBe(true)
    expect(barrier.isRecovering('b')).toBe(false)
    let released = false
    const waiting = barrier.wait('a').then(() => { released = true })
    await Promise.resolve()
    expect(released).toBe(false)
    barrier.end('a')
    await waiting
    expect(released).toBe(true)
  })

  it('freezes new dispatch independently of active recovery', () => {
    const barrier = new RunRecoveryBarrier()
    expect(barrier.isDispatchFrozen()).toBe(false)
    barrier.freezeDispatch()
    expect(barrier.isDispatchFrozen()).toBe(true)
  })
})
