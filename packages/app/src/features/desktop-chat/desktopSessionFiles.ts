// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-session-files.test.ts

export const DESKTOP_SESSION_FILE_CHUNK_BYTES = 256 * 1024
export const DESKTOP_SESSION_FILE_IMAGE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024
export const DESKTOP_SESSION_FILE_TEXT_PREVIEW_MAX_BYTES = 512 * 1024

export type DesktopSessionFileScope = {
  accountId: string
  machineId: string
  sessionId: string
  rootPath: string
}
export type DesktopSessionFileEntry = {
  name: string
  path: string
  isDir: boolean
  size?: number
  modifiedAt?: number
}
type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
type Bridge = {
  list(input: DesktopSessionFileScope & { path: string; cursor: number; limit: number }): Promise<Result<{
    path: string; entries: DesktopSessionFileEntry[]; nextCursor: number | null
  }>>
  read(input: DesktopSessionFileScope & { path: string; offset: number; limitBytes: number }): Promise<Result<{
    bytes: Uint8Array; offset: number; nextOffset: number | null; totalSize: number
  }>>
  download(input: DesktopSessionFileScope & { path: string; name: string }): Promise<Result<
    { canceled: true } | { canceled: false; name: string; handle: string }
  >>
  reveal(input: { handle: string }): Promise<Result<void>>
}

export function requireDesktopSessionFilesBridge(): Bridge {
  const bridge = (globalThis as typeof globalThis & { shennianDesktop?: { sessionFiles?: Partial<Bridge> } })
    .shennianDesktop?.sessionFiles
  if (!bridge || typeof bridge.list !== 'function' || typeof bridge.read !== 'function' ||
      typeof bridge.download !== 'function' || typeof bridge.reveal !== 'function') {
    throw new Error('Desktop Session file bridge is unavailable.')
  }
  return bridge as Bridge
}

export async function listDesktopSessionFiles(
  scope: DesktopSessionFileScope,
  path: string,
  cursor = 0,
): Promise<{ path: string; entries: DesktopSessionFileEntry[]; nextCursor: number | null }> {
  return unwrap(await requireDesktopSessionFilesBridge().list({ ...scope, path, cursor, limit: 200 }))
}

export async function readDesktopSessionFilePreview(
  scope: DesktopSessionFileScope,
  path: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let offset = 0
  let expectedTotal: number | null = null
  while (true) {
    const page = unwrap(await requireDesktopSessionFilesBridge().read({
      ...scope, path, offset, limitBytes: DESKTOP_SESSION_FILE_CHUNK_BYTES,
    }))
    if (page.offset !== offset || !(page.bytes instanceof Uint8Array) ||
        !Number.isSafeInteger(page.totalSize) || page.totalSize < 0 || page.totalSize > maxBytes ||
        (expectedTotal !== null && page.totalSize !== expectedTotal)) {
      throw new Error('Desktop Session file preview response is invalid.')
    }
    expectedTotal = page.totalSize
    chunks.push(page.bytes)
    const next = offset + page.bytes.byteLength
    if (page.nextOffset === null) {
      if (next !== page.totalSize) throw new Error('Desktop Session file preview is incomplete.')
      break
    }
    if (!page.bytes.byteLength || page.nextOffset !== next || next >= page.totalSize) {
      throw new Error('Desktop Session file preview response is invalid.')
    }
    offset = page.nextOffset
  }
  const output = new Uint8Array(expectedTotal ?? 0)
  let writeOffset = 0
  for (const chunk of chunks) { output.set(chunk, writeOffset); writeOffset += chunk.byteLength }
  return output
}

export async function downloadDesktopSessionFile(
  scope: DesktopSessionFileScope,
  path: string,
  name: string,
): Promise<{ canceled: true } | { canceled: false; name: string; handle: string }> {
  return unwrap(await requireDesktopSessionFilesBridge().download({ ...scope, path, name }))
}

export async function revealDesktopSessionFile(handle: string): Promise<void> {
  unwrap(await requireDesktopSessionFilesBridge().reveal({ handle }))
}

export function desktopBytesToBase64(bytes: Uint8Array): string {
  let output = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 32 * 1024) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + 32 * 1024))
  }
  return btoa(output)
}

function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message || 'Desktop Session file request failed.')
}
