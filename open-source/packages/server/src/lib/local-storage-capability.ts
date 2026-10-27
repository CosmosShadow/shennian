// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-object-store.test.ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeInstanceOrigin } from '@shennian/wire'
import { MAX_LOCAL_OBJECT_BYTES, validateObjectKey } from './local-object-store.js'

export type LocalStorageCapability = {
  v: 1; method: 'GET' | 'PUT'; key: string; exp: number
  contentType?: string; sha256?: string; byteSize?: number
}

function secret(): string {
  const value = process.env.SHENNIAN_STORAGE_SIGNING_SECRET
  if (!value || Buffer.byteLength(value) < 32) throw new Error('local_storage_signing_secret_required')
  return value
}
function signature(body: string): string {
  return createHmac('sha256', secret()).update(`local-storage:v1:${body}`).digest('base64url')
}

export function signLocalStorageUrl(key: string, method: 'GET' | 'PUT', seconds: number,
  upload?: { contentType: string; sha256: string; byteSize?: number }): string {
  validateObjectKey(key)
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('invalid_storage_expiry')
  const origin = normalizeInstanceOrigin(process.env.SHENNIAN_PUBLIC_URL ?? '')
  const payload: LocalStorageCapability = {
    v: 1, key, method, exp: Math.floor(Date.now() / 1000) + seconds,
    ...(method === 'PUT' && upload ? {
      contentType: upload.contentType, sha256: upload.sha256,
      ...(upload.byteSize === undefined ? {} : { byteSize: upload.byteSize }),
    } : {}),
  }
  if (method === 'PUT' && (!upload || !validUpload(payload))) throw new Error('invalid_storage_upload')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${origin}/storage/local/object?capability=${body}.${signature(body)}`
}

function validUpload(payload: LocalStorageCapability): boolean {
  return typeof payload.contentType === 'string' && payload.contentType.length > 0 && payload.contentType.length <= 255 &&
    !/[\x00-\x1f\x7f]/.test(payload.contentType) && typeof payload.sha256 === 'string' && /^[a-f0-9]{64}$/.test(payload.sha256) &&
    (payload.byteSize === undefined || (Number.isSafeInteger(payload.byteSize) && payload.byteSize >= 0 && payload.byteSize <= MAX_LOCAL_OBJECT_BYTES))
}

export function verifyLocalStorageCapability(token: unknown, method: string, nowSeconds = Math.floor(Date.now() / 1000)): LocalStorageCapability | null {
  if (typeof token !== 'string' || token.length > 8192) return null
  const [body, supplied, extra] = token.split('.')
  if (!body || !supplied || extra) return null
  try {
    const expected = Buffer.from(signature(body))
    const actual = Buffer.from(supplied)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as LocalStorageCapability
    validateObjectKey(payload.key)
    if (payload.v !== 1 || payload.method !== method || !['GET', 'PUT'].includes(method) ||
      !Number.isSafeInteger(payload.exp) || payload.exp <= nowSeconds || payload.exp > nowSeconds + 3600 ||
      (method === 'PUT' && !validUpload(payload))) return null
    return payload
  } catch { return null }
}
