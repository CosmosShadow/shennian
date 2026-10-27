import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FsEntry, FsTransferRequest, FsChunk } from '@shennian/wire'
import { normalizePath, isPathSafe } from './security.js'

const FILE_SYSTEM_ROOTS_PATH = '__roots__'
const MAX_READ_SIZE = 100 * 1024
const MAX_TRANSFER_SIZE = 20 * 1024 * 1024
const CHUNK_SIZE = 64 * 1024
const RATE_LIMIT_BYTES_PER_SEC = 5 * 1024 * 1024

export type TransferProgress = {
  transferId: string
  seq: number
  total: number
  bytesSent: number
  bytesTotal: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function listFileSystemRoots(): { entries: FsEntry[] } {
  if (os.platform() === 'win32') {
    const entries: FsEntry[] = []

    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`
      if (!fs.existsSync(drive)) continue
      entries.push({ name: drive, path: drive, isDir: true })
    }

    return { entries }
  }

  return { entries: [{ name: '/', path: '/', isDir: true }] }
}

export function handleFsLs(
  reqPath: string,
): { entries: FsEntry[] } | { error: string } {
  if (reqPath === FILE_SYSTEM_ROOTS_PATH) {
    return listFileSystemRoots()
  }

  const normalized = normalizePath(reqPath)
  if (!isPathSafe(normalized)) {
    return { error: `Access denied: ${reqPath}` }
  }

  try {
    const dirents = fs.readdirSync(normalized, { withFileTypes: true })
    const entries: FsEntry[] = dirents.map((d) => {
      const fullPath = path.join(normalized, d.name)
      const isDir = d.isDirectory()
      const entry: FsEntry = { name: d.name, path: fullPath, isDir }
      try {
        const stat = fs.statSync(fullPath)
        entry.size = isDir ? undefined : stat.size
        entry.modifiedAt = stat.mtimeMs
      } catch {
        // stat failure is non-fatal
      }
      return entry
    })
    return { entries }
  } catch (err) {
    return { error: `Failed to list ${reqPath}: ${(err as Error).message}` }
  }
}

export function handleFsRead(
  reqPath: string,
): { path: string; content: string } | { error: string } {
  const normalized = normalizePath(reqPath)
  if (!isPathSafe(normalized)) {
    return { error: `Access denied: ${reqPath}` }
  }

  try {
    const stat = fs.statSync(normalized)
    if (stat.isDirectory()) {
      return { error: `Not a file: ${reqPath}` }
    }
    if (stat.size > MAX_READ_SIZE) {
      return { error: `File too large (${stat.size} bytes, max ${MAX_READ_SIZE})` }
    }
    const content = fs.readFileSync(normalized, 'utf-8')
    return { path: normalized, content }
  } catch (err) {
    return { error: `Failed to read ${reqPath}: ${(err as Error).message}` }
  }
}

export async function* handleFsDownload(
  req: FsTransferRequest,
  onProgress?: (progress: TransferProgress) => void,
): AsyncGenerator<FsChunk> {
  const filePath = req.path
  if (!filePath) {
    throw new Error('Missing path for download')
  }

  const normalized = normalizePath(filePath)
  if (!isPathSafe(normalized)) {
    throw new Error(`Access denied: ${filePath}`)
  }

  const stat = fs.statSync(normalized)
  if (stat.size > MAX_TRANSFER_SIZE) {
    throw new Error(
      `File too large (${stat.size} bytes, max ${MAX_TRANSFER_SIZE})`,
    )
  }

  const buf = fs.readFileSync(normalized)
  const total = Math.ceil(buf.length / CHUNK_SIZE)
  const chunksPerSec = Math.floor(RATE_LIMIT_BYTES_PER_SEC / CHUNK_SIZE)
  const delayMs = chunksPerSec > 0 ? Math.ceil(1000 / chunksPerSec) : 0

  for (let seq = 0; seq < total; seq++) {
    const start = seq * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, buf.length)
    const data = buf.subarray(start, end).toString('base64')

    yield { transferId: req.transferId, seq, total, data }

    onProgress?.({
      transferId: req.transferId,
      seq,
      total,
      bytesSent: end,
      bytesTotal: buf.length,
    })

    if (delayMs > 0 && seq < total - 1) {
      await sleep(delayMs)
    }
  }
}

export function handleFsUploadInit(
  req: FsTransferRequest,
): { targetPath: string } | { error: string } {
  const targetPath = req.targetPath ?? req.path
  if (!targetPath) {
    return { error: 'Missing targetPath for upload' }
  }

  const normalized = normalizePath(targetPath)
  if (!isPathSafe(normalized)) {
    return { error: `Access denied: ${targetPath}` }
  }

  if (req.size != null && req.size > MAX_TRANSFER_SIZE) {
    return { error: `File too large (${req.size} bytes, max ${MAX_TRANSFER_SIZE})` }
  }

  const dir = path.dirname(normalized)
  fs.mkdirSync(dir, { recursive: true })

  return { targetPath: normalized }
}

export function handleFsUploadChunk(
  targetPath: string,
  chunk: FsChunk,
): void {
  const buf = Buffer.from(chunk.data, 'base64')
  const flag = chunk.seq === 0 ? 'w' : 'a'
  fs.writeFileSync(targetPath, buf, { flag })
}
