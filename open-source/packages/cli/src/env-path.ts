import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_POSIX_PATH = '/usr/local/bin:/usr/bin:/bin'

function uniquePush(parts: string[], value: string, front = false): void {
  if (!value || parts.includes(value)) return
  if (front) parts.unshift(value)
  else parts.push(value)
}

export function getUserBinPathCandidates(input: {
  env?: NodeJS.ProcessEnv
  homedir?: string
  exists?: (filePath: string) => boolean
  readdir?: (filePath: string) => string[]
  platform?: NodeJS.Platform
} = {}): string[] {
  const env = input.env ?? process.env
  const home = input.homedir ?? os.homedir()
  const exists = input.exists ?? fs.existsSync
  const readdir = input.readdir ?? ((filePath: string) => fs.readdirSync(filePath))
  const platform = input.platform ?? process.platform
  const candidates: string[] = []

  if (platform === 'win32') {
    const winPath = path.win32
    const appData = env.APPDATA?.trim() || winPath.join(home, 'AppData', 'Roaming')
    const localAppData = env.LOCALAPPDATA?.trim() || winPath.join(home, 'AppData', 'Local')
    const systemRoot = env.SystemRoot?.trim() || env.WINDIR?.trim() || env.windir?.trim() || winPath.join('C:\\', 'Windows')
    uniquePush(candidates, winPath.join(home, '.shennian', 'node'))
    uniquePush(candidates, path.win32.join(systemRoot, 'System32'))
    uniquePush(candidates, path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'))
    uniquePush(candidates, path.win32.join(systemRoot))
    uniquePush(candidates, winPath.join(appData, 'npm'))
    uniquePush(candidates, winPath.join(localAppData, 'pnpm'))
    uniquePush(candidates, winPath.join(home, 'scoop', 'shims'))
    uniquePush(candidates, winPath.join('C:\\', 'Program Files', 'nodejs'))
    return candidates
  }

  uniquePush(candidates, path.join(home, '.local', 'bin'))
  uniquePush(candidates, path.join(home, '.bun', 'bin'))
  uniquePush(candidates, path.join(home, '.npm-global', 'bin'))
  uniquePush(candidates, path.join(home, '.npm', 'bin'))
  uniquePush(candidates, path.join(home, '.cargo', 'bin'))
  uniquePush(candidates, path.join(home, '.maestro', 'bin'))

  const nvmDir = env.NVM_DIR?.trim() || path.join(home, '.nvm')
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node')
  try {
    const nvmBins = readdir(nvmVersionsDir)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => path.join(nvmVersionsDir, version, 'bin'))
      .filter((candidate) => exists(candidate))
    for (const candidate of nvmBins) uniquePush(candidates, candidate)
  } catch {
    // nvm is optional.
  }

  uniquePush(candidates, '/opt/homebrew/bin')
  uniquePush(candidates, '/usr/local/bin')
  uniquePush(candidates, '/usr/bin')
  uniquePush(candidates, '/bin')
  uniquePush(candidates, '/usr/sbin')
  uniquePush(candidates, '/sbin')

  return candidates
}

export function buildAugmentedPath(input: {
  pathValue?: string
  env?: NodeJS.ProcessEnv
  homedir?: string
  exists?: (filePath: string) => boolean
  readdir?: (filePath: string) => string[]
} = {}): string {
  const basePath = input.pathValue ?? input.env?.PATH ?? process.env.PATH ?? DEFAULT_POSIX_PATH
  const parts = basePath.split(path.delimiter).filter(Boolean)
  for (const candidate of getUserBinPathCandidates(input)) uniquePush(parts, candidate)
  return parts.join(path.delimiter)
}

export function augmentProcessPath(): void {
  process.env.PATH = buildAugmentedPath()
}
