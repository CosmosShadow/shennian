// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-agent-credential-paths.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getShennianDir } from '../config/index.js'

/**
 * Returns both configured aliases and canonical targets for every Shennian
 * credential root. A managed runtime must deny all returned paths: denying
 * only a symlink alias leaves its real target readable in host-full mode.
 */
export function resolveProtectedShennianDirectories(): string[] {
  const roots = new Set<string>()
  for (const candidate of [path.join(os.homedir(), '.shennian'), getShennianDir()]) {
    const normalized = path.resolve(candidate)
    roots.add(normalized)
    const canonical = realpathIfPresent(normalized)
    if (canonical) roots.add(path.normalize(canonical))
  }
  return [...roots].sort()
}

function realpathIfPresent(candidate: string): string | null {
  try {
    return fs.realpathSync.native(candidate)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw new Error('managed_agent_credential_root_unavailable', { cause: error })
    }

    // A dangling symlink is not an absent credential root. Treat it as an
    // invalid security boundary instead of silently omitting its target.
    try {
      fs.lstatSync(candidate)
    } catch (lstatError) {
      const lstatCode = (lstatError as NodeJS.ErrnoException).code
      if (lstatCode === 'ENOENT' || lstatCode === 'ENOTDIR') return null
      throw new Error('managed_agent_credential_root_unavailable', { cause: lstatError })
    }
    throw new Error('managed_agent_credential_root_unavailable', { cause: error })
  }
}
