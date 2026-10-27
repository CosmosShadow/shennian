// @covers packages/app/src/features/personal-workspace/diarySync.ts
// @covers packages/app/src/features/personal-workspace/diaryStore.ts
// @covers packages/app/src/features/personal-workspace/diaryRuntime.ts
// @covers packages/app/src/features/personal-workspace/DiaryScreen.tsx
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceResponse } from '../features/personal-workspace/client'
import { syncDiary, type DiaryDocument, type DiaryStore } from '../features/personal-workspace/diarySync'
const scope = 'alice/mac/revision-1'
const document = { path: '2026/2026-10-23.md', date: '2026-10-23', title: 'Today', content: 'body', revision: 'v1' }
function fixture() {
  const data = new Map<string, Map<string, DiaryDocument>>()
  const store: DiaryStore = {
    list: async key => [...(data.get(key)?.values() ?? [])],
    put: async (key, doc) => { if (!data.has(key)) data.set(key, new Map()); data.get(key)!.set(doc.path, doc) },
    retain: async (key, paths) => { for (const path of data.get(key)?.keys() ?? []) if (!paths.includes(path)) data.get(key)!.delete(path) },
  }
  const request = vi.fn(async (p: { action: string }): Promise<WorkspaceResponse> => p.action === 'info' ? { diarySync: 1, diaryEdit: 1 } : p.action === 'diary' ? { snapshot: 's1', entries: [document], nextOffset: null } : document)
  return { store, request }
}
describe('computer-authoritative diary replica', () => {
  it('persists bodies, skips unchanged downloads, updates changed files, and reconciles deletions', async () => {
    const { store, request } = fixture(), changed = vi.fn()
    expect(await syncDiary(store, scope, request, () => true, changed)).toEqual({ editable: true })
    expect(await store.list(scope)).toEqual([document]); expect(changed).toHaveBeenCalled()
    request.mockClear()
    await syncDiary(store, scope, request, () => true, changed)
    expect(request.mock.calls.filter(([p]) => p.action === 'read')).toHaveLength(0)
    request.mockImplementation(async p => p.action === 'info' ? { diarySync: 1, diaryEdit: 1 } : p.action === 'diary' ? { snapshot: 's2', entries: [], nextOffset: null } : document)
    await syncDiary(store, scope, request, () => true, changed)
    expect(await store.list(scope)).toEqual([])
  })
  it('downloads changed bodies and traverses multiple stable pages without refetching unchanged entries', async () => {
    const { store, request } = fixture()
    await store.put(scope, document)
    const second = { ...document, path: '2026/2026-10-22.md', revision: 'v2', content: 'new body' }
    request.mockImplementation(async p => {
      if (p.action === 'info') return { diarySync: 1, diaryEdit: 1 }
      if (p.action === 'read') return second
      return (p as { offset?: number }).offset === 30 ? { snapshot: 's1', entries: [second], nextOffset: null } : { snapshot: 's1', entries: [document], nextOffset: 30 }
    })
    await syncDiary(store, scope, request, () => true, () => {})
    expect(await store.list(scope)).toEqual([document, second])
    expect(request.mock.calls.filter(([p]) => p.action === 'read')).toHaveLength(1)
  })
  it('isolates accounts, machines, and primary-setting revisions', async () => {
    const { store, request } = fixture()
    await syncDiary(store, scope, request, () => true, () => {})
    for (const other of ['bob/mac/revision-1', 'alice/pc/revision-1', 'alice/mac/revision-2']) expect(await store.list(other)).toEqual([])
  })
  it('preserves cached entries on disconnect or a changed body instead of accepting partial deletion', async () => {
    const { store, request } = fixture()
    await store.put(scope, document)
    request.mockImplementation(async p => {
      if (p.action === 'info') return { diarySync: 1, diaryEdit: 1 }
      if (p.action === 'diary') return { snapshot: 's2', entries: [{ ...document, revision: 'v2' }], nextOffset: null }
      throw new Error('offline')
    })
    await expect(syncDiary(store, scope, request, () => true, () => {})).rejects.toThrow('offline')
    expect(await store.list(scope)).toEqual([document])
    request.mockImplementation(async p => p.action === 'info' ? { diarySync: 1, diaryEdit: 1 } : p.action === 'diary' ? { snapshot: 's2', entries: [{ ...document, revision: 'v2' }], nextOffset: null } : document)
    await expect(syncDiary(store, scope, request, () => true, () => {})).rejects.toThrow('personal_file_changed')
    expect(await store.list(scope)).toEqual([document])
  })
  it('refuses deletion when pages shift or the final manifest changed', async () => {
    const { store, request } = fixture(); await store.put(scope, document)
    let pages = 0
    request.mockImplementation(async p => p.action === 'info' ? { diarySync: 1, diaryEdit: 1 } : { snapshot: ++pages === 1 ? 'before' : 'after', entries: [], nextOffset: null })
    await expect(syncDiary(store, scope, request, () => true, () => {})).rejects.toThrow('personal_file_changed')
    expect(await store.list(scope)).toEqual([document])
  })
  it('discards late requests after account/target changes and rejects unsupported Clients', async () => {
    const { store, request } = fixture()
    let active = true
    request.mockImplementation(async p => { if (p.action === 'info') return { diarySync: 1, diaryEdit: 1 }; if (p.action === 'diary') return { snapshot: 's1', entries: [document], nextOffset: null }; active = false; return document })
    await syncDiary(store, scope, request, () => active, () => {})
    expect(await store.list(scope)).toEqual([])
    request.mockResolvedValue({})
    await expect(syncDiary(store, scope, request, () => true, () => {})).rejects.toThrow('personal_client_upgrade_required')
  })
})
