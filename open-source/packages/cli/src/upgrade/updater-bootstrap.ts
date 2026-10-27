// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/updater-bootstrap.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { resolveShennianPath } from '../config/index.js'
import { UPDATER_PROTOCOL_VERSION } from './updater-protocol.js'

export type UpdaterReadiness = {
  protocolVersion: typeof UPDATER_PROTOCOL_VERSION
  workerPath: string
  installedAt: string
}

function atomicJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    const fd = fs.openSync(temp, process.platform === 'win32' ? 'r+' : 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, filePath)
  } finally {
    try { fs.unlinkSync(temp) } catch {}
  }
}

export function ensureUpdaterInstalled(options: {
  root?: string
  assetPath?: string
  now?: Date
} = {}): UpdaterReadiness {
  const root = options.root ?? resolveShennianPath('runtime', 'updater')
  const assetPath = options.assetPath ?? fileURLToPath(new URL('./updater-worker.js', import.meta.url))
  const source = fs.readFileSync(assetPath)
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
  const versionDir = path.join(root, 'versions', `${UPDATER_PROTOCOL_VERSION}-offline-${hash}`)
  fs.mkdirSync(versionDir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(versionDir, 0o700)
  // The copied worker no longer inherits the npm package's ESM scope.
  // Node 18 cannot infer ESM from .js; preserve it explicitly before launch.
  atomicJson(path.join(versionDir, 'package.json'), { type: 'module' })
  const workerPath = path.join(versionDir, 'updater-worker.js')
  const current = (() => {
    try { return fs.readFileSync(workerPath) } catch { return null }
  })()
  if (!current || !current.equals(source)) {
    const temp = `${workerPath}.tmp-${process.pid}-${randomUUID()}`
    try {
      fs.writeFileSync(temp, source, { mode: 0o700, flag: 'wx' })
      if (process.platform !== 'win32') fs.chmodSync(temp, 0o700)
      const fd = fs.openSync(temp, process.platform === 'win32' ? 'r+' : 'r')
      try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temp, workerPath)
    } finally {
      try { fs.unlinkSync(temp) } catch {}
    }
  }
  const readiness: UpdaterReadiness = {
    protocolVersion: UPDATER_PROTOCOL_VERSION,
    workerPath,
    installedAt: (options.now ?? new Date()).toISOString(),
  }
  atomicJson(path.join(root, 'current.json'), readiness)
  atomicJson(path.join(root, 'readiness.json'), {
    protocolVersion: readiness.protocolVersion,
    installedAt: readiness.installedAt,
  })
  return readiness
}

export function readUpdaterReadiness(root = resolveShennianPath('runtime', 'updater')): UpdaterReadiness | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8')) as UpdaterReadiness
    if (value.protocolVersion !== UPDATER_PROTOCOL_VERSION || !value.workerPath) return null
    const stat = fs.lstatSync(value.workerPath)
    if (stat.isSymbolicLink() || !stat.isFile()) return null
    return value
  } catch {
    return null
  }
}
