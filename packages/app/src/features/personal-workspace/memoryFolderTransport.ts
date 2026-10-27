// @arch docs/features/personal-agent-workspace.md
// @test packages/app/src/__tests__/memory-folder.test.ts
import type { FsEntry } from '@shennian/wire'
import type { SendFn } from '../../components/chat/fileOperations'
import type { personalWorkspaceClient } from './client'

/** Adapt the existing read-only memory boundary to the shared browser, not a second UI. */
export function createMemoryFolderSend({ rootPath, revision, request, available }: {
  rootPath: string
  revision: number
  request: typeof personalWorkspaceClient
  available: () => boolean
}): SendFn {
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const relative = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('personal_path_forbidden')
    const path = value.replace(/\\/g, '/').replace(/\/+$/, '')
    if (path === root) return ''
    if (!path.startsWith(root + '/')) throw new Error('personal_path_forbidden')
    const rel = path.slice(root.length + 1)
    if (rel.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('personal_path_forbidden')
    return rel
  }
  const call: typeof request = async params => {
    if (!available()) throw new Error('personal_primary_unavailable')
    const result = await request({ ...params, kind: 'memory', expectedPrimaryRevision: revision })
    if (!available()) throw new Error('personal_primary_unavailable')
    return result
  }
  return async frame => {
    const path = relative(frame.params.path)
    if (frame.method === 'fs.ls') {
      const entries: FsEntry[] = []
      let offset = 0
      do {
        const page = await call({ action: 'list', path, offset })
        for (const entry of page.entries ?? []) {
          const fullPath = `${root}/${entry.path}`
          relative(fullPath)
          entries.push({ name: entry.name || entry.path.split('/').pop()!, path: fullPath, isDir: !!entry.isDir })
        }
        if (page.nextOffset == null) break
        if (page.nextOffset <= offset || page.nextOffset > 10000) throw new Error('personal_unavailable')
        offset = page.nextOffset
      } while (offset <= 10000)
      return { type: 'res', id: 'memory-browser', ok: true, payload: { path: root + (path ? '/' + path : '') || '/', entries } }
    }
    if (frame.method !== 'fs.read') throw new Error('personal_path_forbidden')
    const result = await call({ action: 'read', path })
    const content = result.content ?? ''
    if (frame.params.encoding !== 'base64') return { type: 'res', id: 'memory-browser', ok: true, payload: { content } }
    // Downloads still pass through the same text-only/size-limited backend boundary.
    const bytes = new TextEncoder().encode(content)
    const offset = Number(frame.params.offset ?? 0)
    const length = Number(frame.params.length ?? bytes.length)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0)
      throw new Error('personal_path_forbidden')
    const chunk = bytes.slice(offset, offset + length)
    let binary = ''
    for (const byte of chunk) binary += String.fromCharCode(byte)
    return { type: 'res', id: 'memory-browser', ok: true, payload: { data: btoa(binary), length: chunk.length, totalSize: bytes.length } }
  }
}
