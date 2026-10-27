// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-store.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { resolveShennianPath } from '../config/index.js'
import { resolvePersonalSyncV1RootPath } from './paths.js'

type InstallationIdentity = {
  schemaVersion: 1
  daemonInstallationId: string
  createdAt: string
}

export function getDaemonInstallationId(): string {
  // This identity belongs to the physical data root, not to one account.
  const file = resolveShennianPath('installation.json')
  if (fs.existsSync(file)) {
    const identity = JSON.parse(fs.readFileSync(file, 'utf8')) as InstallationIdentity
    if (identity.schemaVersion !== 1 || !identity.daemonInstallationId) {
      throw new Error(`invalid daemon installation identity: ${file}`)
    }
    return identity.daemonInstallationId
  }
  const legacyFile = path.join(resolvePersonalSyncV1RootPath(), 'installation.json')
  if (fs.existsSync(legacyFile)) {
    const identity = JSON.parse(fs.readFileSync(legacyFile, 'utf8')) as InstallationIdentity
    if (identity.schemaVersion !== 1 || !identity.daemonInstallationId) {
      throw new Error(`invalid daemon installation identity: ${legacyFile}`)
    }
    atomicWriteJson(file, identity)
    return identity.daemonInstallationId
  }
  const identity: InstallationIdentity = {
    schemaVersion: 1,
    daemonInstallationId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  atomicWriteJson(file, identity)
  return identity.daemonInstallationId
}

function atomicWriteJson(file: string, value: unknown): void {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  let fd: number | undefined
  try {
    fd = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    renameSyncWithRetry(temp, file)
    if (process.platform !== 'win32') {
      const directoryFd = fs.openSync(directory, 'r')
      try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(temp) } catch {}
  }
}
