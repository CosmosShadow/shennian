// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-object-store.test.ts
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const MAX_LOCAL_OBJECT_BYTES = 100 * 1024 * 1024
const MAX_HEADER_BYTES = 8192
type Header = { v: 1; key: string; contentType: string; sha256: string; byteSize: number }

export function validateObjectKey(key: string): void {
  if (!key || Buffer.byteLength(key) > 1024 || /[\\\x00-\x1f\x7f]/.test(key) ||
    key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('invalid_object_key')
}

/** One atomic private record per object. User keys never become filesystem paths. */
export class LocalObjectStore {
  readonly root: string
  constructor(root: string) {
    if (!path.isAbsolute(root) || path.resolve(root) === path.parse(path.resolve(root)).root) throw new Error('local_storage_requires_absolute_path')
    this.root = path.resolve(root)
  }

  private async ready(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
    const stat = await fs.lstat(this.root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_local_storage_root')
  }

  private filename(key: string): string {
    validateObjectKey(key)
    return `${createHash('sha256').update(key).digest('hex')}.object`
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<number> {
    const filename = this.filename(key)
    if (buffer.length > MAX_LOCAL_OBJECT_BYTES || !contentType || contentType.length > 255 ||
      /[\x00-\x1f\x7f]/.test(contentType)) throw new Error('invalid_local_object')
    await this.ready()
    const header: Header = {
      v: 1, key, contentType, byteSize: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    }
    const json = Buffer.from(JSON.stringify(header))
    const prefix = Buffer.alloc(4)
    prefix.writeUInt32BE(json.length)
    if (json.length > MAX_HEADER_BYTES) throw new Error('invalid_local_object')
    const tmp = path.join(this.root, `${randomUUID()}.tmp`)
    const handle = await fs.open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(Buffer.concat([prefix, json, buffer]))
      await handle.sync()
      await handle.close()
      await fs.rename(tmp, path.join(this.root, filename))
      // Persist the rename on filesystems supporting directory fsync.
      if (process.platform !== 'win32') {
        const directory = await fs.open(this.root, constants.O_RDONLY)
        try { await directory.sync() } finally { await directory.close() }
      }
    } finally {
      await handle.close().catch(() => {})
      await fs.unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    return buffer.length
  }

  private async readRecord(key: string, includeBody: boolean) {
    const filename = this.filename(key)
    await this.ready()
    let handle
    try {
      const before = await fs.lstat(path.join(this.root, filename))
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('invalid_local_object_record')
      handle = await fs.open(path.join(this.root, filename), constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size < 4 || stat.size > MAX_LOCAL_OBJECT_BYTES + MAX_HEADER_BYTES + 4) {
        throw new Error('invalid_local_object_record')
      }
      const prefix = Buffer.alloc(4)
      if ((await handle.read(prefix, 0, 4, 0)).bytesRead !== 4) throw new Error('invalid_local_object_record')
      const length = prefix.readUInt32BE()
      if (length < 1 || length > MAX_HEADER_BYTES || length + 4 > stat.size) throw new Error('invalid_local_object_record')
      const json = Buffer.alloc(length)
      if ((await handle.read(json, 0, length, 4)).bytesRead !== length) throw new Error('invalid_local_object_record')
      const header = JSON.parse(json.toString()) as Header
      if (header.v !== 1 || header.key !== key || !Number.isSafeInteger(header.byteSize) || header.byteSize < 0 || header.byteSize > MAX_LOCAL_OBJECT_BYTES ||
        header.byteSize !== stat.size - length - 4 || typeof header.contentType !== 'string' ||
        !header.contentType || header.contentType.length > 255 || /[\x00-\x1f\x7f]/.test(header.contentType) ||
        !/^[a-f0-9]{64}$/.test(header.sha256)) throw new Error('invalid_local_object_record')
      let buffer: Buffer | undefined
      if (includeBody) {
        buffer = Buffer.alloc(header.byteSize)
        let offset = 0
        while (offset < buffer.length) {
          const read = await handle.read(buffer, offset, buffer.length - offset, 4 + length + offset)
          if (!read.bytesRead) throw new Error('invalid_local_object_record')
          offset += read.bytesRead
        }
        if (createHash('sha256').update(buffer).digest('hex') !== header.sha256) throw new Error('local_object_hash_mismatch')
      }
      return { header, buffer }
    } finally { await handle.close() }
  }

  async get(key: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const record = await this.readRecord(key, true)
    return record ? { buffer: record.buffer!, mimeType: record.header.contentType } : null
  }

  async head(key: string) {
    const record = await this.readRecord(key, false)
    return record ? {
      byteSize: record.header.byteSize, contentType: record.header.contentType, sha256: record.header.sha256,
    } : null
  }

  async delete(key: string): Promise<void> {
    const filename = this.filename(key)
    await this.ready()
    try { await fs.unlink(path.join(this.root, filename)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }

  async list(prefix: string, marker?: string | null) {
    if (prefix && prefix !== '/') validateObjectKey(prefix.replace(/\/$/, ''))
    await this.ready()
    const keys: Array<{ name: string; size: number }> = []
    for (const file of await fs.readdir(this.root)) {
      if (!/^[a-f0-9]{64}\.object$/.test(file)) continue
      const stat = await fs.lstat(path.join(this.root, file))
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_local_object_record')
      // Read just the header via a bounded, no-follow handle; never load every body.
      const handle = await fs.open(path.join(this.root, file), constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
      let key: string
      let size: number
      try {
        if (!(await handle.stat()).isFile()) throw new Error('invalid_local_object_record')
        const data = Buffer.alloc(MAX_HEADER_BYTES + 4)
        const { bytesRead } = await handle.read(data, 0, data.length, 0)
        if (bytesRead < 4) throw new Error('invalid_local_object_record')
        const length = data.readUInt32BE()
        if (length < 1 || length > MAX_HEADER_BYTES || length + 4 > bytesRead) throw new Error('invalid_local_object_record')
        const header = JSON.parse(data.subarray(4, 4 + length).toString()) as Header
        key = header.key
        size = header.byteSize
        if (header.v !== 1 || this.filename(key) !== file || !Number.isSafeInteger(size) || size < 0 ||
          size > MAX_LOCAL_OBJECT_BYTES || stat.size !== length + 4 + size) throw new Error('invalid_local_object_record')
      } finally { await handle.close() }
      if (key.startsWith(prefix) && (!marker || key > marker)) keys.push({ name: key, size })
    }
    keys.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    const page = keys.slice(0, 1000)
    return { objects: page, nextMarker: keys.length > 1000 ? page.at(-1)!.name : null, isTruncated: keys.length > 1000 }
  }
}
