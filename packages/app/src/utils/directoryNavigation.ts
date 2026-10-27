// @arch docs/architecture/app/modular-features.md

export const FILE_SYSTEM_ROOTS_PATH = '__roots__'

function trimTrailingSeparators(pathValue: string): string {
  if (!pathValue) return ''
  if (pathValue === '/' || pathValue === '\\') return pathValue
  return pathValue.replace(/[\\/]+$/, '')
}

function getSeparator(pathValue: string): '/' | '\\' {
  return pathValue.includes('\\') ? '\\' : '/'
}

export function canGoUp(pathValue: string): boolean {
  return canGoUpWithinRoot(pathValue, '')
}

export function canGoUpWithinRoot(pathValue: string, rootPath: string): boolean {
  const normalized = trimTrailingSeparators(pathValue.trim())
  const normalizedRoot = trimTrailingSeparators(rootPath.trim())
  if (normalized === FILE_SYSTEM_ROOTS_PATH) return false
  if (normalizedRoot && equalPath(normalized, normalizedRoot)) return false
  if (!normalized || normalized === '/' || normalized === '\\') return false
  if (/^[A-Za-z]:$/.test(normalized)) return true
  return /[\\/]/.test(normalized)
}

export function getParentDirectoryPath(pathValue: string): string {
  return getParentDirectoryPathWithinRoot(pathValue, '')
}

export function getParentDirectoryPathWithinRoot(pathValue: string, rootPath: string): string {
  const normalized = trimTrailingSeparators(pathValue.trim())
  const normalizedRoot = trimTrailingSeparators(rootPath.trim())
  if (normalized === FILE_SYSTEM_ROOTS_PATH) return FILE_SYSTEM_ROOTS_PATH
  if (normalizedRoot && equalPath(normalized, normalizedRoot)) return normalizedRoot
  if (!normalized) return '/'
  if (normalized === '/' || normalized === '\\') return normalized
  if (/^[A-Za-z]:$/.test(normalized)) return FILE_SYSTEM_ROOTS_PATH

  const separator = getSeparator(normalized)
  const match = normalized.match(/^(.*)[\\/][^\\/]+$/)
  if (!match) return separator

  const parent = match[1]
  if (!parent) return separator
  const parentPath = /^[A-Za-z]:$/.test(parent) ? parent + separator : parent
  if (normalizedRoot && !isPathWithinOrEqual(parentPath, normalizedRoot)) return normalizedRoot
  if (/^[A-Za-z]:$/.test(parent)) return parentPath
  return parentPath
}

function equalPath(left: string, right: string): boolean {
  const leftWindows = /^[A-Za-z]:/.test(left)
  const rightWindows = /^[A-Za-z]:/.test(right)
  const normalize = (value: string) => (leftWindows || rightWindows ? value.replace(/\//g, '\\').toLowerCase() : value)
  return normalize(left) === normalize(right)
}

function isPathWithinOrEqual(pathValue: string, rootPath: string): boolean {
  const pathWindows = /^[A-Za-z]:/.test(pathValue)
  const rootWindows = /^[A-Za-z]:/.test(rootPath)
  const normalize = (value: string) => {
    let next = trimTrailingSeparators(value)
    if (pathWindows || rootWindows) next = next.replace(/\//g, '\\').toLowerCase()
    return next
  }
  const normalizedPath = normalize(pathValue)
  const normalizedRoot = normalize(rootPath)
  const separator = pathWindows || rootWindows ? '\\' : '/'
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + separator)
}
