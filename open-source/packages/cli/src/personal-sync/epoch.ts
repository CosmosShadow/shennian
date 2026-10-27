// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-sync-epoch.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type PersonalSyncIdentity,
} from '@shennian/wire'
import { resolveShennianPath } from '../config/index.js'
import { getDaemonInstallationId } from './identity.js'
import {
  PERSONAL_SYNC_V1_ROOT_NAME,
  resolvePersonalSyncRootPath,
  resolvePersonalSyncV1Path,
} from './paths.js'

export const CLI_SESSION_SYNC_DATA_EPOCH = SESSION_SYNC_DATA_EPOCH

export type PersonalDataEpochMarker = {
  schemaVersion: 1
  dataEpoch: typeof CLI_SESSION_SYNC_DATA_EPOCH
  daemonInstallationId: string
  epochStartedAt: string
}

type MigrationMarker = {
  schemaVersion: 1
  targetEpoch: typeof CLI_SESSION_SYNC_DATA_EPOCH
  daemonInstallationId: string
  epochStartedAt: string
  phase: 'cleaning'
}

const LEGACY_PERSONAL_TARGETS = [
  'canonical',
  'session-index.json',
  'outbound-queue.json',
  'native-fusion-state.json',
  'native-fusion',
  'tool-details',
  'uploads',
  'attachment-staging',
  'deletion-barriers',
  'native-source-deletions.json',
  'native-session-cleanup-outbox.json',
  'deletion-sync-state.json',
] as const

export class FuturePersonalDataEpochError extends Error {
  readonly code = 'future_data_epoch'

  constructor(readonly foundEpoch: number) {
    super(`personal data epoch ${foundEpoch} is newer than supported epoch ${CLI_SESSION_SYNC_DATA_EPOCH}`)
    this.name = 'FuturePersonalDataEpochError'
  }
}

export function ensurePersonalDataEpoch(now = new Date()): PersonalDataEpochMarker {
  const installationId = getDaemonInstallationId()
  failClosedOnFutureEpoch()
  const current = readPersonalDataEpochMarker()
  if (current) return current

  const migrationFile = resolvePersonalSyncRootPath('migration.json')
  const migration = readOrCreateMigrationMarker(migrationFile, installationId, now)
  if (migration.daemonInstallationId !== installationId) {
    throw new Error('personal data epoch migration belongs to another daemon installation')
  }

  const legacyWorkDirs = collectLegacyPersonalWorkDirs()
  // Every target is exact and personal-only. Re-running after interruption is
  // safe and cannot touch config, pairing, Room state, or provider histories.
  fs.rmSync(resolvePersonalSyncV1Path(), { recursive: true, force: true })
  fs.rmSync(resolveShennianPath(PERSONAL_SYNC_V1_ROOT_NAME), { recursive: true, force: true })
  for (const target of LEGACY_PERSONAL_TARGETS) {
    fs.rmSync(resolveShennianPath(target), { recursive: true, force: true })
  }
  for (const workDir of legacyWorkDirs) {
    fs.rmSync(path.join(workDir, '.uploads', '.staging'), { recursive: true, force: true })
  }

  const marker: PersonalDataEpochMarker = {
    schemaVersion: 1,
    dataEpoch: CLI_SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: installationId,
    epochStartedAt: migration.epochStartedAt,
  }
  atomicWriteJson(path.join(resolvePersonalSyncV1Path(), 'epoch.json'), marker)
  fs.rmSync(migrationFile, { force: true })
  return marker
}

function collectLegacyPersonalWorkDirs(): Set<string> {
  const result = new Set<string>()
  const roots = [
    resolveShennianPath(PERSONAL_SYNC_V1_ROOT_NAME),
    resolvePersonalSyncV1Path(),
    resolveShennianPath(),
  ]
  const seen = new Set<string>()
  const inspectIndex = (file: string): void => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { workDir?: unknown }>
      for (const record of Object.values(parsed)) {
        if (typeof record?.workDir === 'string' && path.isAbsolute(record.workDir)) {
          result.add(path.resolve(record.workDir))
        }
      }
    } catch {
      // Corrupt legacy personal data is discarded by the hard cut below.
    }
  }
  const walk = (root: string, depth: number): void => {
    if (depth > 5 || seen.has(root) || !fs.existsSync(root)) return
    seen.add(root)
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const target = path.join(root, entry.name)
      if (entry.isFile() && entry.name === 'session-index.json') inspectIndex(target)
      else if (entry.isDirectory()) walk(target, depth + 1)
    }
  }
  // The broad Shennian root is inspected only for its direct legacy index;
  // recursive walking is restricted to known personal roots.
  inspectIndex(path.join(resolveShennianPath(), 'session-index.json'))
  walk(roots[0]!, 0)
  walk(roots[1]!, 0)
  return result
}

export function readPersonalDataEpochMarker(): PersonalDataEpochMarker | null {
  const file = path.join(resolvePersonalSyncV1Path(), 'epoch.json')
  if (!fs.existsSync(file)) return null
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PersonalDataEpochMarker
  if (
    parsed.schemaVersion !== 1
    || parsed.dataEpoch !== CLI_SESSION_SYNC_DATA_EPOCH
    || parsed.daemonInstallationId !== getDaemonInstallationId()
    || Number.isNaN(Date.parse(parsed.epochStartedAt))
  ) throw new Error('invalid personal data epoch marker')
  return parsed
}

export function getPersonalSyncIdentity(daemonInstallationId = getDaemonInstallationId()): PersonalSyncIdentity {
  return {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId,
  }
}

export function assertPersonalSyncIdentity(value: Partial<PersonalSyncIdentity>): void {
  const expected = getPersonalSyncIdentity()
  if (
    value.protocolVersion !== expected.protocolVersion
    || value.dataEpoch !== expected.dataEpoch
    || value.daemonInstallationId !== expected.daemonInstallationId
  ) throw new Error('personal_sync_identity_mismatch')
}

function failClosedOnFutureEpoch(): void {
  const root = resolvePersonalSyncRootPath()
  if (!fs.existsSync(root)) return
  const future = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((epoch) => Number.isSafeInteger(epoch) && epoch > CLI_SESSION_SYNC_DATA_EPOCH)
    .sort((left, right) => right - left)[0]
  if (future !== undefined) throw new FuturePersonalDataEpochError(future)
}

function readOrCreateMigrationMarker(
  file: string,
  installationId: string,
  now: Date,
): MigrationMarker {
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as MigrationMarker
    if (
      parsed.schemaVersion !== 1
      || parsed.targetEpoch !== CLI_SESSION_SYNC_DATA_EPOCH
      || parsed.phase !== 'cleaning'
      || !parsed.daemonInstallationId
      || Number.isNaN(Date.parse(parsed.epochStartedAt))
    ) throw new Error('invalid personal data epoch migration marker')
    return parsed
  }
  const marker: MigrationMarker = {
    schemaVersion: 1,
    targetEpoch: CLI_SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: installationId,
    epochStartedAt: now.toISOString(),
    phase: 'cleaning',
  }
  atomicWriteJson(file, marker)
  return marker
}

function atomicWriteJson(file: string, value: unknown): void {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    renameSyncWithRetry(temp, file)
    if (process.platform !== 'win32') {
      const directoryDescriptor = fs.openSync(directory, 'r')
      try { fs.fsyncSync(directoryDescriptor) } finally { fs.closeSync(directoryDescriptor) }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { fs.unlinkSync(temp) } catch {}
  }
}
