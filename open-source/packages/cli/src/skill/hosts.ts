// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/skill-hosts.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installOfficialSkill, updateOfficialSkill, type SkillInstallResult } from './updater.js'

/**
 * One user-level Skill directory per group of AI tools. Each tool is detected by its
 * own home config directory (present after the tool has run once), so GUI-only
 * installs such as Cursor are covered without probing executables.
 * `~/.agents/skills` is the shared location read by Codex, Cursor, OpenCode and Gemini CLI.
 */
export const SKILL_HOSTS = [
  { id: 'claude', names: ['Claude Code'], markers: ['.claude'], skillsDir: ['.claude', 'skills'] },
  {
    id: 'agents',
    names: ['Codex', 'Cursor', 'OpenCode', 'Gemini CLI'],
    markers: ['.codex', '.cursor', path.join('.config', 'opencode'), '.gemini'],
    skillsDir: ['.agents', 'skills'],
  },
  { id: 'qwen', names: ['Qwen Code'], markers: ['.qwen'], skillsDir: ['.qwen', 'skills'] },
] as const

export type SkillHostTarget = {
  id: (typeof SKILL_HOSTS)[number]['id']
  names: string[]
  path: string
}

export type SkillHostInstallResult = SkillHostTarget & (
  | { ok: true; result: SkillInstallResult }
  | { ok: false; error: string }
)

export function detectSkillHostTargets(home = os.homedir()): SkillHostTarget[] {
  const targets: SkillHostTarget[] = []
  for (const host of SKILL_HOSTS) {
    const present = host.markers.filter((marker) => isDirectory(path.join(home, marker)))
    if (present.length === 0) continue
    const names = host.id === 'agents'
      ? host.names.filter((_, index) => present.includes(host.markers[index]!))
      : [...host.names]
    // Claude Code plugin installs already carry the Skill; a second copy would duplicate it.
    if (host.id === 'claude' && hasClaudePluginSkill(home)) continue
    targets.push({ id: host.id, names, path: path.join(home, ...host.skillsDir, 'shennian', 'SKILL.md') })
  }
  return targets
}

export async function installSkillForHosts(options: {
  clientVersion: string
  home?: string
  fetchImpl?: typeof fetch
  registryPath?: string
}): Promise<SkillHostInstallResult[]> {
  const results: SkillHostInstallResult[] = []
  for (const target of detectSkillHostTargets(options.home)) {
    try {
      const result = await installOfficialSkill(target.path, {
        clientVersion: options.clientVersion,
        fetchImpl: options.fetchImpl,
        registryPath: options.registryPath,
      })
      results.push({ ...target, ok: true, result })
    } catch (error) {
      results.push({ ...target, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

/** After a Client upgrade, check existing copies against the published official digest. */
export async function refreshExistingSkillForHosts(options: {
  clientVersion: string
  home?: string
  fetchImpl?: typeof fetch
  registryPath?: string
}): Promise<SkillHostInstallResult[]> {
  const results: SkillHostInstallResult[] = []
  for (const target of detectSkillHostTargets(options.home)) {
    if (!fs.existsSync(target.path)) continue
    try {
      const result = await updateOfficialSkill(target.path, {
        clientVersion: options.clientVersion,
        fetchImpl: options.fetchImpl,
        registryPath: options.registryPath,
      })
      results.push({ ...target, ok: true, result })
    } catch (error) {
      results.push({ ...target, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

/** Bounded search for `.../shennian/.../skills/shennian/SKILL.md` under ~/.claude/plugins. */
function hasClaudePluginSkill(home: string): boolean {
  const root = path.join(home, '.claude', 'plugins')
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = path.join(dir, entry.name)
      if (entry.name === 'skills' && fs.existsSync(path.join(child, 'shennian', 'SKILL.md'))) return true
      if (depth < 5) stack.push({ dir: child, depth: depth + 1 })
    }
  }
  return false
}
