// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-workspace.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { getShennianDir } from '../config/index.js'
import { assertPathsSeparate, ensureStewardWorkspace } from './workspace.js'
import { readPersonalPaths, savePersonalPaths } from './settings.js'
export function validatePersonalDirectory(value: string): string {
  if (!path.isAbsolute(value) || /[\u0000-\u001f]/.test(value)) throw new Error('personal_absolute_directory_required')
  const resolved = path.resolve(value)
  assertPathsSeparate(resolved, getShennianDir())
  let parent = resolved
  while (true) {
    try { if (fs.lstatSync(parent).isSymbolicLink()) throw new Error('personal_symlink_forbidden') }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const next = path.dirname(parent); if (next === parent) break; parent = next
  }
  if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) throw new Error('personal_directory_required')
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 })
  const real = fs.realpathSync(resolved)
  assertPathsSeparate(real, fs.existsSync(getShennianDir()) ? fs.realpathSync(getShennianDir()) : getShennianDir())
  return real
}
export function configurePersonalPaths(input: { workspace?: string; diary?: string; clearDiary?: boolean }) {
  if ((!input.workspace && !input.diary && !input.clearDiary) || (input.diary && input.clearDiary)) throw new Error('personal_directory_required')
  const next = { ...readPersonalPaths() }
  if (input.workspace) next.workspace = validatePersonalDirectory(input.workspace)
  if (input.clearDiary) delete next.diary
  if (input.diary) next.diary = validatePersonalDirectory(input.diary)
  // Prepare the selected workspace before publishing the new setting. On failure,
  // the old configuration remains authoritative; existing files are never overwritten.
  if (input.workspace) ensureStewardWorkspace(next.workspace)
  savePersonalPaths(next)
  return next
}
