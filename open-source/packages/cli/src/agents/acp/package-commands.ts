// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-catalog.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SAFE_PACKAGE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i
const SAFE_COMMAND = /^[a-zA-Z0-9._-]{1,128}$/
let npmRoot: string | null | undefined

export function deriveInstalledPackageCommands(hints?: { npm?: string; uv?: string }): string[] {
  return [...new Set([
    ...readNpmBinNames(hints?.npm),
    ...readUvConsoleScripts(hints?.uv),
  ])]
}

function readNpmBinNames(packageName?: string): string[] {
  if (!packageName || !SAFE_PACKAGE.test(packageName)) return []
  npmRoot ??= resolveNpmRoot()
  if (!npmRoot) return []
  try {
    const file = path.join(npmRoot, ...packageName.split('/'), 'package.json')
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > 256 * 1024) return []
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { bin?: string | Record<string, string> }
    const inferred = packageName.split('/').at(-1) ?? ''
    const names = typeof json.bin === 'string' ? [inferred] : Object.keys(json.bin ?? {})
    return names.filter((name) => SAFE_COMMAND.test(name))
  } catch {
    return []
  }
}

function resolveNpmRoot(): string | null {
  const result = spawnSync('npm', ['root', '--global'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3_000, windowsHide: true,
  })
  const root = result.status === 0 ? result.stdout.trim() : ''
  return root && path.isAbsolute(root) ? root : null
}

function readUvConsoleScripts(packageName?: string): string[] {
  if (!packageName || !SAFE_PACKAGE.test(packageName)) return []
  const normalized = packageName.toLowerCase().replace(/[-_.]+/g, '-')
  const roots = [
    path.join(os.homedir(), '.local', 'share', 'uv', 'tools', normalized),
    path.join(os.homedir(), '.local', 'share', 'uv', 'tools', packageName),
  ]
  const commands: string[] = []
  for (const root of roots) {
    for (const file of findEntryPointFiles(root)) {
      try {
        const contents = fs.readFileSync(file, 'utf8')
        const section = contents.match(/\[console_scripts\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? ''
        for (const line of section.split(/\r?\n/)) {
          const name = line.split('=', 1)[0]?.trim() ?? ''
          if (SAFE_COMMAND.test(name)) commands.push(name)
        }
      } catch {}
    }
  }
  return commands
}

function findEntryPointFiles(root: string): string[] {
  const results: string[] = []
  let pythonDirs: string[] = []
  try { pythonDirs = fs.readdirSync(path.join(root, 'lib')).filter((name) => name.startsWith('python')).slice(0, 8) } catch {}
  for (const pythonDir of pythonDirs) {
    const sitePackages = path.join(root, 'lib', pythonDir, 'site-packages')
    let distInfos: string[] = []
    try { distInfos = fs.readdirSync(sitePackages).filter((name) => name.endsWith('.dist-info')).slice(0, 32) } catch {}
    for (const distInfo of distInfos) {
      const file = path.join(sitePackages, distInfo, 'entry_points.txt')
      try {
        if (fs.statSync(file).isFile() && fs.statSync(file).size <= 64 * 1024) results.push(file)
      } catch {}
    }
  }
  return results
}
