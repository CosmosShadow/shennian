// @covers packages/app/src/storage/db.native.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const sqlite = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
}))
const nativePlatform = vi.hoisted(() => ({ OS: 'ios' }))

vi.mock('expo-sqlite', () => sqlite)
vi.mock('react-native', () => ({ Platform: nativePlatform }))

describe('native SQLite initialization', () => {
  beforeEach(() => {
    vi.resetModules()
    sqlite.openDatabaseAsync.mockReset()
    nativePlatform.OS = 'ios'
  })

  it('shares one connection while concurrent callers wait for schema initialization', async () => {
    const fakeDatabase = {
      execAsync: vi.fn().mockResolvedValue(undefined),
      getAllAsync: vi.fn().mockResolvedValue([]),
    }
    let resolveOpen: ((value: typeof fakeDatabase) => void) | undefined
    sqlite.openDatabaseAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve
        }),
    )

    const { db } = await import('../storage/db.native')
    const first = db.getSessions()
    const second = db.getSessions()

    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1)
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith('shennian.db', undefined)
    resolveOpen?.(fakeDatabase)

    await expect(Promise.all([first, second])).resolves.toEqual([[], []])
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1)
    // One initialization query backfills the durable published-index barrier,
    // followed by the two callers' visible-session reads.
    expect(fakeDatabase.getAllAsync).toHaveBeenCalledTimes(3)
    const initializationSql = fakeDatabase.execAsync.mock.calls[0]?.[0] as string
    expect(initializationSql).toContain('PRAGMA busy_timeout = 5000;')
    expect(initializationSql).toContain('PRAGMA journal_mode = WAL;')
    expect(initializationSql.indexOf('PRAGMA busy_timeout')).toBeLessThan(
      initializationSql.indexOf('PRAGMA journal_mode'),
    )
  })

  it('keeps a separate native connection on Android', async () => {
    nativePlatform.OS = 'android'
    const fakeDatabase = {
      execAsync: vi.fn().mockResolvedValue(undefined),
      getAllAsync: vi.fn().mockResolvedValue([]),
    }
    sqlite.openDatabaseAsync.mockResolvedValue(fakeDatabase)

    const { db } = await import('../storage/db.native')
    await expect(db.getSessions()).resolves.toEqual([])

    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith('shennian.db', {
      useNewConnection: true,
    })
  })

  it('does not expose the connection while schema initialization is still running', async () => {
    let resolveSchema: (() => void) | undefined
    const execAsync = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSchema = resolve
          }),
      )
      .mockResolvedValue(undefined)
    const fakeDatabase = {
      execAsync,
      getAllAsync: vi.fn().mockResolvedValue([]),
    }
    let resolveOpen: ((value: typeof fakeDatabase) => void) | undefined
    sqlite.openDatabaseAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve
        }),
    )

    const { db } = await import('../storage/db.native')
    const first = db.getSessions()
    resolveOpen?.(fakeDatabase)
    await Promise.resolve()
    expect(fakeDatabase.execAsync).toHaveBeenCalledTimes(1)
    const later = db.getSessions()

    expect(fakeDatabase.getAllAsync).not.toHaveBeenCalled()
    resolveSchema?.()
    await expect(Promise.all([first, later])).resolves.toEqual([[], []])
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1)
  })

  it('allows a later caller to retry after opening the database fails', async () => {
    const fakeDatabase = {
      execAsync: vi.fn().mockResolvedValue(undefined),
      getAllAsync: vi.fn().mockResolvedValue([]),
    }
    sqlite.openDatabaseAsync
      .mockRejectedValueOnce(new Error('open failed'))
      .mockResolvedValueOnce(fakeDatabase)

    const { db } = await import('../storage/db.native')

    const first = db.getSessions()
    const concurrent = db.getSessions()
    await expect(Promise.all([first, concurrent])).rejects.toThrow('open failed')
    await expect(db.getSessions()).resolves.toEqual([])
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(2)
  })

  it('does not let a stale failed caller clear a newer successful retry', async () => {
    let rejectFirstOpen: ((error: Error) => void) | undefined
    const firstOpen = new Promise<never>((_resolve, reject) => {
      rejectFirstOpen = reject
    })
    const retryDatabase = {
      execAsync: vi.fn().mockResolvedValue(undefined),
      getAllAsync: vi.fn().mockResolvedValue([]),
    }
    sqlite.openDatabaseAsync
      .mockReturnValueOnce(firstOpen)
      .mockResolvedValueOnce(retryDatabase)

    const { db } = await import('../storage/db.native')
    const observedFailure = db.getSessions()
    const staleFailure = db.getSessions()
    let releaseStaleFailure: (() => void) | undefined
    const staleFailureGate = new Promise<void>((resolve) => {
      releaseStaleFailure = resolve
    })
    const delayedStaleFailure = staleFailure.catch(async (error) => {
      await staleFailureGate
      throw error
    })
    rejectFirstOpen?.(new Error('open failed'))

    await expect(observedFailure).rejects.toThrow('open failed')
    await expect(db.getSessions()).resolves.toEqual([])
    releaseStaleFailure?.()
    await expect(delayedStaleFailure).rejects.toThrow('open failed')
    await expect(db.getSessions()).resolves.toEqual([])

    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(2)
    // The successful retry performs one published-index backfill plus two reads.
    expect(retryDatabase.getAllAsync).toHaveBeenCalledTimes(3)
  })
})
