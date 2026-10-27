// @arch docs/architecture/interactive-web-agent-and-versioning.md
// @test src/__tests__/interactive-content-session.test.ts

export type ContentDocument = {
  workId: string
  headRevision: number
  versionId: string
  title: string
  summary: string
  html: string
  resourceOrigins: string[]
  creatorId: string
  published: boolean
  shareUrl?: string
}
export type ContentPosition = { workId: string; versionId: string; followCurrent: boolean }
export type ContentJob = { id: string; workId: string | null; kind: 'create' | 'modify' }
export type ContentSession = {
  documents: ContentDocument[]
  position: ContentPosition | null
  viewEpoch: number
  jobs: ContentJob[]
  completedWorkId: string | null
}
export const emptyContentSession = (): ContentSession => ({ documents: [], position: null, viewEpoch: 0,
  jobs: [], completedWorkId: null })
export type ContentSessionEvent =
  | { type: 'reset' }
  | { type: 'open'; position: ContentPosition }
  | { type: 'accepted'; job: ContentJob }
  | { type: 'completed'; jobId: string; document: ContentDocument }
  | { type: 'settledWithoutResult'; jobId: string }
  | { type: 'headChanged'; document: ContentDocument }
  | { type: 'dismissCompletion' }

/** UI state is not persistence or authority; updates must come from authenticated host receipts. */
export function reduceContentSession(state: ContentSession, event: ContentSessionEvent): ContentSession {
  if (event.type === 'reset') return { ...emptyContentSession(), viewEpoch: state.viewEpoch + 1 } // Mount epochs must never rewind on account/deep-link resets.
  if (event.type === 'open') return { ...state, position: event.position, viewEpoch: state.viewEpoch + 1 }
  if (event.type === 'dismissCompletion') return { ...state, completedWorkId: null }
  if (event.type === 'accepted') {
    return state.jobs.some((job) => job.id === event.job.id) ? state : { ...state, jobs: [...state.jobs, event.job] }
  }
  if (event.type === 'settledWithoutResult') return { ...state, jobs: state.jobs.filter((job) => job.id !== event.jobId) }
  if (event.type === 'completed' && !state.jobs.some((job) => job.id === event.jobId)) return state
  const document = event.document
  const knownHead = Math.max(-1, ...state.documents.filter((item) => item.workId === document.workId).map((item) => item.headRevision))
  if (document.headRevision < knownHead) {
    return event.type === 'completed' ? { ...state, jobs: state.jobs.filter((job) => job.id !== event.jobId) } : state
  }
  const allDocuments = [...state.documents.filter((item) => !(item.workId === document.workId && item.versionId === document.versionId)), document]
  const pinned = allDocuments.find((item) => item.workId === state.position?.workId && item.versionId === state.position.versionId)
  const documents = allDocuments.slice(-15)
  if (pinned && !documents.includes(pinned)) documents.unshift(pinned)
  const follow = state.position?.workId === document.workId && state.position.followCurrent
  return { ...state, documents,
    position: follow ? { workId: document.workId, versionId: document.versionId, followCurrent: true } : state.position,
    viewEpoch: follow ? state.viewEpoch + 1 : state.viewEpoch,
    jobs: event.type === 'completed' ? state.jobs.filter((job) => job.id !== event.jobId) : state.jobs,
    completedWorkId: event.type === 'completed' && !follow ? document.workId : state.completedWorkId,
  }
}

export function selectedDocument(state: ContentSession): ContentDocument | null {
  return state.documents.find((doc) => doc.workId === state.position?.workId && doc.versionId === state.position.versionId) ?? null
}

/** Only a vertical stroke on the dedicated host handle pages; HTML and input do not compete. */
export function contentSwipeDirection(input: { dx: number; dy: number; editing: boolean; recording: boolean }): -1 | 0 | 1 {
  if (input.editing || input.recording || Math.abs(input.dy) < 56 || Math.abs(input.dy) < Math.abs(input.dx) * 1.5) return 0
  return input.dy < 0 ? 1 : -1
}
