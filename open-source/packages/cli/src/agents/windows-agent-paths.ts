// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/command-spec.test.ts
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildWindowsSystemEnv, resolveWindowsPowerShellPath } from '../windows-shell.js'

type WindowsInstallationPaths = { path: string; codexRoots: string[] }
let cached: WindowsInstallationPaths | undefined

export function resetWindowsInstallationPaths(): void { cached = undefined }

/** Only PATH and current-user package locations; never enumerate credentials or other users. */
export function readWindowsInstallationPaths(): WindowsInstallationPaths {
  if (cached) return cached
  cached = { path: '', codexRoots: [] }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    "$paths = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'))",
    '$roots = @()',
    "try { $roots = @(Get-AppxPackage -Name '*Codex*' -ErrorAction Stop | Where-Object { $_.Name -eq 'OpenAI.Codex' } | Sort-Object InstallLocation | Select-Object -ExpandProperty InstallLocation) } catch {}",
    "@{ path = ($paths -join ';'); codexRoots = @($roots) } | ConvertTo-Json -Compress",
  ].join('; ')
  try {
    const result = spawnSync(resolveWindowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, ...buildWindowsSystemEnv() },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
      maxBuffer: 64 * 1024, windowsHide: true,
    })
    if (result.status !== 0 || typeof result.stdout !== 'string') return cached
    const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '')) as Record<string, unknown>
    cached = {
      path: typeof value.path === 'string' ? value.path : '',
      codexRoots: Array.isArray(value.codexRoots)
        ? value.codexRoots.filter((root): root is string => typeof root === 'string' && path.win32.isAbsolute(root))
        : [],
    }
  } catch { /* Optional OS discovery must not prevent daemon startup. */ }
  return cached
}

export function windowsLookupPath(): string {
  const inherited = process.env.PATH ?? process.env.Path ?? ''
  const parts = [...inherited.split(';'), ...readWindowsInstallationPaths().path.split(';')]
  const seen = new Set<string>()
  return parts.map((value) => value.trim().replace(/^"(.*)"$/, '$1')).filter((value) => {
    if (!value || seen.has(value.toLowerCase())) return false
    seen.add(value.toLowerCase())
    return true
  }).join(';')
}

/**
 * Codex Desktop keeps a runnable per-user CLI copy at %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe.
 * Unlike the copy inside the Store package (which other processes cannot launch), this one can be spawned.
 * Newest directory first; identity is still verified with `--version`, never inferred from the folder.
 */
function codexDesktopProvisionedCandidates(local: string): string[] {
  const bin = path.win32.join(local, 'OpenAI', 'Codex', 'bin')
  try {
    return fs.readdirSync(bin, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.win32.join(bin, entry.name))
      .map((dir) => ({ dir, modified: fs.statSync(dir).mtimeMs }))
      .sort((a, b) => b.modified - a.modified)
      .map(({ dir }) => path.win32.join(dir, 'codex.exe'))
  } catch { return [] }
}

export function windowsCodexDesktopCandidates(home = os.homedir()): string[] {
  const local = process.env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
  const roots = [
    ...readWindowsInstallationPaths().codexRoots,
    path.win32.join(local, 'Programs', 'Codex'),
    path.win32.join(local, 'Codex'),
  ]
  // These are candidates, not proof that a Store package exposes a CLI.
  return [...codexDesktopProvisionedCandidates(local), ...roots.flatMap((root) => [
    path.win32.join(root, 'app', 'resources', 'codex.exe'),
    path.win32.join(root, 'resources', 'codex.exe'),
  ])]
}
