// @arch docs/features/network-rooms/message-and-attachment-storage.md#51-heic--heif-按普通文件上传
// @test ../../__tests__/heic-file.test.ts

type FileIdentity = { name?: string | null; mimeType?: string | null }

/**
 * HEIC / HEIF is never decoded, converted, compressed or previewed. It keeps its original name,
 * MIME type and bytes and travels as an ordinary file (`mediaKind=file`).
 */
export function isHeicFile(file: FileIdentity): boolean {
  const mimeType = (file.mimeType ?? '').split(';', 1)[0]!.trim().toLowerCase()
  return /^image\/hei[cf](?:-sequence)?$/.test(mimeType) || /\.(?:heic|heif)$/i.test(file.name ?? '')
}

/** Image handling (thumbnail, gallery preview, photo-library save) is for decodable images only. */
export function isInlineImage(file: FileIdentity): boolean {
  return (file.mimeType ?? '').toLowerCase().startsWith('image/') && !isHeicFile(file)
}

export function uploadMediaKind(file: FileIdentity): 'image' | 'audio' | 'file' {
  if (isHeicFile(file)) return 'file'
  const mimeType = (file.mimeType ?? '').split(';', 1)[0]!.trim().toLowerCase()
  return mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'file'
}
