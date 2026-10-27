// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/fs-boundary.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:([\\/]|$)/
const WINDOWS_UNC_RE = /^\\\\[^\\]+\\[^\\]+/
const WINDOWS_DRIVE_RELATIVE_RE = /^[A-Za-z]:(?![\\/])/

export type FsPathFlavor = 'win32' | 'posix'

export type AuthorizedFsRoot = {
  raw: string
  normalized: string
  boundary: string
  real: string | null
  flavor: FsPathFlavor
  file: boolean
}

export type ResolveAuthorizedPathResult =
  | { ok: true; path: string; root: AuthorizedFsRoot }
  | { ok: false; error: string }

function isWindowsAbsolutePath(input: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(input) || WINDOWS_UNC_RE.test(input)
}

function hasWindowsDriveRelativePrefix(input: string): boolean {
  return WINDOWS_DRIVE_RELATIVE_RE.test(input)
}

function normalizeWindowsAbsolutePath(input: string): string {
  return input.replace(/^[/\\]([A-Za-z]:[\\/].*)$/, '$1')
}

function isHomeRelativePath(input: string): boolean {
  return input === '~' || input.startsWith('~/') || input.startsWith('~\\')
}

function pathFlavor(input: string): FsPathFlavor {
  return isWindowsAbsolutePath(normalizeWindowsAbsolutePath(input)) ? 'win32' : 'posix'
}

function pathApi(flavor: FsPathFlavor): typeof path.win32 | typeof path.posix {
  return flavor === 'win32' ? path.win32 : path.posix
}

function normalizeForCompare(input: string, flavor: FsPathFlavor): string {
  const api = pathApi(flavor)
  const normalized = api.normalize(input)
  const trimmed = normalized.length > api.parse(normalized).root.length
    ? normalized.replace(/[\\/]+$/, '')
    : normalized
  return flavor === 'win32' ? trimmed.toLowerCase() : trimmed
}

function isWithinOrEqual(candidate: string, root: string, flavor: FsPathFlavor): boolean {
  const api = pathApi(flavor)
  const normalizedCandidate = normalizeForCompare(candidate, flavor)
  const normalizedRoot = normalizeForCompare(root, flavor)
  if (normalizedCandidate === normalizedRoot) return true
  const relative = api.relative(normalizedRoot, normalizedCandidate)
  return Boolean(relative) && !relative.startsWith('..') && !api.isAbsolute(relative)
}

function safeRealpath(pathValue: string): string | null {
  try {
    return fs.realpathSync.native(pathValue)
  } catch {
    return null
  }
}

async function safeRealpathAsync(pathValue: string): Promise<string | null> {
  try {
    return await fs.promises.realpath(pathValue)
  } catch {
    return null
  }
}

export function resolveSessionWorkDir(input: string): string {
  if (!input) return os.homedir()
  const normalizedInput = normalizeWindowsAbsolutePath(input)
  const flavor = pathFlavor(normalizedInput)
  const api = pathApi(flavor)

  if (isHomeRelativePath(normalizedInput)) {
    return path.join(os.homedir(), normalizedInput.slice(1).replace(/^[/\\]+/, ''))
  }

  if (process.platform === 'win32') {
    const normalized = normalizedInput.replace(/\\/g, '/')
    if (normalized === '/tmp' || normalized.startsWith('/tmp/')) {
      const suffix = normalized.slice('/tmp'.length).replace(/^\/+/, '')
      return suffix ? path.win32.join(os.tmpdir(), ...suffix.split('/')) : os.tmpdir()
    }
  }

  if (isWindowsAbsolutePath(normalizedInput)) {
    return path.win32.resolve(normalizedInput)
  }

  return api.resolve(normalizedInput)
}

export function createAuthorizedFsRoot(rawRoot: string): AuthorizedFsRoot {
  const normalized = resolveSessionWorkDir(rawRoot)
  const flavor = pathFlavor(normalized)
  const stat = safeStat(normalized)
  const file = typeof stat?.isFile === 'function' ? stat.isFile() : false
  const boundary = file ? pathApi(flavor).dirname(normalized) : normalized
  return {
    raw: rawRoot,
    normalized,
    boundary,
    real: safeRealpath(boundary),
    flavor,
    file,
  }
}

export async function createAuthorizedFsRootAsync(rawRoot: string): Promise<AuthorizedFsRoot> {
  const normalized = resolveSessionWorkDir(rawRoot)
  const flavor = pathFlavor(normalized)
  const stat = await safeStatAsync(normalized)
  const file = typeof stat?.isFile === 'function' ? stat.isFile() : false
  const boundary = file ? pathApi(flavor).dirname(normalized) : normalized
  return {
    raw: rawRoot,
    normalized,
    boundary,
    real: await safeRealpathAsync(boundary),
    flavor,
    file,
  }
}

export function resolveAuthorizedPath(rawPath: string, root: AuthorizedFsRoot): ResolveAuthorizedPathResult {
  const input = String(rawPath || '').trim() || root.normalized
  const normalizedInput = isHomeRelativePath(input)
    ? resolveSessionWorkDir(input)
    : normalizeWindowsAbsolutePath(input)
  const api = pathApi(root.flavor)

  if (hasWindowsDriveRelativePrefix(normalizedInput)) {
    return { ok: false, error: `Access denied: ${rawPath}` }
  }

  const candidate = api.isAbsolute(normalizedInput)
    ? api.resolve(normalizedInput)
    : api.resolve(root.boundary, normalizedInput)

  if (!isWithinOrEqual(candidate, root.boundary, root.flavor)) {
    return { ok: false, error: `Access denied: ${rawPath}` }
  }

  if (root.file && normalizeForCompare(candidate, root.flavor) !== normalizeForCompare(root.normalized, root.flavor)) {
    return { ok: false, error: `Access denied: ${rawPath}` }
  }

  const realCandidate = safeRealpath(candidate)
  if (realCandidate) {
    const realRoot = root.real ?? safeRealpath(root.boundary)
    if (realRoot && !isWithinOrEqual(realCandidate, realRoot, pathFlavor(realRoot))) {
      return { ok: false, error: `Access denied: ${rawPath}` }
    }
  }

  return { ok: true, path: candidate, root }
}

export async function resolveAuthorizedPathAsync(
  rawPath: string,
  root: AuthorizedFsRoot,
): Promise<ResolveAuthorizedPathResult> {
  const input = String(rawPath || '').trim() || root.normalized
  const normalizedInput = isHomeRelativePath(input)
    ? resolveSessionWorkDir(input)
    : normalizeWindowsAbsolutePath(input)
  const api = pathApi(root.flavor)

  if (hasWindowsDriveRelativePrefix(normalizedInput)) {
    return { ok: false, error: `Access denied: ${rawPath}` }
  }

  const candidate = api.isAbsolute(normalizedInput)
    ? api.resolve(normalizedInput)
    : api.resolve(root.boundary, normalizedInput)

  if (!isWithinOrEqual(candidate, root.boundary, root.flavor)) {
    return { ok: false, error: `Access denied: ${rawPath}` }
  }

  if (
    root.file
    && normalizeForCompare(candidate, root.flavor) !== normalizeForCompare(root.normalized, root.flavor)
  ) {
    return { ok: false, error: `Access denied: ${rawPath}` }
  }

  const realCandidate = await safeRealpathAsync(candidate)
  if (realCandidate) {
    const realRoot = root.real ?? await safeRealpathAsync(root.boundary)
    if (realRoot && !isWithinOrEqual(realCandidate, realRoot, pathFlavor(realRoot))) {
      return { ok: false, error: `Access denied: ${rawPath}` }
    }
  }

  return { ok: true, path: candidate, root }
}

export function isAuthorizedRootPath(pathValue: string, root: AuthorizedFsRoot): boolean {
  return isWithinOrEqual(pathValue, root.boundary, root.flavor) &&
    normalizeForCompare(pathValue, root.flavor) === normalizeForCompare(root.boundary, root.flavor)
}

function safeStat(pathValue: string): fs.Stats | null {
  try {
    return fs.statSync(pathValue)
  } catch {
    return null
  }
}

async function safeStatAsync(pathValue: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(pathValue)
  } catch {
    return null
  }
}
