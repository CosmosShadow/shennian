// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/windows-shell.test.ts

import fs from 'node:fs'
import path from 'node:path'

function cleanEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolveWindowsSystemRoot(env: NodeJS.ProcessEnv = process.env): string {
  return cleanEnvValue(env.SystemRoot) ?? cleanEnvValue(env.WINDIR) ?? cleanEnvValue(env.windir) ?? 'C:\\Windows'
}

export function resolveWindowsPowerShellPath(input: {
  env?: NodeJS.ProcessEnv
  exists?: (filePath: string) => boolean
} = {}): string {
  const env = input.env ?? process.env
  const exists = input.exists ?? fs.existsSync
  const roots = [
    cleanEnvValue(env.SystemRoot),
    cleanEnvValue(env.WINDIR),
    cleanEnvValue(env.windir),
    'C:\\Windows',
  ].filter((root, index, all): root is string => !!root && all.indexOf(root) === index)

  const candidates = roots.map((root) =>
    path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  )
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return candidates[0] ?? 'powershell.exe'
}

export function buildWindowsSystemEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const systemRoot = resolveWindowsSystemRoot(env)
  return {
    SystemRoot: env.SystemRoot || systemRoot,
    WINDIR: env.WINDIR || systemRoot,
    ComSpec: env.ComSpec || path.win32.join(systemRoot, 'System32', 'cmd.exe'),
  }
}
