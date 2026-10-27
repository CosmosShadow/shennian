// @arch docs/features/desktop-local-first-client.md#71-desktop-bridge-ipcrenderer--main
// @test packages/app/src/__tests__/desktop-file-operations.test.ts

const DESKTOP_FILE_CHUNK_BYTES = 256 * 1024
const DESKTOP_UPLOAD_READ_MAX_BYTES = 1024 * 1024
export const DESKTOP_FILE_MAX_BYTES = 100 * 1024 * 1024
export const DESKTOP_DIRECTORY_MAX_FILES = 2_000
export const DESKTOP_DIRECTORY_MAX_DEPTH = 64
export const DESKTOP_DIRECTORY_MAX_BYTES = 100 * 1024 * 1024

type DesktopResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: { code: string; message: string; retryable: boolean }
    }

type DesktopFileSelection =
  | { canceled: true }
  | {
      canceled: false
      item: { handle: string; name: string; kind: 'file' | 'directory'; size?: number }
    }

type DesktopProjectDirectorySelection =
  | { canceled: true }
  | { canceled: false; path: string }

type DesktopFileReadPage = {
  dataBase64: string
  offset: number
  bytesRead: number
  nextOffset: number | null
  eof: boolean
}

type DesktopDirectoryPage = {
  entries: Array<{
    handle?: string
    name: string
    kind: 'file' | 'directory' | 'other'
    size?: number
  }>
  cursor: number
  nextCursor: number | null
}

export type DesktopFilesBridge = {
  openFile(): Promise<DesktopResult<DesktopFileSelection>>
  adoptDroppedItem(file: unknown): Promise<DesktopResult<DesktopFileSelection>>
  openDirectory?(): Promise<DesktopResult<DesktopFileSelection>>
  pickProjectDirectory?(): Promise<DesktopResult<DesktopProjectDirectorySelection>>
  saveDialog(input?: { suggestedName?: string }): Promise<DesktopResult<DesktopFileSelection>>
  read(input: {
    handle: string
    offset?: number
    limitBytes?: number
  }): Promise<DesktopResult<DesktopFileReadPage>>
  write(input: {
    handle: string
    dataBase64: string
    offset?: number
    truncate?: boolean
  }): Promise<DesktopResult<{ bytesWritten: number; size: number }>>
  listDirectory?(input: {
    handle: string
    cursor?: number
    limit?: number
  }): Promise<DesktopResult<DesktopDirectoryPage>>
  showItemInFolder(input: { handle: string }): Promise<DesktopResult<void>>
}

export type DesktopPickedFile = {
  handle: string
  name: string
  size: number
  readChunk(offset: number, limitBytes: number): Promise<Uint8Array>
  readBytes(): Promise<Uint8Array>
}

export type DesktopPickedDirectory = {
  name: string
  files: Array<DesktopPickedFile & { relativePath: string }>
}

export type DesktopPickedItem = DesktopPickedFile | DesktopPickedDirectory

export type DesktopSavedFile = {
  name: string
  showInFolder(): Promise<void>
}

export type DesktopDownloadPage = {
  bytes: Uint8Array
  offset: number
  nextOffset: number | null
  totalSize: number
}

let lastSavedFile: DesktopSavedFile | null = null

export function getDesktopFilesBridge(): DesktopFilesBridge | null {
  const value = (globalThis as typeof globalThis & {
    shennianDesktop?: { files?: Partial<DesktopFilesBridge> }
  }).shennianDesktop?.files
  if (
    !value ||
    typeof value.openFile !== 'function' ||
    typeof value.adoptDroppedItem !== 'function' ||
    typeof value.saveDialog !== 'function' ||
    typeof value.read !== 'function' ||
    typeof value.write !== 'function' ||
    typeof value.showItemInFolder !== 'function'
  ) return null
  return value as DesktopFilesBridge
}

export async function adoptDesktopDroppedItem(
  file: File,
  bridge: DesktopFilesBridge = requireDesktopFilesBridge(),
): Promise<DesktopPickedItem> {
  const selection = unwrap(await bridge.adoptDroppedItem(file))
  if (selection.canceled) throw new Error('desktop_drop_canceled')
  return selection.item.kind === 'directory'
    ? enumerateDesktopDirectory(selection.item, bridge)
    : desktopPickedFile(selection.item, bridge)
}

export function splitDesktopPickedItems(items: DesktopPickedItem[]): {
  files: DesktopPickedFile[]
  directories: DesktopPickedDirectory[]
} {
  return {
    files: items.filter((item): item is DesktopPickedFile => 'handle' in item),
    directories: items.filter((item): item is DesktopPickedDirectory => !('handle' in item)),
  }
}

export async function pickDesktopFile(
  bridge: DesktopFilesBridge = requireDesktopFilesBridge(),
): Promise<DesktopPickedFile | null> {
  const selection = unwrap(await bridge.openFile())
  if (selection.canceled) return null
  if (selection.item.kind !== 'file') throw new Error('desktop_file_type_mismatch')
  return desktopPickedFile(selection.item, bridge)
}

export async function pickDesktopDirectory(
  bridge: DesktopFilesBridge = requireDesktopFilesBridge(),
): Promise<DesktopPickedDirectory | null | undefined> {
  if (typeof bridge.openDirectory !== 'function' || typeof bridge.listDirectory !== 'function') {
    return undefined
  }
  const selection = unwrap(await bridge.openDirectory())
  if (selection.canceled) return null
  if (selection.item.kind !== 'directory') throw new Error('desktop_file_type_mismatch')

  return enumerateDesktopDirectory(selection.item, bridge)
}

export async function pickDesktopProjectDirectory(
  bridge: DesktopFilesBridge = requireDesktopFilesBridge(),
): Promise<string | null | undefined> {
  if (typeof bridge.pickProjectDirectory !== 'function') return undefined
  const selection = unwrap(await bridge.pickProjectDirectory())
  return selection.canceled ? null : selection.path
}

async function enumerateDesktopDirectory(
  root: { handle: string; name: string },
  bridge: DesktopFilesBridge,
): Promise<DesktopPickedDirectory> {
  if (typeof bridge.listDirectory !== 'function') throw new Error('desktop_directory_not_supported')
  const files: DesktopPickedDirectory['files'] = []
  let totalBytes = 0
  const pending = [{ handle: root.handle, relativePath: '', depth: 0 }]
  for (let index = 0; index < pending.length; index += 1) {
    const directory = pending[index]!
    if (directory.depth > DESKTOP_DIRECTORY_MAX_DEPTH) throw new Error('desktop_directory_too_deep')
    let cursor = 0
    for (;;) {
      const page = unwrap(await bridge.listDirectory({
        handle: directory.handle,
        cursor,
        limit: 200,
      }))
      if (page.cursor !== cursor) throw new Error('desktop_directory_invalid_page')
      for (const entry of page.entries) {
        if (entry.kind === 'other') continue
        if (!entry.handle) throw new Error('desktop_directory_invalid_page')
        const relativePath = directory.relativePath
          ? `${directory.relativePath}/${entry.name}`
          : entry.name
        if (entry.kind === 'directory') {
          pending.push({ handle: entry.handle, relativePath, depth: directory.depth + 1 })
          continue
        }
        const size = entry.size ?? 0
        assertAllowedSize(size)
        totalBytes += size
        if (totalBytes > DESKTOP_DIRECTORY_MAX_BYTES) throw new Error('desktop_directory_too_large')
        files.push({ ...desktopPickedFile({ ...entry, handle: entry.handle }, bridge), relativePath })
        if (files.length > DESKTOP_DIRECTORY_MAX_FILES) throw new Error('desktop_directory_too_many_files')
      }
      if (page.nextCursor === null) break
      if (page.entries.length === 0 || page.nextCursor !== cursor + page.entries.length) {
        throw new Error('desktop_directory_invalid_page')
      }
      cursor = page.nextCursor
    }
  }
  if (files.length === 0) throw new Error('desktop_directory_empty')
  return { name: root.name, files }
}

function desktopPickedFile(
  item: { handle: string; name: string; size?: number },
  bridge: DesktopFilesBridge,
): DesktopPickedFile {
  const size = item.size ?? 0
  assertAllowedSize(size)
  return {
    handle: item.handle,
    name: item.name,
    size,
    readChunk: (offset, limitBytes) => readDesktopFileRange(bridge, item.handle, offset, limitBytes),
    readBytes: () => readDesktopFileBytes(bridge, item.handle, size),
  }
}

export async function readDesktopFileChunk(
  bridge: Pick<DesktopFilesBridge, 'read'>,
  handle: string,
  offset: number,
  limitBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limitBytes) || limitBytes < 1 || limitBytes > DESKTOP_FILE_CHUNK_BYTES) {
    throw new Error('desktop_file_invalid_page')
  }
  const page = unwrap(await bridge.read({ handle, offset, limitBytes }))
  if (page.offset !== offset || page.bytesRead < 0 || page.bytesRead > limitBytes) {
    throw new Error('desktop_file_invalid_page')
  }
  const chunk = decodeCanonicalBase64(page.dataBase64)
  if (chunk.byteLength !== page.bytesRead) throw new Error('desktop_file_invalid_page')
  return chunk
}

async function readDesktopFileRange(
  bridge: Pick<DesktopFilesBridge, 'read'>,
  handle: string,
  offset: number,
  limitBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limitBytes) || limitBytes < 1 || limitBytes > DESKTOP_UPLOAD_READ_MAX_BYTES) {
    throw new Error('desktop_file_invalid_page')
  }
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  while (bytesRead < limitBytes) {
    const chunk = await readDesktopFileChunk(
      bridge,
      handle,
      offset + bytesRead,
      Math.min(DESKTOP_FILE_CHUNK_BYTES, limitBytes - bytesRead),
    )
    if (chunk.byteLength === 0) break
    chunks.push(chunk)
    bytesRead += chunk.byteLength
  }
  const result = new Uint8Array(bytesRead)
  let writeOffset = 0
  for (const chunk of chunks) {
    result.set(chunk, writeOffset)
    writeOffset += chunk.byteLength
  }
  return result
}

export async function readDesktopFileBytes(
  bridge: Pick<DesktopFilesBridge, 'read'>,
  handle: string,
  expectedSize: number,
): Promise<Uint8Array> {
  assertAllowedSize(expectedSize)
  const chunks: Uint8Array[] = []
  let offset = 0
  let total = 0

  while (true) {
    const page = unwrap(await bridge.read({
      handle,
      offset,
      limitBytes: DESKTOP_FILE_CHUNK_BYTES,
    }))
    if (page.offset !== offset || page.bytesRead < 0 || page.bytesRead > DESKTOP_FILE_CHUNK_BYTES) {
      throw new Error('desktop_file_invalid_page')
    }
    const chunk = decodeCanonicalBase64(page.dataBase64)
    if (chunk.byteLength !== page.bytesRead) throw new Error('desktop_file_invalid_page')
    chunks.push(chunk)
    total += chunk.byteLength
    if (total > DESKTOP_FILE_MAX_BYTES) throw new Error('desktop_file_too_large')
    if (page.eof) {
      if (page.nextOffset !== null) throw new Error('desktop_file_invalid_page')
      break
    }
    if (page.nextOffset !== offset + page.bytesRead || page.bytesRead === 0) {
      throw new Error('desktop_file_invalid_page')
    }
    offset = page.nextOffset
  }

  if (total !== expectedSize) throw new Error('desktop_file_size_changed')
  const result = new Uint8Array(total)
  let writeOffset = 0
  for (const chunk of chunks) {
    result.set(chunk, writeOffset)
    writeOffset += chunk.byteLength
  }
  return result
}

export async function saveDesktopFileBytes(
  name: string,
  bytes: Uint8Array,
  bridge: DesktopFilesBridge = requireDesktopFilesBridge(),
): Promise<DesktopSavedFile | null> {
  lastSavedFile = null
  assertAllowedSize(bytes.byteLength)
  const selection = unwrap(await bridge.saveDialog({ suggestedName: name }))
  if (selection.canceled) return null
  if (selection.item.kind !== 'file') throw new Error('desktop_file_type_mismatch')

  let offset = 0
  if (bytes.byteLength === 0) {
    unwrap(await bridge.write({
      handle: selection.item.handle,
      dataBase64: '',
      offset: 0,
      truncate: true,
    }))
  }
  while (offset < bytes.byteLength) {
    const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + DESKTOP_FILE_CHUNK_BYTES))
    const result = unwrap(await bridge.write({
      handle: selection.item.handle,
      dataBase64: encodeBase64(chunk),
      offset,
      truncate: offset === 0,
    }))
    if (result.bytesWritten !== chunk.byteLength || result.size !== offset + chunk.byteLength) {
      throw new Error('desktop_file_write_mismatch')
    }
    offset += chunk.byteLength
  }

  const saved: DesktopSavedFile = {
    name: selection.item.name,
    showInFolder: async () => {
      unwrap(await bridge.showItemInFolder({ handle: selection.item.handle }))
    },
  }
  lastSavedFile = saved
  return saved
}

export async function saveDesktopFileStream(
  name: string,
  readPage: (offset: number, limitBytes: number) => Promise<DesktopDownloadPage>,
  options: { isCurrent?: () => boolean } = {},
  bridge: DesktopFilesBridge = requireDesktopFilesBridge(),
): Promise<DesktopSavedFile | null> {
  lastSavedFile = null
  if (options.isCurrent && !options.isCurrent()) throw new Error('desktop_file_operation_stale')
  const selection = unwrap(await bridge.saveDialog({ suggestedName: name }))
  if (selection.canceled) return null
  if (selection.item.kind !== 'file') throw new Error('desktop_file_type_mismatch')

  let offset = 0
  let expectedTotal: number | null = null
  let wrote = false
  for (;;) {
    if (options.isCurrent && !options.isCurrent()) throw new Error('desktop_file_operation_stale')
    const page = await readPage(offset, DESKTOP_FILE_CHUNK_BYTES)
    if (options.isCurrent && !options.isCurrent()) throw new Error('desktop_file_operation_stale')
    if (page.offset !== offset || page.bytes.byteLength > DESKTOP_FILE_CHUNK_BYTES) {
      throw new Error('desktop_file_invalid_page')
    }
    assertAllowedSize(page.totalSize)
    if (expectedTotal !== null && expectedTotal !== page.totalSize) {
      throw new Error('desktop_file_size_changed')
    }
    expectedTotal = page.totalSize
    const next = offset + page.bytes.byteLength
    if (next > page.totalSize ||
        (page.nextOffset === null ? next !== page.totalSize : page.nextOffset !== next || next >= page.totalSize)) {
      throw new Error('desktop_file_invalid_page')
    }
    const result = unwrap(await bridge.write({
      handle: selection.item.handle,
      dataBase64: encodeBase64(page.bytes),
      offset,
      truncate: !wrote,
    }))
    if (result.bytesWritten !== page.bytes.byteLength || result.size !== next) {
      throw new Error('desktop_file_write_mismatch')
    }
    wrote = true
    if (page.nextOffset === null) break
    if (page.bytes.byteLength === 0) throw new Error('desktop_file_invalid_page')
    offset = page.nextOffset
  }

  const saved: DesktopSavedFile = {
    name: selection.item.name,
    showInFolder: async () => {
      unwrap(await bridge.showItemInFolder({ handle: selection.item.handle }))
    },
  }
  lastSavedFile = saved
  return saved
}

export async function showLastDesktopSavedFileInFolder(): Promise<boolean> {
  if (!lastSavedFile) return false
  await lastSavedFile.showInFolder()
  return true
}

export function clearLastDesktopSavedFileForTests(): void {
  lastSavedFile = null
}

function requireDesktopFilesBridge(): DesktopFilesBridge {
  const bridge = getDesktopFilesBridge()
  if (!bridge) throw new Error('desktop_file_bridge_unavailable')
  return bridge
}

function unwrap<T>(result: DesktopResult<T>): T {
  if (!result.ok) throw new Error(result.error.code || 'desktop_file_operation_failed')
  return result.value
}

function assertAllowedSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('desktop_file_invalid_size')
  if (size > DESKTOP_FILE_MAX_BYTES) throw new Error('desktop_file_too_large')
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('desktop_file_invalid_page')
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 16 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.byteLength, offset + 16 * 1024)))
  }
  return btoa(binary)
}
