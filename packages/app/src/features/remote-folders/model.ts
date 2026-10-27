// @arch docs/architecture/remote-folders.md
// @test packages/app/src/__tests__/remote-folders.test.ts
import type { Machine } from '@shennian/wire'
import type { SendFn } from '../../components/chat/fileOperations'

export type RemoteFolder = { machineId: string; path: string; showInFeatures?: boolean }
export const folderKey = (folder: RemoteFolder) => JSON.stringify([folder.machineId, normalize(folder.path)])
export const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
export const canBrowseFolders = (machine: Machine | undefined) => Boolean(
  machine?.paired && machine.role !== 'granted' && !machine.remoteAccessDisabledAt,
)
function normalize(path: string): string {
  const windows = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path)
  const result = windows ? path.replace(/\\/g, '/').toLowerCase() : path
  return result.replace(/\/+$/, '') || '/'
}
export function isFolderPath(path: unknown): path is string {
  return typeof path === 'string' && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path) &&
    !/[\x00-\x1f]/.test(path) && !path.split(/[\\/]/).some(part => part === '..' || part === '.')
}
export function parseFolders(raw: string | null): RemoteFolder[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    if (!Array.isArray(value)) return []
    const unique = new Map<string, RemoteFolder>()
    for (const entry of value) {
      if (!entry || typeof entry.machineId !== 'string' || !entry.machineId || !isFolderPath(entry.path)) continue
      const folder: RemoteFolder = { machineId: entry.machineId, path: entry.path, ...(entry.showInFeatures === true ? { showInFeatures: true } : {}) }
      unique.set(folderKey(folder), folder)
    }
    return [...unique.values()]
  } catch { return [] }
}

/** Navigation guard, not a new grant. The daemon still enforces realpath/root authorization. */
export function createFolderSend(
  folder: RemoteFolder,
  send: SendFn,
  available: () => boolean,
  error: string,
  allowUpload = false,
): SendFn {
  const transfers = new Set<string>()
  const withinRoot = (path: unknown) => {
    const root = normalize(folder.path)
    const candidate = typeof path === 'string' ? normalize(path) : ''
    return (
      isFolderPath(path) &&
      (candidate === root || candidate.startsWith(root === '/' ? '/' : root + '/'))
    )
  }
  return async (frame) => {
    if (!available()) throw new Error(error)
    if (allowUpload && frame.method === 'fs.transfer.start') {
      const { targetPath, name } = frame.params
      if (
        !withinRoot(targetPath) ||
        typeof name !== 'string' ||
        !name ||
        /[\\/:\x00-\x1f]/.test(name) ||
        name === '.' ||
        name === '..'
      )
        throw new Error(error)
      const result = await send({
        ...frame,
        params: { ...frame.params, rootPath: folder.path, direct: true },
      })
      const id = (result.payload as { transferId?: string } | undefined)?.transferId
      if (result.ok && typeof id === 'string' && id) transfers.add(id)
      return result
    }
    if (
      allowUpload &&
      ['fs.transfer.chunk', 'fs.transfer.finish', 'fs.transfer.abort'].includes(frame.method)
    ) {
      const id = frame.params.transferId
      if (typeof id !== 'string' || !transfers.has(id) || frame.params.relativePath != null)
        throw new Error(error)
      const result = await send(frame)
      if (result.ok && frame.method !== 'fs.transfer.chunk') transfers.delete(id)
      return result
    }
    if (!['fs.ls', 'fs.read'].includes(frame.method) || !withinRoot(frame.params.path))
      throw new Error(error)
    return send({ ...frame, params: { ...frame.params, rootPath: folder.path } })
  }
}

export interface FolderStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}
/** Serialized read-modify-write preserves concurrent adds/removes; scoped to this account/device. */
export function createFolderRepository(storage: FolderStorage) {
  let queue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<(accountId: string) => void>()
  const key = (accountId: string) => 'shennian:remoteFolders:' + encodeURIComponent(accountId)
  const read = async (accountId: string) => parseFolders(await storage.getItem(key(accountId)))
  return {
    subscribe(listener: (accountId: string) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    read: (accountId: string) => queue.catch(() => {}).then(() => read(accountId)),
    change(accountId: string, folder: RemoteFolder, remove = false): Promise<RemoteFolder[]> {
      const result = queue.catch(() => {}).then(async () => {
        if (!accountId || !isFolderPath(folder.path) || !folder.machineId) throw new Error('invalid_folder')
        const previous = await read(accountId)
        const next = previous.filter(entry => folderKey(entry) !== folderKey(folder))
        if (!remove) next.push(folder)
        await storage.setItem(key(accountId), JSON.stringify(next))
        listeners.forEach(listener => listener(accountId))
        return next
      })
      queue = result
      return result
    },
  }
}
