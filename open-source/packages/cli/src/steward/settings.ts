// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-workspace.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getShennianDir } from '../config/index.js'
export type PersonalPaths = { workspace?: string; diary?: string }
const file = () => path.join(getShennianDir(), 'personal-paths.json')
export function readPersonalPaths(): PersonalPaths {
  try {
    const value = JSON.parse(fs.readFileSync(file(), 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    for (const key of ['workspace', 'diary']) if (value[key] !== undefined && (typeof value[key] !== 'string' || !path.isAbsolute(value[key]))) throw new Error()
    return { workspace: value.workspace, diary: value.diary }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error('personal_settings_invalid')
  }
}
export function defaultWorkspace(): string {
  const legacy = `${getShennianDir()}-steward`
  if (fs.existsSync(legacy) || process.env.SHENNIAN_HOME || process.env.VITEST) return legacy
  return path.join(os.homedir(), 'shennian-agent')
}
export function savePersonalPaths(paths: PersonalPaths): void {
  fs.mkdirSync(getShennianDir(), { recursive: true, mode: 0o700 })
  const tmp = `${file()}.${randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, JSON.stringify(paths, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file()) }
  finally { try { fs.unlinkSync(tmp) } catch { /* renamed */ } }
}
