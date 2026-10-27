// @arch docs/features/desktop-project-files-opaque-protocol.md
// @test src/__tests__/project-files-workspace.test.ts

import { ProjectFsClientError } from './desktopProjectFsClient'

export const PROJECT_PREVIEW_MAX_BYTES = 25 * 1024 * 1024

export function decodeBase64Chunks(chunks: readonly string[], totalSize: number): Uint8Array {
  if (!Number.isSafeInteger(totalSize) || totalSize < 0 || totalSize > PROJECT_PREVIEW_MAX_BYTES) {
    throw previewTooLarge()
  }
  const result = new Uint8Array(totalSize)
  let offset = 0
  for (const chunk of chunks) {
    const decoded = atob(chunk)
    if (offset + decoded.length > result.length) throw protocolError()
    for (let index = 0; index < decoded.length; index += 1) {
      result[offset + index] = decoded.charCodeAt(index)
    }
    offset += decoded.length
  }
  if (offset !== result.length) throw protocolError()
  return result
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const blockSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize))
  }
  return btoa(binary)
}

function previewTooLarge(): ProjectFsClientError {
  return new ProjectFsClientError('remote', {
    code: 'read_too_large',
    retryable: false,
    requiredAction: 'none',
  })
}

function protocolError(): ProjectFsClientError {
  return new ProjectFsClientError('protocol', {
    code: 'protocol_error',
    retryable: false,
    requiredAction: 'upgrade_daemon',
  })
}
