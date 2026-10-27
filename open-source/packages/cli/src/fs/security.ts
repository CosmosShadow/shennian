import path from 'node:path'
import os from 'node:os'

const FILE_SYSTEM_ROOTS_PATH = '__roots__'
const ALLOWED_ROOTS: string[] = [os.homedir()]

const BLOCKED_PATTERNS = [
  /\.\./, // directory traversal
  /\/\.ssh\//,
  /\/\.gnupg\//,
  /\/\.aws\/credentials/,
  /\/\.env$/,
  /\/\.env\./,
]

export function normalizePath(inputPath: string): string {
  if (inputPath === FILE_SYSTEM_ROOTS_PATH) return inputPath
  const expanded = inputPath.startsWith('~')
    ? path.join(os.homedir(), inputPath.slice(1))
    : inputPath
  return path.resolve(expanded)
}

export function isPathSafe(normalizedPath: string): boolean {
  if (normalizedPath === FILE_SYSTEM_ROOTS_PATH) return true
  const withinAllowed = ALLOWED_ROOTS.some(
    (root) => normalizedPath === root || normalizedPath.startsWith(root + path.sep),
  )
  if (!withinAllowed) return false

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalizedPath)) return false
  }

  return true
}
