// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-fs-ls-roots-navigation.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  FsEntry,
  FsTransferAbortParams,
  FsTransferChunkParams,
  FsTransferFinishParams,
  FsTransferStartParams,
  ReqFrame,
} from '@shennian/wire'
import type { SessionManagerRuntime } from '../types.js'
import {
  convertMarkdownToPdf,
  defaultPdfOutputPath,
  findChromiumExecutable,
  installManagedChromium,
  managedChromiumBrowsersPath,
  MarkdownPdfBrowserMissingError,
} from '../../tools/markdown-to-pdf.js'
import { createZipArchive } from '../archive-zip.js'
import {
  BinaryTextPreviewError,
  decodeTextBufferAuto,
  isAutoTextEncoding,
} from '../../fs/text-decoder.js'
import {
  abortAttachmentTransfer,
  appendAttachmentTransferChunk,
  finishAttachmentTransfer,
  startAttachmentTransfer,
} from '../attachment-transfer-store.js'
import { assertPersonalSyncIdentity, getPersonalSyncIdentity } from '../../personal-sync/epoch.js'
import { getDaemonInstallationId } from '../../personal-sync/identity.js'

const FILE_SYSTEM_ROOTS_PATH = '__roots__'
const MAX_ARCHIVE_FILES = 5000
const MAX_ARCHIVE_TOTAL_SIZE = 1024 * 1024 * 1024

function isWindowsAbsolutePath(pathValue: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/.test(pathValue) || /^\\\\[^\\]+\\[^\\]+/.test(pathValue)
}

function pathApiForPath(pathValue: string): typeof path.win32 | typeof path.posix {
  return isWindowsAbsolutePath(pathValue) ? path.win32 : path.posix
}

function makeFsEntry(entryPath: string): FsEntry {
  const stat = fs.statSync(entryPath)
  const api = pathApiForPath(entryPath)
  return {
    name: api.basename(entryPath),
    path: entryPath,
    isDir: stat.isDirectory(),
    size: stat.isFile() ? stat.size : undefined,
    modifiedAt: stat.mtimeMs,
  }
}

function listFileSystemRoots(): FsEntry[] {
  if (os.platform() === 'win32') {
    const entries: FsEntry[] = []
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`
      if (fs.existsSync(drive)) entries.push({ name: drive, path: drive, isDir: true })
    }
    return entries
  }
  return [{ name: '/', path: '/', isDir: true }]
}

function fsErrorMessage(err: unknown, fallbackPath: string): string {
  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as NodeJS.ErrnoException).code)
      : ''
  if (code === 'ENOENT') return `Directory not found: ${fallbackPath}`
  if (code === 'EACCES' || code === 'EPERM') return `Permission denied: ${fallbackPath}`
  return err instanceof Error ? err.message : String(err)
}

function isSafeRenameName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed || trimmed !== name) return false
  if (name === '.' || name === '..') return false
  if (hasControlChar(name) || /[\\/:]/.test(name)) return false
  if (/[<>|"?*]/.test(name)) return false
  if (/[. ]$/.test(name)) return false
  const upper = name.split('.')[0]?.toUpperCase()
  if (upper && /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(upper)) return false
  return true
}

function hasControlChar(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0)
    return code >= 0x00 && code <= 0x1f
  })
}

export async function handleFsLs(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const requestedPath = (req.params.path as string) || os.homedir()
  const rootPath = (req.params.rootPath as string | undefined) || requestedPath

  if (requestedPath === FILE_SYSTEM_ROOTS_PATH) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: { path: FILE_SYSTEM_ROOTS_PATH, entries: listFileSystemRoots() },
    })
    return
  }

  const resolved = await runtime.resolveAuthorizedPathAsync(requestedPath, rootPath)
  if (!resolved.ok) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
    return
  }
  const dirPath = resolved.path

  try {
    const raw = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const joinPath = isWindowsAbsolutePath(dirPath) ? path.win32.join : path.join
    const entries: FsEntry[] = raw
      .map((entry) => ({
        name: entry.name,
        path: joinPath(dirPath, entry.name),
        isDir: entry.isDirectory(),
      }))
      .sort((left, right) => {
        if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
        return left.name.localeCompare(right.name)
      })

    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: { path: dirPath, entries },
    })
  } catch (err) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: fsErrorMessage(err, dirPath),
    })
  }
}

export async function handleFsRead(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const requestedPath = req.params.path as string
  const rootPath = (req.params.rootPath as string | undefined) || requestedPath
  const resolved = runtime.resolveAuthorizedPath(requestedPath, rootPath)
  if (!resolved.ok) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
    return
  }
  const filePath = resolved.path
  const requestedEncoding = req.params.encoding
  const encoding = typeof requestedEncoding === 'string' ? requestedEncoding : 'utf8'
  const offset = req.params.offset as number | undefined
  const length = req.params.length as number | undefined

  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'Not a file' })
      return
    }

    if (offset != null && length != null) {
      const readLen = Math.min(length, Math.max(0, stat.size - offset))
      if (readLen <= 0) {
        runtime.client.sendRes({
          type: 'res',
          id: req.id,
          ok: true,
          payload: { data: '', offset, length: 0, totalSize: stat.size, path: filePath },
        })
        return
      }

      const fd = fs.openSync(filePath, 'r')
      try {
        const buffer = Buffer.alloc(readLen)
        const bytesRead = fs.readSync(fd, buffer, 0, readLen, offset)
        runtime.client.sendRes({
          type: 'res',
          id: req.id,
          ok: true,
          payload: {
            data: buffer.subarray(0, bytesRead).toString('base64'),
            offset,
            length: bytesRead,
            totalSize: stat.size,
            path: filePath,
          },
        })
      } finally {
        fs.closeSync(fd)
      }
      return
    }

    const maxSize =
      (req.params.maxSize as number) || (encoding === 'base64' ? 5 * 1024 * 1024 : 512 * 1024)
    if (stat.size > maxSize) {
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: false,
        error: `File too large: ${stat.size} bytes (max ${maxSize})`,
        payload: { size: stat.size, path: filePath },
      })
      return
    }

    if (encoding === 'base64') {
      const buffer = fs.readFileSync(filePath)
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: true,
        payload: { data: buffer.toString('base64'), path: filePath, size: stat.size },
      })
      return
    }

    if (isAutoTextEncoding(encoding)) {
      const buffer = fs.readFileSync(filePath)
      const decoded = decodeTextBufferAuto(buffer)
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: true,
        payload: {
          content: decoded.content,
          path: filePath,
          size: stat.size,
          encoding: decoded.encoding,
          encodingFallback: decoded.fallback,
        },
      })
      return
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: { content, path: filePath, size: stat.size },
    })
  } catch (err) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: err instanceof BinaryTextPreviewError ? err.message : String(err),
    })
  }
}

export async function handleFsWrite(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const requestedPath = req.params.path as string
  const content = req.params.content as string
  const rootPath = (req.params.rootPath as string | undefined) || requestedPath

  if (!requestedPath || typeof content !== 'string') {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'path and content are required',
    })
    return
  }

  const resolved = runtime.resolveAuthorizedPath(requestedPath, rootPath)
  if (!resolved.ok) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
    return
  }

  try {
    const existing = fs.existsSync(resolved.path) ? fs.statSync(resolved.path) : null
    if (existing && !existing.isFile()) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'Not a file' })
      return
    }
    fs.writeFileSync(resolved.path, content, 'utf-8')
    const stat = fs.statSync(resolved.path)
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: { path: resolved.path, size: stat.size, modifiedAt: stat.mtimeMs },
    })
  } catch (err) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: String(err) })
  }
}

export async function handleFsRename(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const requestedPath = req.params.path as string
  const newName = req.params.newName as string

  if (!requestedPath || !newName) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'path and newName are required',
    })
    return
  }
  if (!isSafeRenameName(newName)) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'Invalid newName' })
    return
  }

  const api = pathApiForPath(requestedPath)
  const rootPath = (req.params.rootPath as string | undefined) || api.dirname(requestedPath)
  const resolved = runtime.resolveAuthorizedPath(requestedPath, rootPath)
  if (!resolved.ok) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
    return
  }

  try {
    const api = pathApiForPath(resolved.path)
    const newPath = api.join(api.dirname(resolved.path), newName)
    const checkedNewPath = runtime.resolveAuthorizedPath(newPath, rootPath)
    if (!checkedNewPath.ok) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: checkedNewPath.error })
      return
    }
    if (fs.existsSync(checkedNewPath.path)) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'Target already exists' })
      return
    }
    fs.renameSync(resolved.path, checkedNewPath.path)
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        oldPath: resolved.path,
        newPath: checkedNewPath.path,
        entry: makeFsEntry(checkedNewPath.path),
      },
    })
  } catch (err) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: String(err) })
  }
}

export async function handleFsExportMarkdownPdf(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const requestedPath = req.params.path as string
  const rootPath = (req.params.rootPath as string | undefined) || path.dirname(requestedPath || '.')
  const title = typeof req.params.title === 'string' ? req.params.title : undefined

  if (!requestedPath) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'path is required' })
    return
  }

  const resolved = runtime.resolveAuthorizedPath(requestedPath, rootPath)
  if (!resolved.ok) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
    return
  }
  if (!/\.mdx?$/i.test(resolved.path)) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'Only Markdown files can be exported to PDF',
    })
    return
  }

  const outputPath = defaultPdfOutputPath(resolved.path)
  const checkedOutput = runtime.resolveAuthorizedPath(outputPath, rootPath)
  if (!checkedOutput.ok) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: checkedOutput.error })
    return
  }

  try {
    const result = await convertMarkdownToPdf(resolved.path, {
      outputPath: checkedOutput.path,
      title,
    })
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        sourcePath: resolved.path,
        outputPath: result.outputPath,
        entry: makeFsEntry(result.outputPath),
      },
    })
  } catch (err) {
    if (err instanceof MarkdownPdfBrowserMissingError) {
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: false,
        error:
          'This machine needs the PDF export component before Markdown files can be exported to PDF.',
        payload: err.setup,
      })
      return
    }
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleFsExportMarkdownPdfSetup(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  try {
    await installManagedChromium()
    const browserPath = await findChromiumExecutable()
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: { ready: true, browserPath, managedPath: managedChromiumBrowsersPath() },
    })
  } catch (error) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function safeArchiveBaseName(name: string): string {
  let safeName = ''
  for (const char of name.trim()) {
    const code = char.charCodeAt(0)
    const unsafe = code <= 0x1f || '<>:"/\\|?*'.includes(char)
    if (unsafe) {
      if (!safeName.endsWith('-')) safeName += '-'
    } else {
      safeName += char
    }
  }
  const trimmed = safeName.replace(/[. ]+$/g, '')
  return trimmed || 'folder'
}

export async function handleFsArchiveZip(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const requestedPath = req.params.path as string
  const rootPath = (req.params.rootPath as string | undefined) || requestedPath

  if (!requestedPath) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'path is required' })
    return
  }

  const resolved = runtime.resolveAuthorizedPath(requestedPath, rootPath)
  if (!resolved.ok) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
    return
  }

  try {
    const stat = fs.statSync(resolved.path)
    if (!stat.isDirectory()) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'Not a directory' })
      return
    }

    const api = pathApiForPath(resolved.path)
    const baseName = safeArchiveBaseName(api.basename(resolved.path))
    const archiveDir = path.join(os.tmpdir(), 'shennian-archives')
    const outputPath = path.join(
      archiveDir,
      `${baseName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`,
    )
    const result = createZipArchive(resolved.path, outputPath, {
      maxFiles: MAX_ARCHIVE_FILES,
      maxTotalSize: MAX_ARCHIVE_TOTAL_SIZE,
    })

    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        sourcePath: resolved.path,
        outputPath: result.outputPath,
        entry: makeFsEntry(result.outputPath),
        fileCount: result.fileCount,
        totalSize: result.totalSize,
      },
    })
  } catch (err) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleFsTransferStart(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const params = req.params as unknown as FsTransferStartParams
  try {
    assertPersonalSyncIdentity(params)
    const resolved = runtime.resolveAuthorizedPath(params.rootPath, params.rootPath)
    if (!resolved.ok) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
      return
    }
    const result = startAttachmentTransfer({ ...params, rootPath: resolved.path })
    if (!result.reused) {
      runtime.pendingTransfers.set(params.transferId, {
        transferId: params.transferId,
        rootPath: resolved.path,
        lastActivityAt: Date.now(),
      })
    }
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: {
        ...getPersonalSyncIdentity(getDaemonInstallationId()),
        ...result,
        ...(result.attachment
          ? { attachment: { ...getPersonalSyncIdentity(getDaemonInstallationId()), ...result.attachment } }
          : {}),
      },
    })
  } catch (err) {
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleFsTransferChunk(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const params = req.params as unknown as FsTransferChunkParams
  try {
    assertPersonalSyncIdentity(params)
    const resolved = runtime.resolveAuthorizedPath(params.rootPath, params.rootPath)
    if (!resolved.ok) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
      return
    }
    const buffer = Buffer.from(params.data, 'base64')
    const result = appendAttachmentTransferChunk({
      rootPath: resolved.path,
      transferId: params.transferId,
      relativePath: params.relativePath,
      offset: params.offset,
      data: buffer,
    })
    runtime.pendingTransfers.set(params.transferId, {
      transferId: params.transferId,
      rootPath: resolved.path,
      lastActivityAt: Date.now(),
    })
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: {
        ...getPersonalSyncIdentity(getDaemonInstallationId()),
        transferId: params.transferId,
        ...result,
      },
    })
  } catch (err) {
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleFsTransferFinish(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const params = req.params as unknown as FsTransferFinishParams
  try {
    assertPersonalSyncIdentity(params)
    const resolved = runtime.resolveAuthorizedPath(params.rootPath, params.rootPath)
    if (!resolved.ok) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
      return
    }
    const result = finishAttachmentTransfer(resolved.path, params.transferId)
    runtime.pendingTransfers.delete(params.transferId)
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: { ...getPersonalSyncIdentity(getDaemonInstallationId()), ...result },
    })
  } catch (err) {
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleFsTransferAbort(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const params = req.params as unknown as FsTransferAbortParams
  try {
    assertPersonalSyncIdentity(params)
    const resolved = runtime.resolveAuthorizedPath(params.rootPath, params.rootPath)
    if (!resolved.ok) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: resolved.error })
      return
    }
    abortAttachmentTransfer(resolved.path, params.transferId)
    runtime.pendingTransfers.delete(params.transferId)
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: {
        ...getPersonalSyncIdentity(getDaemonInstallationId()),
        transferId: params.transferId,
        aborted: true,
      },
    })
  } catch (err) {
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function cleanupPendingTransfers(runtime: SessionManagerRuntime): void {
  // Staging is deliberately durable across daemon restarts. The 10-minute
  // lease sweeper owns deletion; process shutdown must not destroy resumable data.
  runtime.pendingTransfers.clear()
}
