// @arch docs/architecture/interactive-web-agent-and-versioning.md
import { authApi } from '../../config/api'
import type { ContentSaveMetadata, RuntimeObservation } from './contentRuntimeTypes'
import type { ContentDocument, ContentJob, ContentPosition } from './contentSession'
const base = '/interactive-content'
const post = <T>(path: string, value: object, timeoutMs?: number) => authApi<T>(base + path, { method: 'POST', body: JSON.stringify(value) }, { timeoutMs })
export type ContentCard = { workId: string; versionId: string | null; title: string; summary: string;
  headRevision: number; creatorId: string; published: boolean }
export type CollectionKind = 'works' | 'interactions' | 'recent'
export type ContentReceipt = { requestId: string; workId: string; kind: ContentJob['kind']; status: string }
export type TurnReceipt = { text: string; jobs: ContentReceipt[];
  viewer: { workId: string; versionId: string | null; followCurrent: boolean } | null; searchQueue: string[]; observationRequestRef?: string | null; observationPart?: 'state' | 'methods'; pageInvocation?: { name: string; args: Record<string, unknown>; versionRef: string } | null }
export const contentClient = {
  capabilities: () => authApi<{ ready: boolean; imageGeneration: boolean }>(base + '/capabilities'),
  feed: (after?: string) => authApi<{ works: Array<{ id: string }>; nextCursor: string | null }>(base + '/feed' + (after ? `?after=${encodeURIComponent(after)}` : '')),
  document: (id: string, versionId?: string) => authApi<ContentDocument & { currentVersionId: string; shareUrl: string }>(
    `${base}/document/${encodeURIComponent(id)}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`),
  head: (id: string) => authApi<{ currentVersionId: string; headRevision: number; updating: boolean }>(`${base}/head/${encodeURIComponent(id)}`),
  context: (input: { mountId: string; viewEpoch: number } & { workId: string | null; versionId: string | null; followCurrent: boolean }) => post<{ contextRef: string }>('/context', input),
  turn: (input: { text: string; contextRef: string; requestKey: string; resourceIds: string[]; source: 'user' | 'page'; observationRef?: string; observation?: RuntimeObservation }) => post<TurnReceipt>('/turn', input, 65000),
  save: (input: { contextRef: string; requestKey: string; html: string; metadata?: ContentSaveMetadata }) => post<ContentReceipt>('/save', input),
  jobs: (ids: string[] = []) => authApi<{ jobs: ContentReceipt[] }>(`${base}/jobs${ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : ''}`),
  upload: (contentType: string, base64: string) => post<{ id: string; url: string }>('/assets', { contentType, base64 }),
  viewed: (id: string) => post('/view/' + encodeURIComponent(id), {}),
  publish: (document: ContentDocument) => post('/publish/' + encodeURIComponent(document.workId), { expectedHeadRevision: document.headRevision }),
  delete: (id: string) => authApi(base + '/works/' + encodeURIComponent(id), { method: 'DELETE' }),
  collection: (kind: CollectionKind, offset = 0) => authApi<{ works: ContentCard[]; nextOffset: number | null }>(`${base}/collection?kind=${kind}&offset=${offset}`),
}
export const contentPositionBody = (position: ContentPosition | null) => ({ workId: position?.workId ?? null,
  versionId: position?.versionId ?? null, followCurrent: position?.followCurrent ?? true })

/** Bounded account-scoped lookahead; disk entries are public, short-lived and head-revalidated. */
export function createContentDocumentLoader(client = contentClient, storage?: { read(): Promise<string | null>; write(value: string): Promise<unknown> }) {
  type Document = Awaited<ReturnType<typeof client.document>>
  const cache = new Map<string, Document>()
  const pending = new Map<string, Promise<Document>>()
  let epoch = 0
  let hydrated = false
  let hydration: Promise<void> | null = null
  const hydrate = () => {
    if (hydrated || !storage) return Promise.resolve()
    if (hydration) return hydration
    const started = epoch
    const task = (async () => {
      try {
        const raw = await storage.read()
        if (!raw || raw.length > 1_000_000 || started !== epoch) return
        const saved = JSON.parse(raw)
        if (!Number.isFinite(saved.at) || Date.now() - saved.at > 300_000 || saved.at > Date.now() || !Array.isArray(saved.documents)) return
        for (const d of saved.documents.slice(-4)) {
          if (d.published === true && typeof d.workId === 'string' && typeof d.versionId === 'string'
            && typeof d.html === 'string' && d.html.length <= 120000 && typeof d.title === 'string'
            && typeof d.summary === 'string' && typeof d.creatorId === 'string' && Number.isInteger(d.headRevision)
            && Array.isArray(d.resourceOrigins) && d.resourceOrigins.every((v: unknown) => typeof v === 'string') && !cache.has(d.workId)) cache.set(d.workId, d)
        }
        while (cache.size > 4) cache.delete(cache.keys().next().value!)
      } catch { /* A corrupt/expired device cache is never required for opening content. */ }
    })().finally(() => { if (started === epoch) { hydrated = true; hydration = null } })
    hydration = task
    return task
  }
  const fetch = (id: string) => {
    const running = pending.get(id)
    if (running) return running
    const started = epoch
    const task = client.document(id).then((document) => {
      if (started === epoch) {
        cache.delete(id); cache.set(id, document)
        if (cache.size > 4) cache.delete(cache.keys().next().value!)
        if (storage) void storage.write(JSON.stringify({ at: Date.now(), documents: [...cache.values()].filter((d) => d.published) })).catch(() => {})
      }
      return document
    }).finally(() => { if (pending.get(id) === task) pending.delete(id) })
    pending.set(id, task)
    return task
  }
  return {
    clear() { epoch++; hydrated = false; hydration = null; cache.clear(); pending.clear() },
    prefetch(ids: string[]) { for (const id of ids.slice(0, 2)) if (!cache.has(id)) void fetch(id).catch(() => {}) },
    async load(id: string, versionId?: string) {
      if (versionId) return client.document(id, versionId)
      await hydrate()
      const running = pending.get(id)
      const stored = cache.get(id) || (running ? await running : undefined)
      if (stored) {
        const head = await client.head(id)
        if (stored.published && head.headRevision === stored.headRevision && head.currentVersionId === stored.versionId) return stored
      }
      return fetch(id)
    },
  }
}
