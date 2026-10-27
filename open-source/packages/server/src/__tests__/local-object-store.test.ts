// @covers open-source/packages/server/src/lib/local-object-store.ts
// @covers open-source/packages/server/src/lib/local-storage-capability.ts
// @covers open-source/packages/server/src/lib/oss.ts
// @covers open-source/packages/server/src/routes/local-storage.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { LocalObjectStore, validateObjectKey } from '../lib/local-object-store.js'
import { signLocalStorageUrl, verifyLocalStorageCapability } from '../lib/local-storage-capability.js'
import { getObjectBuffer, getObjectText, putObjectBuffer, putObjectText, headObjectMetadata, listObjectsByPrefix, deleteObjects, getStorageProvider } from '../lib/oss.js'
import { localStorageRoutes } from '../routes/local-storage.js'

let root: string
let store: LocalObjectStore
let app: FastifyInstance | undefined
const bytes = Buffer.from('private attachment')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const key = 'rooms/unit-room/attachments/unit/original'
const upload = { contentType: 'application/octet-stream', sha256, byteSize: bytes.length }
const relative = (url: string) => `${new URL(url).pathname}${new URL(url).search}`

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-objects-'))
  store = new LocalObjectStore(path.join(root, 'objects'))
  vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'self-hosted')
  vi.stubEnv('SHENNIAN_STORAGE_PROVIDER', 'local')
  vi.stubEnv('SHENNIAN_STORAGE_DIR', store.root)
  vi.stubEnv('SHENNIAN_STORAGE_SIGNING_SECRET', 'unit-only-signing-secret-not-a-real-credential')
  vi.stubEnv('SHENNIAN_PUBLIC_URL', 'https://unit.example')
})
afterEach(async () => {
  await app?.close()
  app = undefined
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

describe('local object storage', () => {
  it('supports the existing business facade without any OSS credentials', async () => {
    expect(getStorageProvider()).toBe('local')
    expect(await getObjectBuffer(key)).toBeNull()
    await putObjectBuffer(key, bytes, upload.contentType)
    expect(await getObjectBuffer(key)).toEqual({ buffer: bytes, mimeType: upload.contentType })
    expect(await headObjectMetadata(key)).toEqual({ byteSize: bytes.length, contentType: upload.contentType, sha256 })
    await putObjectText('notes/one', 'hello')
    expect(await getObjectText('notes/one')).toBe('hello')
    expect(await listObjectsByPrefix('rooms/')).toEqual({ objects: [{ name: key, size: bytes.length }], nextMarker: null, isTruncated: false })
    await deleteObjects([key, 'notes/one'])
    expect(await getObjectBuffer(key)).toBeNull()
  })
  it('replaces objects atomically, lists by key and keeps private file permissions', async () => {
    await store.put('folder/b', bytes, upload.contentType)
    await store.put('folder/a', bytes, upload.contentType)
    await store.put('folder/b', Buffer.from('replacement'), upload.contentType)
    expect((await store.get('folder/b'))?.buffer.toString()).toBe('replacement')
    expect((await store.list('folder/', 'folder/a')).objects).toEqual([{ name: 'folder/b', size: Buffer.byteLength('replacement') }])
    const files = await fs.readdir(store.root)
    expect(files).toHaveLength(2)
    expect(files.every(file => /^[a-f0-9]{64}\.object$/.test(file))).toBe(true)
    if (process.platform !== 'win32') expect((await fs.stat(path.join(store.root, files[0]!))).mode & 0o777).toBe(0o600)
  })
  it('rejects traversal keys and a symlinked storage root', async () => {
    for (const invalid of ['../private', '/absolute', 'a/../b', 'a//b', 'a\\b', 'a\0b']) {
      expect(() => validateObjectKey(invalid)).toThrow('invalid_object_key')
    }
    expect(() => new LocalObjectStore('relative')).toThrow()
    await fs.mkdir(path.join(root, 'real'))
    const linked = path.join(root, 'link')
    await fs.symlink(path.join(root, 'real'), linked, 'junction')
    await expect(new LocalObjectStore(linked).put(key, bytes, upload.contentType)).rejects.toThrow('unsafe_local_storage_root')
    expect(await fs.readdir(path.join(root, 'real'))).toEqual([])
  })
  it('rejects symlink objects and detects corrupted payloads', async () => {
    await store.put(key, bytes, upload.contentType)
    const file = path.join(store.root, (await fs.readdir(store.root))[0]!)
    const content = await fs.readFile(file)
    content[content.length - 1] = content[content.length - 1]! ^ 1
    await fs.writeFile(file, content)
    await expect(store.get(key)).rejects.toThrow('local_object_hash_mismatch')
    await fs.unlink(file)
    await fs.writeFile(path.join(root, 'outside'), 'not an object')
    await fs.symlink(path.join(root, 'outside'), file)
    await expect(store.get(key)).rejects.toThrow()
    expect(await fs.readFile(path.join(root, 'outside'), 'utf8')).toBe('not an object')
  })
})

describe('local object transfer capabilities', () => {
  it('binds method, expiry, instance secret, content type, bytes and object key', () => {
    const url = new URL(signLocalStorageUrl(key, 'PUT', 60, upload))
    const token = url.searchParams.get('capability')!
    expect(verifyLocalStorageCapability(token, 'PUT')).toMatchObject({ key, ...upload })
    expect(verifyLocalStorageCapability(token, 'GET')).toBeNull()
    expect(verifyLocalStorageCapability(`${token}tampered`, 'PUT')).toBeNull()
    expect(verifyLocalStorageCapability(token, 'PUT', Math.floor(Date.now() / 1000) + 61)).toBeNull()
    vi.stubEnv('SHENNIAN_STORAGE_SIGNING_SECRET', 'different-unit-signing-secret-not-real')
    expect(verifyLocalStorageCapability(token, 'PUT')).toBeNull()
    vi.stubEnv('SHENNIAN_STORAGE_SIGNING_SECRET', '')
    expect(() => signLocalStorageUrl(key, 'GET', 60)).toThrow('local_storage_signing_secret_required')
  })
  it('uploads and downloads verified private bytes through the real route handlers', async () => {
    app = Fastify()
    await app.register(localStorageRoutes)
    const url = relative(signLocalStorageUrl(key, 'PUT', 60, upload))
    const result = await app.inject({ method: 'PUT', url, payload: bytes, headers: { 'content-type': upload.contentType } })
    expect(result.statusCode).toBe(204)
    const download = await app.inject({ method: 'GET', url: relative(signLocalStorageUrl(key, 'GET', 60)) })
    expect(download.statusCode).toBe(200)
    expect(download.rawPayload).toEqual(bytes)
    expect(download.headers['cache-control']).toBe('private, no-store')
    expect(download.headers['x-content-type-options']).toBe('nosniff')
    expect(download.headers['content-disposition']).toBe('attachment')
    const noCapability = await app.inject({ method: 'GET', url: '/storage/local/object' })
    expect(noCapability.statusCode).toBe(403)
    const wrongMethod = await app.inject({ method: 'GET', url })
    expect(wrongMethod.statusCode).toBe(403)
  })
  it('rejects invalid uploads before storing an object and does not expose paths', async () => {
    app = Fastify()
    await app.register(localStorageRoutes)
    const url = relative(signLocalStorageUrl(key, 'PUT', 60, upload))
    for (const input of [
      { payload: Buffer.from('invalid'), headers: { 'content-type': upload.contentType } },
      { payload: bytes, headers: { 'content-type': 'text/plain' } },
    ]) {
      const result = await app.inject({ method: 'PUT', url, ...input })
      expect(result.statusCode).toBe(400)
      expect(result.body).not.toContain(root)
    }
    expect(await store.get(key)).toBeNull()
    vi.stubEnv('SHENNIAN_STORAGE_PROVIDER', 'oss')
    const response = await app.inject({ method: 'PUT', url, payload: bytes })
    expect(response.statusCode).toBe(404)
  })
  it('does not expose the disk path when an object record is unsafe', async () => {
    app = Fastify()
    await app.register(localStorageRoutes)
    await store.put(key, bytes, upload.contentType)
    const filename = path.join(store.root, (await fs.readdir(store.root))[0]!)
    await fs.writeFile(filename, 'broken record')
    const result = await app.inject({ method: 'GET', url: relative(signLocalStorageUrl(key, 'GET', 60)) })
    expect(result.statusCode).toBe(500)
    expect(result.json()).toEqual({ error: 'local_storage_failed' })
    expect(result.body).not.toContain(root)
  })
})
