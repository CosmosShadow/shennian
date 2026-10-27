// @arch docs/architecture/interactive-web-agent-and-versioning.md
// @test src/__tests__/interactive-content-session.test.ts
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppState } from 'react-native'
import * as Crypto from 'expo-crypto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuthStore } from '../../config/auth'
import type { ContentSaveMetadata, RuntimeObservation } from './contentRuntimeTypes'
import { contentClient, createContentDocumentLoader, contentPositionBody, type ContentReceipt } from './contentClient'
import { emptyContentSession, reduceContentSession, selectedDocument, type ContentDocument, type ContentJob } from './contentSession'

const accountDocuments = (actor: string) => createContentDocumentLoader(contentClient, actor ? {
  read: () => AsyncStorage.getItem(`content:documents:v1:${actor}`),
  write: (value) => AsyncStorage.setItem(`content:documents:v1:${actor}`, value),
} : undefined)

export function useContentRuntime(initialWorkId?: string, observe?: (part?: 'state' | 'methods') => Promise<RuntimeObservation>, invoke?: (name: string, args: Record<string, unknown>) => Promise<void>) {
  const { t } = useTranslation()
  const loadedAccount = useRef('')
  const accountId = useAuthStore((s) => s.user?.id ?? '')
  const [session, dispatch] = useReducer(reduceContentSession, undefined, emptyContentSession)
  const state = useRef(session); state.current = session
  const [ready, setReady] = useState(false)
  const [booting, setBooting] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const publishBusy = useRef(false)
  const [feedback, setFeedback] = useState('')
  const [surfaceReset, setSurfaceReset] = useState(0)
  const [neighbors, setNeighbors] = useState<{ centerId: string; previous?: ContentDocument; next?: ContentDocument }>({ centerId: '' })
  const preparing = useRef(0)
  const preparingFeed = useRef<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [mountId] = useState(() => Crypto.randomUUID())
  const queue = useRef<string[]>([])
  const documents = useRef(accountDocuments(accountId))
  const documentAccount = useRef(accountId)
  if (documentAccount.current !== accountId) {
    documents.current.clear(); documents.current = accountDocuments(accountId); documentAccount.current = accountId
  }
  const feedCursor = useRef<string | null>(null)
  const navigating = useRef(0)
  const sending = useRef(false)
  const scope = useRef(accountId)
  if (scope.current !== accountId) { scope.current = accountId; loadedAccount.current = '' }
  const alive = useRef(true)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = useCallback((text: string) => {
    if (!alive.current) return
    setFeedback(text)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(''), 5000)
  }, [])
  const prepareNeighbors = useCallback(function prepare(workId: string, actor: string, leaving = selectedDocument(state.current)): void {
    const token = ++preparing.current
    const index = queue.current.indexOf(workId)
    const previousId = queue.current[index - 1], nextId = queue.current[index + 1]
    setNeighbors((old) => {
      const known = [leaving, old.previous, old.next].filter((doc): doc is ContentDocument => Boolean(doc))
      return { centerId: workId, previous: known.find((doc) => doc.workId === previousId), next: known.find((doc) => doc.workId === nextId) }
    })
    const cursor = feedCursor.current
    if (cursor && index >= queue.current.length - 2 && preparingFeed.current !== cursor) {
      preparingFeed.current = cursor
      void contentClient.feed(cursor).then((feed) => {
        if (!alive.current || actor !== scope.current || feedCursor.current !== cursor) return
        queue.current = [...new Set([...queue.current, ...feed.works.map((item) => item.id)])]
        feedCursor.current = feed.nextCursor
        const currentId = state.current.position?.workId
        if (currentId) prepare(currentId, actor)
      }).catch(() => {}).finally(() => { if (preparingFeed.current === cursor) preparingFeed.current = null })
    }
    for (const [side, id] of [['previous', previousId], ['next', nextId]] as const) {
      if (!id) continue
      void documents.current.load(id).then((document) => {
        if (alive.current && actor === scope.current && token === preparing.current) setNeighbors((old) => old.centerId === workId ? { ...old, [side]: document } : old)
      }).catch(() => { // Missing/deleted neighbors are not shown from an old preview.
        if (alive.current && actor === scope.current && token === preparing.current) setNeighbors((old) => old.centerId === workId ? { ...old, [side]: undefined } : old)
      })
    }
  }, [])
  const open = useCallback(async (workId: string, versionId?: string, followCurrent = true) => {
    const navigation = ++navigating.current, actor = scope.current
    const document = await documents.current.load(workId, versionId)
    if (!alive.current || navigation !== navigating.current || actor !== scope.current) return
    const leaving = selectedDocument(state.current)
    dispatch({ type: 'headChanged', document })
    dispatch({ type: 'open', position: { workId, versionId: document.versionId, followCurrent } })
    if (!queue.current.includes(workId)) queue.current.unshift(workId)
    dispatch({ type: 'dismissCompletion' })
    prepareNeighbors(workId, actor, leaving)
    setUpdating(false)
  }, [prepareNeighbors])
  useEffect(() => {
    alive.current = true
    let active = true
    const actor = accountId
    preparing.current++; preparingFeed.current = null; setNeighbors({ centerId: '' })
    dispatch({ type: 'reset' }); setReady(false); setBooting(true); documents.current.clear(); queue.current = []; feedCursor.current = null; navigating.current++
    void (async () => {
      const capabilities = await contentClient.capabilities()
      if (!active) return
      if (!capabilities.ready) return
      // Recover jobs and fetch the first page concurrently, rather than blocking content on recovery.
      const [pending, activeJobs, feed] = await Promise.all([
        AsyncStorage.getItem(`content:pending:${actor}`), contentClient.jobs(),
        contentClient.feed(),
      ])
      if (!active || scope.current !== actor) return
      if (pending) {
        const jobs = JSON.parse(pending) as ContentJob[]
        for (const job of jobs.slice(0, 20)) {
          if (typeof job.id === 'string' && (job.kind === 'create' || job.kind === 'modify')) dispatch({ type: 'accepted', job })
        }
      }
      // Recover accepted jobs even when the app left before a foreground acknowledgement was stored.
      if (!active || scope.current !== actor) return
      for (const job of activeJobs.jobs) dispatch({ type: 'accepted', job: toJob(job) })
      loadedAccount.current = actor
      setReady(true)
      queue.current = feed.works.map((item) => item.id)
      feedCursor.current = feed.nextCursor
      if (initialWorkId) await open(initialWorkId)
      else {
        if (!active) return
        if (queue.current[0]) await open(queue.current[0])
      }
    })().catch(() => { if (active) setReady(false) }).finally(() => { if (active) setBooting(false) })
    return () => { active = false; alive.current = false; if (feedbackTimer.current) clearTimeout(feedbackTimer.current) }
  }, [accountId, initialWorkId, open])
  useEffect(() => {
    if (!session.completedWorkId) return
    const timer = setTimeout(() => dispatch({ type: 'dismissCompletion' }), 6000)
    return () => clearTimeout(timer)
  }, [session.completedWorkId])
  // Context refresh also invalidates unissued actions belonging to an older page.
  useEffect(() => {
    if (!ready || !accountId) return
    void contentClient.context({ mountId, viewEpoch: session.viewEpoch,
      ...contentPositionBody(session.position) }).catch(() => {})
  }, [ready, accountId, mountId, session.position, session.viewEpoch])
  useEffect(() => {
    if (!accountId || !ready || loadedAccount.current !== accountId) return
    void AsyncStorage.setItem(`content:pending:${accountId}`, JSON.stringify(session.jobs)).catch(() => {})
  }, [accountId, ready, session.jobs])
  useEffect(() => {
    if (!ready) return
    let polling = false, disposed = false
    const poll = async () => {
      if (polling || disposed || AppState.currentState !== 'active') return
      polling = true
      const snapshot = state.current
      try {
        if (snapshot.jobs.length) {
          const receipts = await contentClient.jobs(snapshot.jobs.map((job) => job.id))
          for (const receipt of receipts.jobs) {
            if (disposed) break
            if (receipt.status === 'completed') {
              const document = await contentClient.document(receipt.workId)
              if (!disposed) dispatch({ type: 'completed', jobId: receipt.requestId, document })
            } else if (['failed', 'invalidated', 'cancelled'].includes(receipt.status)) {
              dispatch({ type: 'settledWithoutResult', jobId: receipt.requestId })
              if (state.current.position?.workId === receipt.workId && state.current.position.followCurrent) await open(receipt.workId)
            }
          }
        }
        const position = state.current.position
        if (position?.followCurrent && !disposed) {
          const head = await contentClient.head(position.workId)
          if (state.current.position?.workId !== position.workId) return
          setUpdating(head.updating)
          const selected = selectedDocument(state.current)
          if (head.headRevision > (selected?.headRevision ?? -1)) {
            const document = await contentClient.document(position.workId)
            if (!disposed && state.current.position?.workId === position.workId && state.current.position.followCurrent) {
              dispatch({ type: 'headChanged', document })
            }
          }
        }
      } catch { /* Keep the last valid artifact; never synthesize a failure work. */ }
      finally { polling = false }
    }
    const timer = setInterval(() => { void poll() }, 2500)
    void poll()
    return () => { disposed = true; clearInterval(timer) }
  }, [ready, accountId, open])
  const submit = useCallback(async (text: string, resourceIds: string[] = [], source: 'user' | 'page' = 'user') => {
    if (!text.trim() || !ready || sending.current) return false
    sending.current = true; setSubmitting(true)
    const snapshot = state.current, actor = scope.current
    try {
      const { contextRef } = await contentClient.context({ mountId, viewEpoch: snapshot.viewEpoch, ...contentPositionBody(snapshot.position) })
      if (!alive.current || actor !== scope.current || state.current.viewEpoch !== snapshot.viewEpoch) return false
      const requestKey = Crypto.randomUUID()
      let result = await contentClient.turn({ text, contextRef, requestKey, resourceIds, source })
      for (let observationRound = 0; result.observationRequestRef && observationRound < 2; observationRound++) {
        if (!observe || state.current.viewEpoch !== snapshot.viewEpoch) return false
        const observation = await observe(result.observationPart)
        if (state.current.viewEpoch !== snapshot.viewEpoch) return false
        result = await contentClient.turn({ text, contextRef, requestKey: `${requestKey}:observe${observationRound}`, resourceIds, source, observationRef: result.observationRequestRef, observation })
      }
      if (result.observationRequestRef) throw new Error('observation_loop')
      if (result.pageInvocation) {
        if (!invoke || state.current.viewEpoch !== snapshot.viewEpoch || result.pageInvocation.versionRef !== snapshot.position?.versionId) return false
        await invoke(result.pageInvocation.name, result.pageInvocation.args)
      }
      if (!alive.current || actor !== scope.current) return true
      for (const job of result.jobs) dispatch({ type: 'accepted', job: toJob(job) })
      // Already accepted background jobs stay attached to their original work. Late foreground UI does not.
      if (state.current.viewEpoch === snapshot.viewEpoch) {
        notify(result.text)
        if (result.searchQueue.length) queue.current = result.searchQueue
        if (result.viewer) await open(result.viewer.workId, result.viewer.versionId ?? undefined, result.viewer.followCurrent)
      }
      return true
    } catch (error) {
      if (__DEV__) console.info('[interactive-content] request failed', { kind: error instanceof Error ? error.name : 'unknown',
        status: error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : null })
      notify(t('content_request_unavailable')); return false
    }
    finally { sending.current = false; if (alive.current) setSubmitting(false) }
  }, [ready, mountId, notify, open, t, observe, invoke])
  const page = useCallback(async (direction: -1 | 1, expectedWorkId?: string) => {
    const selected = state.current.position?.workId
    let index = queue.current.indexOf(selected ?? '')
    if (!queue.current.length || index + direction >= queue.current.length) {
      const feed = await contentClient.feed(feedCursor.current ?? undefined)
      feedCursor.current = feed.nextCursor
      queue.current = [...new Set([...queue.current, ...feed.works.map((item) => item.id)])]
      index = queue.current.indexOf(selected ?? '')
    }
    const id = queue.current[index + direction]
    if (!id || (expectedWorkId && id !== expectedWorkId)) return false
    await open(id)
    return true
  }, [open])
  const save = useCallback(async (html: string, metadata?: ContentSaveMetadata) => {
    if (!ready || sending.current) return
    const snapshot = state.current
    if (!snapshot.position?.followCurrent) { notify(t('content_history_readonly')); return }
    const actor = scope.current
    sending.current = true; setSubmitting(true)
    try {
      const { contextRef } = await contentClient.context({ mountId, viewEpoch: snapshot.viewEpoch, ...contentPositionBody(snapshot.position) })
      if (!alive.current || actor !== scope.current || state.current.viewEpoch !== snapshot.viewEpoch) return
      const receipt = await contentClient.save({ contextRef, requestKey: Crypto.randomUUID(), html, metadata })
      if (alive.current && actor === scope.current) {
        if (receipt.status === 'completed') {
          documents.current.clear()
          // Don't steal focus if the user moved on during persistence.
          if (state.current.viewEpoch === snapshot.viewEpoch) await open(receipt.workId)
        } else dispatch({ type: 'accepted', job: toJob(receipt) })
      }
    } catch (error) {
      // A stale snapshot is not merged or silently retried. Reload authoritative content so the
      // rejected page cannot remain stuck with disabled/pending controls.
      if (error && typeof error === 'object' && 'status' in error && error.status === 409
        && alive.current && actor === scope.current && state.current.viewEpoch === snapshot.viewEpoch && snapshot.position) {
        documents.current.clear()
        setSurfaceReset((value) => value + 1)
        await open(snapshot.position.workId).catch(() => {})
      }
      throw error
    } finally { sending.current = false; if (alive.current) setSubmitting(false) }
  }, [ready, mountId, notify, t, open])
  const publish = useCallback(async () => {
    const document = selectedDocument(state.current), actor = scope.current, epoch = state.current.viewEpoch
    if (!ready || publishBusy.current || !document || document.creatorId !== actor || document.published) return
    publishBusy.current = true; setPublishing(true)
    try {
      await contentClient.publish(document)
      documents.current.clear() // Publication changes visibility without changing the immutable version/head.
      if (alive.current && actor === scope.current && epoch === state.current.viewEpoch) await open(document.workId)
    } finally {
      publishBusy.current = false
      if (alive.current) setPublishing(false)
    }
  }, [ready, open])
  return { accountId, surfaceReset, session, document: selectedDocument(session), ready, booting, submitting, publishing, feedback,
    previous: neighbors.centerId === session.position?.workId ? neighbors.previous : undefined,
    next: neighbors.centerId === session.position?.workId ? neighbors.next : undefined,
    updating, open, submit, save, page, notify, publish,
  }
}
function toJob(receipt: ContentReceipt): ContentJob { return { id: receipt.requestId, workId: receipt.workId, kind: receipt.kind } }
