// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/atomic-rename.test.ts
import fs from 'node:fs'

// Windows real-time scanners (Defender), search indexers and sync clients open a
// freshly written file without FILE_SHARE_DELETE for a few milliseconds; a rename
// in that window fails with a sharing violation surfaced as one of these codes.
const TRANSIENT_WINDOWS_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
// About 1.3 s in total: long enough for a scan of a small state file, short enough
// that a genuine permission problem still fails promptly.
const RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320, 640] as const

export type RenameRetryDeps = {
  platform?: NodeJS.Platform
  sleep?: (milliseconds: number) => void
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

/**
 * `fs.renameSync` that survives a transient Windows file lock. Other platforms and
 * non-transient errors behave exactly like `fs.renameSync`: the original error is
 * rethrown once the bounded retries are exhausted.
 */
export function renameSyncWithRetry(from: string, to: string, deps: RenameRetryDeps = {}): void {
  const platform = deps.platform ?? process.platform
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const delay = RETRY_DELAYS_MS[attempt]
      if (platform !== 'win32' || !code || !TRANSIENT_WINDOWS_RENAME_CODES.has(code) || delay === undefined) {
        throw error
      }
      ;(deps.sleep ?? sleepSync)(delay)
    }
  }
}
