// @arch open-source/docs/server-runtime.md
// @test src/__tests__/oss.test.ts src/__tests__/local-object-store.test.ts
// Compatibility facade: existing business callers retain their contracts.
import * as oss from './oss-provider.js'
import { getDeploymentMode } from '../services/instance-settings.js'
import { LocalObjectStore } from './local-object-store.js'
import { signLocalStorageUrl } from './local-storage-capability.js'

export function getStorageProvider(): 'local' | 'oss' {
  const value = process.env.SHENNIAN_STORAGE_PROVIDER?.trim() || (getDeploymentMode() === 'self-hosted' ? 'local' : 'oss')
  if (value !== 'local' && value !== 'oss') throw new Error('invalid_storage_provider')
  return value
}
export function getLocalObjectStore(): LocalObjectStore {
  const root = process.env.SHENNIAN_STORAGE_DIR?.trim()
  if (!root) throw new Error('local_storage_directory_required')
  return new LocalObjectStore(root)
}
export function getOssClient() {
  if (getStorageProvider() !== 'oss') throw new Error('oss_distribution_unavailable')
  return oss.getOssClient()
}
export async function getObjectBuffer(key: string) {
  return getStorageProvider() === 'local' ? getLocalObjectStore().get(key) : oss.getObjectBuffer(key)
}
export async function getObjectText(key: string): Promise<string | null> {
  if (getStorageProvider() === 'oss') return oss.getObjectText(key)
  const object = await getLocalObjectStore().get(key)
  return object ? object.buffer.toString('utf8') : null
}
export async function putObjectBuffer(key: string, content: Buffer, contentType = 'application/octet-stream') {
  return getStorageProvider() === 'local' ? getLocalObjectStore().put(key, content, contentType) : oss.putObjectBuffer(key, content, contentType)
}
export async function putObjectText(key: string, content: string) {
  return getStorageProvider() === 'local'
    ? getLocalObjectStore().put(key, Buffer.from(content), 'application/x-ndjson; charset=utf-8') : oss.putObjectText(key, content)
}
export async function headObjectMetadata(key: string) {
  return getStorageProvider() === 'local' ? getLocalObjectStore().head(key) : oss.headObjectMetadata(key)
}
export async function deleteObjectIfExists(key: string) {
  return getStorageProvider() === 'local' ? getLocalObjectStore().delete(key) : oss.deleteObjectIfExists(key)
}
export async function deleteObjects(keys: string[]): Promise<number> {
  if (getStorageProvider() === 'oss') return oss.deleteObjects(keys)
  for (const key of keys) await getLocalObjectStore().delete(key)
  return keys.length
}
export async function listObjectsByPrefix(prefix: string, marker?: string | null): Promise<{
  objects: Array<{ name: string; size?: number }>; nextMarker: string | null; isTruncated: boolean
}> {
  return getStorageProvider() === 'local' ? getLocalObjectStore().list(prefix, marker) : oss.listObjectsByPrefix(prefix, marker)
}
export function signDownloadUrl(key: string, seconds = 300): string {
  return getStorageProvider() === 'local' ? signLocalStorageUrl(key, 'GET', seconds) : oss.signDownloadUrl(key, seconds)
}
export function signUploadUrl(key: string, input: { seconds?: number; contentType: string; sha256: string; byteSize?: number }): string {
  return getStorageProvider() === 'local' ? signLocalStorageUrl(key, 'PUT', input.seconds ?? 300, input) : oss.signUploadUrl(key, input)
}
