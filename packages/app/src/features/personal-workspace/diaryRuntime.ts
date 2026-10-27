// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-sync.test.ts
import { AppState } from 'react-native'
import { useAuthStore } from '../../config/auth'
import { getServerUrl } from '../../config/server'
import { primaryMachineClient, personalWorkspaceClient, personalErrorKey, type PrimaryMachine } from './client'
import { openDiaryStore } from './diaryStore'
import { syncDiary } from './diarySync'
export type DiaryStatus = { target?: PrimaryMachine; busy: boolean; error?: string; editable?: boolean; directory?: string }
const emptyStatus: DiaryStatus = { busy: false }
const listeners = new Set<() => void>()
let generation = 0
let savingToComputer = false
let state: DiaryStatus = { busy: false }, owner = '', flight: Promise<void> | null = null
let store: ReturnType<typeof openDiaryStore> | undefined
export const diaryScope = (target: PrimaryMachine) => JSON.stringify([target.machine?.id, target.revision])
const identity = () => JSON.stringify([getServerUrl(), useAuthStore.getState().user?.id])
const emit = () => { for (const listener of listeners) listener() }
export const subscribeDiary = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const diaryStatus = () => owner === identity() ? state : emptyStatus
export async function diaryDocuments(target: PrimaryMachine) {
  if (owner !== identity() || !store) return []
  return (await store).list(diaryScope(target))
}
export async function diaryDocument(target: PrimaryMachine, path: string) {
  if (owner !== identity() || !store) return null
  return (await store).get(diaryScope(target), path)
}
export function refreshDiary(): Promise<void> {
  if (owner !== identity()) {
    generation++; owner = identity(); state = { busy: false }; flight = null
    store = openDiaryStore(owner); emit()
  }
  if (savingToComputer) return Promise.resolve()
  if (flight) return flight
  const currentOwner = owner, currentGeneration = generation, currentStore = store!, active = () => generation === currentGeneration && owner === currentOwner && identity() === currentOwner
  state = { ...state, busy: true }; emit()
  const work = async () => {
    const repository = await currentStore
    if (!active()) return
    if (!state.target) { state = { ...state, target: (await repository.getTarget<PrimaryMachine>()) ?? undefined }; emit() }
    let target: PrimaryMachine
    try { target = await primaryMachineClient.get() }
    catch (error) {
      if (active() && error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) {
        await repository.setTarget(null)
        if (active()) state = { busy: true }
      }
      throw error
    }
    if (!active()) return
    await repository.setTarget(target)
    if (!active()) return
    const sameTarget = state.target && diaryScope(state.target) === diaryScope(target)
    state = { target, busy: true, error: sameTarget ? state.error : undefined, directory: sameTarget ? state.directory : undefined, editable: sameTarget ? state.editable : false }; emit()
    if (!target.machine) throw new Error(target.revision ? 'personal_primary_unavailable' : 'personal_primary_not_configured')
    if (!target.machine.online) { state = { ...state, error: 'personal_diary_offline' }; return }
    const result = await syncDiary(repository, diaryScope(target), params => personalWorkspaceClient({ ...params, expectedPrimaryRevision: target.revision }), () => active() && AppState.currentState === 'active', emit)
    if (active() && result) state = { ...state, editable: result.editable, directory: result.directory, error: undefined }
  }
  const promise = work().catch(error => { if (active()) state = { ...state, error: error instanceof Error && error.message.includes('file_changed') ? 'personal_diary_sync_changed' : personalErrorKey(error) } }).finally(() => {
    if (active()) { state = { ...state, busy: false }; emit() }
    if (flight === promise) flight = null
  })
  flight = promise
  return promise
}
export async function saveDiary(target: PrimaryMachine, path: string, content: string, expectedRevision: string) {
  const currentOwner = identity(), currentGeneration = generation, currentStore = store
  if (owner !== currentOwner || !currentStore || diaryScope(state.target ?? { machine: null, revision: -1 }) !== diaryScope(target)) throw new Error('personal_primary_conflict')
  if (savingToComputer) throw new Error('personal_unavailable')
  await flight
  if (savingToComputer) throw new Error('personal_unavailable')
  if (generation !== currentGeneration || owner !== currentOwner || identity() !== currentOwner || !state.target || diaryScope(state.target) !== diaryScope(target)) throw new Error('personal_primary_conflict')
  savingToComputer = true
  try {
    const result = await personalWorkspaceClient({ action: 'diary_write', kind: 'diary', path, content, expectedRevision, expectedPrimaryRevision: target.revision })
    if (generation !== currentGeneration || owner !== currentOwner || identity() !== currentOwner) throw new Error('personal_primary_conflict')
    if (typeof result.content !== 'string' || !result.revision) throw new Error('personal_client_upgrade_required')
    const repository = await currentStore
    const entry = (await repository.list(diaryScope(target))).find(d => d.path === path)
    await repository.put(diaryScope(target), { ...entry, path, date: path.slice(5, 15), title: /^#\s+(.+)$/m.exec(result.content)?.[1]?.slice(0, 200) ?? '', summary: /^>\s*概要[：:]\s*(.+)$/m.exec(result.content)?.[1]?.slice(0, 300) ?? '', content: result.content, revision: result.revision })
    emit()
  } finally { savingToComputer = false; void refreshDiary() }
}
/** Account-level, foreground-only reconciliation; no screen mount dependency. */
export function mountDiarySync() {
  let live = true
  const refresh = () => { if (live && AppState.currentState === 'active') void refreshDiary() }
  refresh()
  const timer = setInterval(refresh, 20000)
  const subscription = AppState.addEventListener('change', next => { if (next === 'active') refresh() })
  return () => { live = false; clearInterval(timer); subscription.remove(); generation++; owner = ''; state = { busy: false }; flight = null; store = undefined; emit() }
}
