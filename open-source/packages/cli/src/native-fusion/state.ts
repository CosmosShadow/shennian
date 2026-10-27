// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-state.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { readPersonalDataEpochMarker } from '../personal-sync/epoch.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import { NATIVE_SCANNER_STATE_SCHEMA_VERSION, type NativeScannerState } from './types.js'

function stateFile(): string {
  return resolvePersonalSyncV1Path('native-fusion-state.json')
}

export function loadNativeScannerState(): NativeScannerState {
  const file = stateFile()
  const daemonInstallationId = getDaemonInstallationId()
  if (!fs.existsSync(file)) {
    const epochStartedAt = readPersonalDataEpochMarker()?.epochStartedAt
    const created: NativeScannerState = {
      schemaVersion: NATIVE_SCANNER_STATE_SCHEMA_VERSION,
      fusionEpochMs: epochStartedAt ? Date.parse(epochStartedAt) : Date.now(),
      daemonInstallationId,
      files: {},
    }
    atomicWriteJson(file, created)
    return created
  }

  let parsed: NativeScannerState
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as NativeScannerState
  } catch (cause) {
    throw new Error(`native fusion v1 state is unreadable: ${file}`, { cause })
  }
  validateNativeScannerState(parsed, daemonInstallationId)
  return parsed
}

export function saveNativeScannerState(state: NativeScannerState): void {
  const daemonInstallationId = getDaemonInstallationId()
  validateNativeScannerState(state, daemonInstallationId)
  const file = stateFile()
  if (fs.existsSync(file)) {
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8')) as NativeScannerState
    validateNativeScannerState(persisted, daemonInstallationId)
    if (persisted.fusionEpochMs !== state.fusionEpochMs) {
      throw new Error('native fusion epoch is immutable')
    }
    // A scan yields between files/batches. Never erase a registration made
    // before another managed thread's first turn while this snapshot was held.
    state.ignoredSources = { ...state.ignoredSources, ...persisted.ignoredSources }
    for (const [key, owner] of Object.entries(persisted.internalSourceOwners ?? {})) {
      const incoming = state.internalSourceOwners?.[key]
      if (incoming && incoming.sessionId !== owner.sessionId) {
        throw new Error('internal_native_source_owner_conflict')
      }
    }
    state.internalSourceOwners = { ...state.internalSourceOwners, ...persisted.internalSourceOwners }
  }
  atomicWriteJson(file, state)
}

export function validateNativeScannerState(state: NativeScannerState, daemonInstallationId: string): void {
  if (
    !state
    || state.schemaVersion !== NATIVE_SCANNER_STATE_SCHEMA_VERSION
    || !Number.isSafeInteger(state.fusionEpochMs)
    || state.fusionEpochMs <= 0
    || state.daemonInstallationId !== daemonInstallationId
    || !state.files
    || typeof state.files !== 'object'
    || Array.isArray(state.files)
    || (state.ignoredSources !== undefined && (
      typeof state.ignoredSources !== 'object'
      || state.ignoredSources === null
      || Array.isArray(state.ignoredSources)
      || Object.entries(state.ignoredSources).some(([key, value]) => !key || value !== true)
    ))
  ) {
    throw new Error('invalid native fusion v1 state')
  }
  if (state.internalSourceOwners !== undefined && (
    !state.internalSourceOwners || typeof state.internalSourceOwners !== 'object'
    || Array.isArray(state.internalSourceOwners)
    || Object.entries(state.internalSourceOwners).some(([key, owner]) => (
      !/^(codex|claude|opencode):.+$/.test(key)
      || !owner || typeof owner.sessionId !== 'string' || !owner.sessionId
      || typeof owner.registeredAt !== 'string' || !Number.isFinite(Date.parse(owner.registeredAt))
    ))
  )) throw new Error('invalid internal native source ownership')
  for (const cursor of Object.values(state.files)) {
    if (cursor.daemonInstallationId !== daemonInstallationId) {
      throw new Error('native fusion cursor belongs to another daemon installation')
    }
    if (cursor.sources !== undefined && (
      !Array.isArray(cursor.sources)
      || cursor.sources.some((source) => (
        !source
        || !['codex', 'claude', 'opencode'].includes(source.agentType)
        || typeof source.sourceSessionKey !== 'string'
        || !source.sourceSessionKey
      ))
    )) {
      throw new Error('native fusion cursor has invalid source metadata')
    }
  }
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
