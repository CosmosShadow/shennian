// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-capabilities.test.ts

import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentCapabilityProvider,
  AgentCapabilitySource,
  AgentNativeCapability,
} from '@shennian/wire'

type DiscoveryOptions = {
  agentType: string
  workDir: string
  homeDir?: string
  platform?: NodeJS.Platform
}

type Candidate = AgentNativeCapability & { priority: number }

const SUPPORTED_PROVIDERS = new Set<AgentCapabilityProvider>(['codex', 'claude', 'workbuddy'])

export function isNativeCapabilityProvider(value: string): value is AgentCapabilityProvider {
  return SUPPORTED_PROVIDERS.has(value as AgentCapabilityProvider)
}

export function listAgentNativeCapabilities(options: DiscoveryOptions): AgentNativeCapability[] {
  if (!isNativeCapabilityProvider(options.agentType)) return []
  const homeDir = path.resolve(options.homeDir ?? os.homedir())
  const workDir = path.resolve(options.workDir || homeDir)
  const candidates: Candidate[] = []

  if (options.agentType === 'codex') {
    for (const root of ancestorRoots(workDir)) {
      collectSkillDirectory(candidates, path.join(root, '.agents', 'skills'), {
        provider: 'codex', source: 'project', priority: 0, invocationPrefix: '$', maxDepth: 2,
      })
    }
    collectSkillDirectory(candidates, path.join(homeDir, '.agents', 'skills'), {
      provider: 'codex', source: 'personal', priority: 1, invocationPrefix: '$', maxDepth: 2,
    })
    // Current Codex hosts also expose built-in and locally installed skills here.
    collectSkillDirectory(candidates, path.join(homeDir, '.codex', 'skills'), {
      provider: 'codex', source: 'personal', priority: 1, invocationPrefix: '$', maxDepth: 3,
      systemSegment: '.system',
    })
    collectSkillDirectory(candidates, '/etc/codex/skills', {
      provider: 'codex', source: 'system', priority: 3, invocationPrefix: '$', maxDepth: 2,
    })
    if (!options.homeDir) collectCodexPluginSkills(candidates)
  } else {
    const configFolder = options.agentType === 'claude' ? '.claude' : '.codebuddy'
    for (const root of ancestorRoots(workDir)) {
      collectSkillDirectory(candidates, path.join(root, configFolder, 'skills'), {
        provider: options.agentType, source: 'project', priority: 0, invocationPrefix: '/', maxDepth: 3,
      })
    }
    collectSkillDirectory(candidates, path.join(homeDir, configFolder, 'skills'), {
      provider: options.agentType, source: 'personal', priority: 1, invocationPrefix: '/', maxDepth: 3,
    })
    collectInstalledPluginSkills(candidates, {
      provider: options.agentType,
      homeDir,
      configFolder,
    })
  }

  const deduped = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const current = deduped.get(candidate.invocation)
    if (!current || candidate.priority < current.priority) deduped.set(candidate.invocation, candidate)
  }
  return [...deduped.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.invocation.localeCompare(b.invocation))
    .map(({ priority: _priority, ...capability }) => capability)
}

function collectCodexPluginSkills(target: Candidate[]): void {
  try {
    const output = execFileSync('codex', ['plugin', 'list', '--json'], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const parsed = JSON.parse(output) as {
      installed?: Array<{
        name?: unknown
        installed?: unknown
        enabled?: unknown
        source?: { path?: unknown }
      }>
    }
    for (const plugin of parsed.installed ?? []) {
      const pluginName = typeof plugin.name === 'string' ? plugin.name.trim() : ''
      const installPath = typeof plugin.source?.path === 'string' ? plugin.source.path : ''
      if (!pluginName || !/^[a-zA-Z0-9._-]+$/.test(pluginName) || !installPath) continue
      if (plugin.installed !== true || plugin.enabled !== true) continue
      collectSkillDirectory(target, path.resolve(installPath), {
        provider: 'codex',
        source: 'plugin',
        priority: 2,
        invocationPrefix: '$',
        pluginName,
        maxDepth: 4,
      })
    }
  } catch {
    // Codex versions without the plugin JSON command still expose filesystem skills.
  }
}

function ancestorRoots(start: string): string[] {
  const roots: string[] = []
  let current = start
  for (let count = 0; count < 64; count += 1) {
    roots.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return roots
}

function collectSkillDirectory(
  target: Candidate[],
  root: string,
  options: {
    provider: AgentCapabilityProvider
    source: AgentCapabilitySource
    priority: number
    invocationPrefix: '$' | '/'
    maxDepth: number
    pluginName?: string
    systemSegment?: string
  },
): void {
  if (!isRealDirectory(root)) return
  walkSkillFiles(root, options.maxDepth, (skillFile) => {
    const metadata = readSkillMetadata(skillFile)
    if (!metadata) return
    const relative = path.relative(root, skillFile).split(path.sep)
    const source = options.systemSegment && relative.includes(options.systemSegment)
      ? 'system'
      : options.source
    const invocation = options.pluginName
      ? `${options.invocationPrefix}${options.pluginName}:${metadata.name}`
      : `${options.invocationPrefix}${metadata.name}`
    target.push({
      id: stableCapabilityId(options.provider, invocation, skillFile),
      name: metadata.name,
      description: metadata.description,
      kind: options.pluginName ? 'plugin_skill' : 'skill',
      source,
      invocation,
      priority: options.priority,
    })
  })
}

function collectInstalledPluginSkills(
  target: Candidate[],
  options: { provider: 'claude' | 'workbuddy'; homeDir: string; configFolder: string },
): void {
  const pluginRoot = path.join(options.homeDir, options.configFolder, 'plugins')
  const manifestPath = path.join(pluginRoot, 'installed_plugins.json')
  if (!isRealFile(manifestPath)) return
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { plugins?: Record<string, unknown> }
    for (const [qualifiedName, rawInstallations] of Object.entries(parsed.plugins ?? {})) {
      const pluginName = qualifiedName.split('@')[0]?.trim()
      if (!pluginName || !/^[a-zA-Z0-9._-]+$/.test(pluginName)) continue
      const installations = Array.isArray(rawInstallations) ? rawInstallations : [rawInstallations]
      for (const raw of installations) {
        const installPath = raw && typeof raw === 'object' && 'installPath' in raw
          ? String((raw as { installPath?: unknown }).installPath ?? '')
          : ''
        if (!installPath) continue
        const resolved = path.resolve(installPath)
        if (!isWithinRoot(resolved, pluginRoot)) continue
        collectSkillDirectory(target, resolved, {
          provider: options.provider,
          source: 'plugin',
          priority: 2,
          invocationPrefix: '/',
          pluginName,
          maxDepth: 4,
        })
      }
    }
  } catch {
    // A malformed third-party plugin registry must not break ordinary chat.
  }
}

function walkSkillFiles(root: string, maxDepth: number, visit: (file: string) => void): void {
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < 2_000) {
    const item = queue.shift()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(item.directory, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      visited += 1
      if (visited >= 2_000) break
      const fullPath = path.join(item.directory, entry.name)
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name === 'SKILL.md') visit(fullPath)
      if (entry.isDirectory() && !entry.isSymbolicLink() && item.depth < maxDepth) {
        queue.push({ directory: fullPath, depth: item.depth + 1 })
      }
    }
  }
}

function readSkillMetadata(skillFile: string): { name: string; description?: string } | null {
  try {
    const content = fs.readFileSync(skillFile, 'utf8').slice(0, 64 * 1024)
    const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/)?.[1] ?? ''
    const name = readFrontmatterScalar(frontmatter, 'name') || path.basename(path.dirname(skillFile))
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null
    const description = readFrontmatterScalar(frontmatter, 'description')
    return { name, ...(description ? { description } : {}) }
  } catch {
    return null
  }
}

function readFrontmatterScalar(frontmatter: string, key: string): string {
  const line = frontmatter.split(/\r?\n/).find((value) => value.startsWith(`${key}:`))
  if (!line) return ''
  const value = line.slice(key.length + 1).trim()
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2').trim()
}

function stableCapabilityId(provider: string, invocation: string, skillFile: string): string {
  return crypto.createHash('sha256').update(`${provider}\0${invocation}\0${skillFile}`).digest('hex').slice(0, 20)
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function isRealDirectory(value: string): boolean {
  try { const stat = fs.lstatSync(value); return stat.isDirectory() && !stat.isSymbolicLink() } catch { return false }
}

function isRealFile(value: string): boolean {
  try { const stat = fs.lstatSync(value); return stat.isFile() && !stat.isSymbolicLink() } catch { return false }
}
