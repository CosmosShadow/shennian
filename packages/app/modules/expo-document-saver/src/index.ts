// @arch docs/features/network-rooms/message-and-attachment-storage.md
// @test packages/app/src/__tests__/file-operations-download.test.ts

import { Platform, requireNativeModule } from 'expo-modules-core'

type SaveResult = 'saved' | 'canceled'

type DocumentSaverNativeModule = {
  save(options: {
    filename: string
    mimeType: string
    data: string
  }): Promise<SaveResult>
}

let nativeModule: DocumentSaverNativeModule | null = null

export async function saveAndroidDocument(
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<SaveResult> {
  if (Platform.OS !== 'android') throw new Error('document_saver_android_only')
  nativeModule ??= requireNativeModule<DocumentSaverNativeModule>('ExpoDocumentSaver')
  return nativeModule.save({ filename, mimeType, data: encodeBase64(bytes) })
}

function encodeBase64(value: Uint8Array): string {
  const btoaImpl = (globalThis as typeof globalThis & { btoa?: (input: string) => string }).btoa
  if (btoaImpl) {
    let binary = ''
    const block = 0x8000
    for (let offset = 0; offset < value.length; offset += block) {
      binary += String.fromCharCode(
        ...value.subarray(offset, Math.min(offset + block, value.length)),
      )
    }
    return btoaImpl(binary)
  }
  const buffer = (
    globalThis as typeof globalThis & {
      Buffer?: { from: (input: Uint8Array) => { toString: (encoding: string) => string } }
    }
  ).Buffer
  if (buffer) return buffer.from(value).toString('base64')
  throw new Error('document_saver_base64_unsupported')
}
