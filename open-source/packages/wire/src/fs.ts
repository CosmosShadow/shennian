import type { PersonalSyncIdentity } from './session-sync.ts'

export type FsEntry = {
  name: string
  path: string
  isDir: boolean
  size?: number
  modifiedAt?: number
}

export type FsTransferRequest = {
  transferId: string
  direction: 'upload' | 'download'
  path?: string
  name?: string
  size?: number
  mimeType?: string
  targetPath?: string
  /** Base64-encoded file content for single-shot uploads (< 5 MB) */
  data?: string
}

export type FsChunk = {
  transferId: string
  seq: number
  total: number
  data: string
}

export type FsTransferManifestEntry = {
  relativePath: string
  size: number
  sha256: string
  mimeType?: string
  modifiedAt?: number
}

export type FsTransferStartParams = PersonalSyncIdentity & {
  transferId: string
  rootPath: string
  name: string
  totalSize: number
  sha256: string
  mimeType: string
  kind: 'file' | 'folder'
  manifest?: FsTransferManifestEntry[]
}

export type FsTransferStartResult = PersonalSyncIdentity & {
  transferId: string
  path: string
  reused: boolean
  offsets: Record<string, number>
  attachment?: FsTransferFinishResult
}

export type FsTransferChunkParams = PersonalSyncIdentity & {
  transferId: string
  rootPath: string
  offset: number
  data: string
  relativePath?: string
}

export type FsTransferFinishParams = PersonalSyncIdentity & {
  transferId: string
  rootPath: string
}

export type FsTransferFinishResult = PersonalSyncIdentity & {
  transferId: string
  path: string
  name: string
  mimeType: string
  kind: 'file' | 'folder'
  byteSize: number
  sha256: string
  reused: boolean
}

export type FsTransferAbortParams = PersonalSyncIdentity & {
  transferId: string
  rootPath: string
}

export type FsTransferChunkResult = PersonalSyncIdentity & {
  transferId: string
  written: number
  nextOffset: number
}

export type FsTransferAbortResult = PersonalSyncIdentity & {
  transferId: string
  aborted: true
}

/** Stable input for the aggregate hash of a folder transfer. */
export function serializeFsTransferManifest(entries: readonly FsTransferManifestEntry[]): string {
  return [...entries]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((entry) => `${entry.relativePath}\0${entry.size}\0${entry.sha256.toLowerCase()}`)
    .join('\n')
}

export type FsRenameResult = {
  oldPath: string
  newPath: string
  entry: FsEntry
}

export type FsWriteResult = {
  path: string
  size: number
  modifiedAt: number
}

export type FsMarkdownPdfExportResult = {
  sourcePath: string
  outputPath: string
  entry: FsEntry
}

export type FsArchiveZipResult = {
  sourcePath: string
  outputPath: string
  entry: FsEntry
  fileCount: number
  totalSize: number
}
