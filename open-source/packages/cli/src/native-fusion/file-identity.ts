// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-service.test.ts

import type fs from 'node:fs'

/**
 * Physical transcript identity for cursor reuse. `st_dev` is excluded: macOS
 * can renumber the same APFS volume across reboots, which would otherwise
 * reset every cursor and replay all live transcripts from offset 0.
 */
export function nativeFileIdentity(stat: Pick<fs.Stats, 'ino' | 'birthtimeMs'>): string {
  return `${String(stat.ino)}:${String(stat.birthtimeMs)}`
}

/** Legacy cursors persisted `dev:ino:birthtime`; compare them without the device. */
export function normalizeNativeFileIdentity(identity: string): string {
  const parts = identity.split(':')
  return parts.length === 3 ? `${parts[1]}:${parts[2]}` : identity
}
