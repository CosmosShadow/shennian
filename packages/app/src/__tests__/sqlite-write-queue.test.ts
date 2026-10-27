// @covers src/storage/sqlite-write-queue.native.ts

import { describe, expect, it, vi } from 'vitest'
import { withWrite, withWriteTransaction } from '../storage/sqlite-write-queue.native'

describe('native SQLite write queue', () => {
  it('never overlaps transactions and continues after a failure', async () => {
    let active = 0
    let maxActive = 0
    const db = {
      withTransactionAsync: vi.fn(async (task: () => Promise<unknown>) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        try {
          return await task()
        } finally {
          active -= 1
        }
      }),
    }
    let releaseFirst: (() => void) | undefined
    const first = withWriteTransaction(db as never, () => new Promise<void>((resolve) => {
      releaseFirst = resolve
    }))
    const failed = withWriteTransaction(db as never, async () => {
      throw new Error('write failed')
    })
    const last = withWriteTransaction(db as never, async () => {})

    await Promise.resolve()
    expect(active).toBe(1)
    releaseFirst?.()
    await expect(first).resolves.toBeUndefined()
    await expect(failed).rejects.toThrow('write failed')
    await expect(last).resolves.toBeUndefined()
    expect(maxActive).toBe(1)
  })

  it('serializes plain writes with transactions on the shared connection', async () => {
    const order: string[] = []
    let releaseTransaction: (() => void) | undefined
    const db = {
      withTransactionAsync: vi.fn(async (task: () => Promise<unknown>) => task()),
    }
    const transaction = withWriteTransaction(db as never, async () => {
      order.push('transaction:start')
      await new Promise<void>((resolve) => { releaseTransaction = resolve })
      order.push('transaction:end')
    })
    const plainWrite = withWrite(async () => {
      order.push('plain-write')
    })

    await Promise.resolve()
    expect(order).toEqual(['transaction:start'])
    releaseTransaction?.()
    await Promise.all([transaction, plainWrite])
    expect(order).toEqual(['transaction:start', 'transaction:end', 'plain-write'])
  })
})
