// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/steward-workspace.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { getShennianDir } from '../config/index.js'
import { readPersonalPaths, defaultWorkspace } from './settings.js'
import { STEWARD_AGENTS_MD, STEWARD_CLAUDE_MD, STEWARD_INDEX_MD } from './templates.js'

export class StewardWorkspaceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** Explicit Client setting wins. Existing installations keep their legacy workspace;
 * fresh installations use a visible directory. SHENNIAN_HOME keeps tests isolated.
 */
export function getStewardDir(): string {
  return readPersonalPaths().workspace ?? defaultWorkspace()
}

export const STEWARD_FILES = [
  ['AGENTS.md', STEWARD_AGENTS_MD],
  ['index.md', STEWARD_INDEX_MD],
  ['CLAUDE.md', STEWARD_CLAUDE_MD],
] as const

export type StewardWorkspace = {
  dir: string
  /** Files written by this call; empty on an already-initialized workspace. */
  created: string[]
}

/** Idempotent: creates the directory and any missing template, never overwrites edits. */
export function ensureStewardWorkspace(dir = getStewardDir()): StewardWorkspace {
  assertPathsSeparate(dir, getShennianDir())
  ensureDirectory(dir)
  // Re-check on real paths: a symlinked parent could still route into the credential root.
  assertPathsSeparate(fs.realpathSync.native(dir), realpathIfExists(getShennianDir()))

  const created: string[] = []
  for (const [name, contents] of STEWARD_FILES) {
    const target = path.join(dir, name)
    try {
      fs.writeFileSync(target, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      created.push(name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return { dir: fs.realpathSync.native(dir), created }
}

function ensureDirectory(dir: string): void {
  let stat: fs.Stats | null = null
  try { stat = fs.lstatSync(dir) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (stat?.isSymbolicLink()) {
    throw new StewardWorkspaceError('steward_workspace_symlink', 'The steward workspace path must not be a symbolic link.')
  }
  if (stat && !stat.isDirectory()) {
    throw new StewardWorkspaceError('steward_workspace_not_directory', 'The steward workspace path is not a directory.')
  }
  if (!stat) fs.mkdirSync(dir, { mode: 0o700 })
  if (process.platform === 'win32') return
  const current = fs.lstatSync(dir)
  if (typeof process.getuid === 'function' && current.uid !== process.getuid()) {
    throw new StewardWorkspaceError('steward_workspace_owner', 'The steward workspace is owned by another user.')
  }
  if ((current.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700)
}

function realpathIfExists(target: string): string {
  try { return fs.realpathSync.native(target) } catch { return path.resolve(target) }
}

function comparable(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved
}

function isSameOrInside(candidate: string, root: string): boolean {
  const relative = path.relative(comparable(root), comparable(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Neither directory may be the same as, or nested in, the other. */
export function assertPathsSeparate(stewardDir: string, credentialDir: string): void {
  if (isSameOrInside(stewardDir, credentialDir) || isSameOrInside(credentialDir, stewardDir)) {
    throw new StewardWorkspaceError(
      'steward_workspace_overlaps_credentials',
      'The steward workspace must be separate from the Shennian credential directory.',
    )
  }
}
