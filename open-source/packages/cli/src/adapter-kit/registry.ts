// @arch open-source/docs/cli-runtime.md
// 本地 Node Adapter 的检查缓存与注册表。独立于旧的 `customAgents`（神念
// Agent 协议 / `shennian runtime`），因为 V1 是一套新协议，不复用旧的
// caps 探测形状。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getShennianDir, resolveShennianPath } from '../config/index.js'

export type NodeAdapterCheckResult = {
  entrySha256: string
  checkedAt: string
  name: string
  version: string
  workDir: string
  models: string[]
  defaultModel: string
}

export type NodeAdapterRegistration = NodeAdapterCheckResult & {
  entryPath: string
  registeredAt: string
}

type RegistryFile = {
  /** Keyed by resolved absolute adapter.mjs path. */
  checks: Record<string, NodeAdapterCheckResult>
  /** Keyed by adapter name, i.e. the `custom:<name>` style local identity. */
  adapters: Record<string, NodeAdapterRegistration>
}

function getRegistryPath(): string {
  return resolveShennianPath('node-adapters.json')
}

function loadRegistry(): RegistryFile {
  try {
    const registryPath = getRegistryPath()
    if (!fs.existsSync(registryPath)) return { checks: {}, adapters: {} }
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as Partial<RegistryFile>
    return { checks: parsed.checks ?? {}, adapters: parsed.adapters ?? {} }
  } catch {
    return { checks: {}, adapters: {} }
  }
}

function saveRegistry(registry: RegistryFile): void {
  const directory = getShennianDir()
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
  fs.writeFileSync(getRegistryPath(), `${JSON.stringify(registry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function hashAdapterFile(entryPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex')
}

/** Persists a passing `adapter check` result, fingerprinted to the current file contents. */
export function recordPassedCheck(
  entryPath: string,
  result: Omit<NodeAdapterCheckResult, 'entrySha256' | 'checkedAt'>,
): NodeAdapterCheckResult {
  const registry = loadRegistry()
  const record: NodeAdapterCheckResult = {
    ...result,
    entrySha256: hashAdapterFile(entryPath),
    checkedAt: new Date().toISOString(),
  }
  registry.checks[path.resolve(entryPath)] = record
  saveRegistry(registry)
  return record
}

/**
 * Returns the last passing check for this exact file, or null if there is
 * none or the file has changed since. `add` must only accept adapters whose
 * fingerprint still matches what was actually checked.
 */
export function getPassedCheck(entryPath: string): NodeAdapterCheckResult | null {
  const resolved = path.resolve(entryPath)
  if (!fs.existsSync(resolved)) return null
  const record = loadRegistry().checks[resolved]
  if (!record) return null
  return record.entrySha256 === hashAdapterFile(resolved) ? record : null
}

export function registerNodeAdapter(name: string, entryPath: string, check: NodeAdapterCheckResult): NodeAdapterRegistration {
  const registry = loadRegistry()
  const registration: NodeAdapterRegistration = {
    ...check,
    entryPath: path.resolve(entryPath),
    registeredAt: new Date().toISOString(),
  }
  registry.adapters[name] = registration
  saveRegistry(registry)
  return registration
}

export function listNodeAdapters(): Record<string, NodeAdapterRegistration> {
  const registrations = loadRegistry().adapters
  return Object.fromEntries(
    Object.entries(registrations).filter(([, registration]) => registrationStillMatches(registration)),
  )
}

export function getNodeAdapter(name: string): NodeAdapterRegistration | null {
  const registration = loadRegistry().adapters[name]
  return registration && registrationStillMatches(registration) ? registration : null
}

export function removeNodeAdapter(name: string): boolean {
  const registry = loadRegistry()
  if (!registry.adapters[name]) return false
  delete registry.adapters[name]
  saveRegistry(registry)
  return true
}

function registrationStillMatches(registration: NodeAdapterRegistration): boolean {
  try {
    return fs.statSync(registration.entryPath, { throwIfNoEntry: false })?.isFile() === true &&
      hashAdapterFile(registration.entryPath) === registration.entrySha256
  } catch {
    return false
  }
}
