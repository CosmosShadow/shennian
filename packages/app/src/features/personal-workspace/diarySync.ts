// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-sync.test.ts
import type { WorkspaceEntry, WorkspaceResponse } from './client'
export type DiaryEntry = WorkspaceEntry & { revision: string; characterCount?: number; photoCount?: number }
export type DiaryDocument = DiaryEntry & { content: string }
export interface DiaryStore {
  list(scope: string): Promise<DiaryEntry[]>
  put(scope: string, document: DiaryDocument): Promise<void>
  retain(scope: string, paths: string[]): Promise<void>
}
export type DiaryRequest = (params: { action: 'info' | 'diary' | 'read'; kind?: 'diary'; path?: string; offset?: number }) => Promise<WorkspaceResponse>
/** No removal until every page and body has been verified against one stable manifest. */
export async function syncDiary(store: DiaryStore, scope: string, request: DiaryRequest, active: () => boolean, changed: () => void) {
  const info = await request({ action: 'info' })
  if (info.diarySync !== 1) throw new Error('personal_client_upgrade_required')
  const local = new Map((await store.list(scope)).map(d => [d.path, d]))
  const paths: string[] = []
  let offset = 0, snapshot: string | undefined
  do {
    if (!active()) return
    const page = await request({ action: 'diary', kind: 'diary', offset })
    if (!page.snapshot || !Array.isArray(page.entries)) throw new Error('personal_client_upgrade_required')
    if (snapshot && page.snapshot !== snapshot) throw new Error('personal_file_changed')
    snapshot = page.snapshot
    for (const entry of page.entries) {
      if (!active()) return
      if (!entry.revision) throw new Error('personal_unavailable')
      paths.push(entry.path)
      if (local.get(entry.path)?.revision === entry.revision) continue
      const body = await request({ action: 'read', kind: 'diary', path: entry.path })
      if (body.revision !== entry.revision || typeof body.content !== 'string') throw new Error('personal_file_changed')
      if (!active()) return
      await store.put(scope, { ...entry, content: body.content, revision: entry.revision })
      if (active()) changed()
    }
    if (page.nextOffset == null) break
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error('personal_unavailable')
    offset = page.nextOffset
  } while (active())
  if (!active()) return
  const check = await request({ action: 'diary', kind: 'diary', offset: 0 })
  if (check.snapshot !== snapshot) throw new Error('personal_file_changed')
  if (!active()) return
  await store.retain(scope, paths)
  if (active()) changed()
  return { editable: info.diaryEdit === 1, directory: info.diary ?? undefined }
}
