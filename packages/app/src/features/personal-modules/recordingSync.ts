// @arch docs/features/listening.md
// @test src/__tests__/personal-modules.test.ts

export type PendingRecordingSync = { records: number; transcripts: number; audio: number }
export type RecordingSyncState = {
  syncError: string | null
  archiveError: string | null
  pending: number
  assistanceAvailable: boolean | null
}
type Store = { userId: string; pendingSyncCounts(): Promise<PendingRecordingSync> }
type SyncDependencies<S extends Store> = {
  store(): Promise<S>
  account(): string | undefined
  cloud(store: S): Promise<void>
  archive(store: S, pending: PendingRecordingSync): Promise<void>
  preferences(store: S): Promise<void>
  update(patch: Partial<RecordingSyncState>): void
}

function statusOf(error: unknown): number | undefined {
  // Source and compiled shared modules can coexist in a development bundle.
  // Match the public API error contract rather than constructor identity.
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined
}

export function recordingSyncError(channel: 'cloud' | 'archive', error: unknown) {
  const message = error instanceof Error ? error.message : ''
  let code = message
  try {
    code = (JSON.parse(message) as { error?: string }).error ?? message
  } catch {
    /* Plain local errors. */
  }
  if (
    channel === 'archive' &&
    [
      'recording_machine_offline',
      'recording_client_upgrade_required',
      'recording_storage_full',
      'recording_local_file_missing',
      'recording_ack_invalid',
      'recording_local_save_failed',
      'recording_target_changed',
      'primary_machine_required',
    ].includes(code)
  )
    return code
  const status = statusOf(error)
  if (status !== undefined) {
    if (status === 401) return 'sync_auth_required'
    if (status === 403) return 'sync_permission_denied'
    if (status === 404) return 'sync_service_unavailable'
    if (code === 'recording_local_save_failed') return 'local_save_failed'
    if (channel === 'archive' && status === 409) return 'recording_target_changed'
    if (channel === 'archive' && status === 507) return 'recording_storage_full'
  }
  return channel === 'cloud' ? 'sync_waiting' : 'archive_waiting'
}

/** Cloud text, computer archives and optional assistance never block one another. */
export function createRecordingSync<S extends Store>(dependencies: SyncDependencies<S>) {
  const running = new Map<string, Promise<void>>()
  function lane(name: string, run: (store: S, current: () => boolean) => Promise<void>) {
    const account = dependencies.account()
    if (!account) return Promise.resolve()
    const key = `${account}:${name}`
    const existing = running.get(key)
    if (existing) return existing
    const task = (async () => {
      const store = await dependencies.store()
      const current = () => store.userId === account && dependencies.account() === account
      if (current()) await run(store, current)
    })()
      .catch(() => {
        // A local store failure must not claim that text has been durably saved.
        if (dependencies.account() === account)
          dependencies.update({ syncError: 'local_save_failed' })
      })
      .finally(() => {
        running.delete(key)
      })
    running.set(key, task)
    return task
  }
  return async function sync() {
    await Promise.all([
      lane('cloud', async (store, current) => {
        let syncError: string | null = null
        try {
          await dependencies.cloud(store)
        } catch (error) {
          syncError = recordingSyncError('cloud', error)
        }
        const counts = await store.pendingSyncCounts()
        if (!current()) return
        // Metadata lookup failures with an empty queue do not mean transcripts are pending.
        if (syncError === 'sync_waiting' && !counts.records) syncError = 'sync_unavailable'
        dependencies.update({ syncError, pending: counts.records + counts.audio })
      }),
      lane('archive', async (store, current) => {
        const pending = await store.pendingSyncCounts()
        let archiveError: string | null = null
        try {
          await dependencies.archive(store, pending)
        } catch (error) {
          if (pending.audio) archiveError = recordingSyncError('archive', error)
        }
        const counts = await store.pendingSyncCounts()
        if (current()) dependencies.update({ archiveError, pending: counts.records + counts.audio })
      }),
      lane('preferences', async (store, current) => {
        try {
          await dependencies.preferences(store)
          if (current()) dependencies.update({ assistanceAvailable: true })
        } catch (error) {
          if (current() && statusOf(error) === 404)
            dependencies.update({ assistanceAvailable: false })
        }
      }),
    ])
  }
}
