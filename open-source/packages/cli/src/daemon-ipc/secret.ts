// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-ipc.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { DaemonIpcError } from './protocol.js'

export function loadOrCreateDaemonIpcSecret(runtimeDirectory: string, secretFile: string): string {
  ensurePrivateRuntimeDirectory(runtimeDirectory)
  try {
    const stat = fs.lstatSync(secretFile)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new DaemonIpcError('unsafe_ipc_secret', 'Daemon IPC secret is not a regular file.')
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      fs.chmodSync(secretFile, 0o600)
    }
    const secret = fs.readFileSync(secretFile, 'utf8').trim()
    if (secret.length < 40 || secret.length > 128) {
      throw new DaemonIpcError('invalid_ipc_secret', 'Daemon IPC secret is invalid.')
    }
    return secret
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  const secret = crypto.randomBytes(32).toString('base64url')
  if (process.platform === 'win32') {
    try {
      fs.writeFileSync(secretFile, `${secret}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    return loadOrCreateDaemonIpcSecret(runtimeDirectory, secretFile)
  }
  const temp = `${secretFile}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  try {
    fs.writeFileSync(temp, `${secret}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fs.chmodSync(temp, 0o600)
    try {
      fs.linkSync(temp, secretFile)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
  } finally {
    try { fs.unlinkSync(temp) } catch {}
  }
  return loadOrCreateDaemonIpcSecret(runtimeDirectory, secretFile)
}

export function readDaemonIpcSecret(secretFile: string): string {
  const stat = fs.lstatSync(secretFile)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new DaemonIpcError('unsafe_ipc_secret', 'Daemon IPC secret is not a regular file.')
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new DaemonIpcError(
      'unsafe_ipc_secret_permissions',
      'Daemon IPC secret permissions are not private.',
    )
  }
  const secret = fs.readFileSync(secretFile, 'utf8').trim()
  if (secret.length < 40 || secret.length > 128) {
    throw new DaemonIpcError('invalid_ipc_secret', 'Daemon IPC secret is invalid.')
  }
  return secret
}

export function ensurePrivateRuntimeDirectory(runtimeDirectory: string): void {
  fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(runtimeDirectory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new DaemonIpcError('unsafe_runtime_directory', 'Daemon runtime path is not a directory.')
  }
  if (process.platform !== 'win32') fs.chmodSync(runtimeDirectory, 0o700)
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
