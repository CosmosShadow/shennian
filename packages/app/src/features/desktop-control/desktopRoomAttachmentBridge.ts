// @arch docs/features/network-rooms/message-and-attachment-storage.md
// @test ../../__tests__/desktop-room-attachments.test.ts
export type AttachmentResult<T> = { ok: true; value: T } | {
  ok: false; error: { code: string; message: string; retryable: boolean }
}
export type DesktopRoomAttachmentBridge = {
  uploadStart(input: { id: string; roomId: string; name: string; mimeType: string; mediaKind: 'image' | 'audio' | 'file'; byteSize: number;
    source: { kind: 'file'; handle: string } | { kind: 'bytes' } }): Promise<AttachmentResult<void>>
  uploadChunk(input: { id: string; offset: number; bytes: Uint8Array }): Promise<AttachmentResult<{ nextOffset: number }>>
  uploadFinish(input: { id: string }): Promise<AttachmentResult<{ attachmentId: string }>>
  cancel(input: { id: string }): Promise<AttachmentResult<void>>
  download(input: { id: string; roomId: string; attachmentId: string }): Promise<AttachmentResult<
    { canceled: true } | { canceled: false; name: string; handle: string }>>
  previewUrl(input: { roomId: string; attachmentId: string }): Promise<AttachmentResult<{
    url: string; mimeType: string; expiresAt: string }>>
}

export function requireDesktopRoomAttachmentBridge(): DesktopRoomAttachmentBridge {
  const bridge = (globalThis as typeof globalThis & {
    shennianDesktop?: { roomAttachments?: DesktopRoomAttachmentBridge }
  }).shennianDesktop?.roomAttachments
  if (!bridge || ['uploadStart', 'uploadChunk', 'uploadFinish', 'cancel', 'download',
    'previewUrl'].some((key) =>
    typeof bridge[key as keyof DesktopRoomAttachmentBridge] !== 'function')) {
    throw new Error('desktop_room_attachment_bridge_unavailable')
  }
  return bridge
}

export function unwrapAttachmentResult<T>(result: AttachmentResult<T>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}
