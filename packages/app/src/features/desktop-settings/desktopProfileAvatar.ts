// @arch docs/features/network-rooms/ui.md#三昵称和头像
// @test ../../__tests__/desktop-profile-avatar.test.ts
import { pickDesktopFile, type DesktopPickedFile } from '../desktop-control/desktopFileOperations'

type AvatarBitmap = Pick<ImageBitmap, 'width' | 'height' | 'close'>
export type DesktopAvatarDependencies = {
  pick: () => Promise<DesktopPickedFile | null>
  decode: (blob: Blob) => Promise<AvatarBitmap>
  render: (bitmap: AvatarBitmap) => Promise<Blob>
}

const dependencies: DesktopAvatarDependencies = {
  pick: pickDesktopFile,
  decode: (blob) => createImageBitmap(blob),
  render: (bitmap) => {
    const side = Math.min(bitmap.width, bitmap.height)
    if (side <= 0) throw new Error('Invalid avatar dimensions')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = Math.min(side, 1024)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Avatar image processing is unavailable')
    context.drawImage(bitmap as ImageBitmap, Math.floor((bitmap.width - side) / 2),
      Math.floor((bitmap.height - side) / 2), side, side, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) => canvas.toBlob((blob) => {
      canvas.width = canvas.height = 0
      if (blob) resolve(blob)
      else reject(new Error('Avatar image processing failed'))
    }, 'image/jpeg', 0.9))
  },
}

/** System picker + bounded local image processing; never reads a remote URL. */
export async function pickDesktopProfileAvatar(
  signal: AbortSignal,
  deps: DesktopAvatarDependencies = dependencies,
): Promise<Blob | null> {
  const assertActive = () => { if (signal.aborted) throw new Error('Avatar selection canceled') }
  assertActive()
  const file = await deps.pick()
  assertActive()
  if (!file) return null
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('Avatar image must be at most 10 MiB')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (let offset = 0; offset < file.size;) {
    assertActive()
    const bytes = await file.readChunk(offset, Math.min(256 * 1024, file.size - offset))
    assertActive()
    if (!bytes.byteLength || bytes.byteLength > file.size - offset) throw new Error('Invalid avatar file read')
    chunks.push(new Uint8Array(bytes))
    offset += bytes.byteLength
  }
  const bitmap = await deps.decode(new Blob(chunks))
  try {
    assertActive()
    const image = await deps.render(bitmap)
    assertActive()
    return image
  } finally {
    bitmap.close()
  }
}
