// @arch docs/features/agent-local-first-persistence.md
// @test src/__tests__/sqlite-write-queue.test.ts

import type { SQLiteDatabase } from 'expo-sqlite'

let writeTail: Promise<void> = Promise.resolve()

/**
 * Serialize every write on expo-sqlite's shared connection. A plain runAsync
 * can otherwise overlap a queued transaction and fail with SQLITE_BUSY while
 * the transaction is committing/finalizing.
 */
export function withWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeTail.then(task)
  writeTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * expo-sqlite uses one connection for the app database and rejects overlapping
 * transactions. Serialize every transaction while allowing a failed write to
 * release the queue for the next caller.
 */
export function withWriteTransaction(
  db: SQLiteDatabase,
  task: () => Promise<void>,
): Promise<void> {
  return withWrite(() => db.withTransactionAsync(task))
}
