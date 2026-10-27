// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/home-entry-previews.test.ts
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { authApi } from '../../config/api'
import { moduleStore } from '../personal-modules/runtime'
import { useRecordingState } from '../personal-modules/recordingState'
import type { Reminder } from '../personal-modules/types'
import { diaryDocuments, diaryStatus, subscribeDiary } from '../personal-workspace/diaryRuntime'
import { useRemoteFolders } from '../remote-folders/useRemoteFolders'
import { canBrowseFolders } from '../remote-folders/model'
import { diaryHomePreview, folderHomePreview, recordingHomePreview, scheduleHomePreview, type HomePreview } from './homeEntryPreviews'
import type { HomeEntries, HomeEntryKey } from './homeEntryPreference'

type Snapshot = { account?: string; recording?: HomePreview | null; schedules?: HomePreview | null; diary?: HomePreview | null; diaryScope?: string }
/** The directory never mounts its feature screens or waits for preview requests to finish. */
export function useHomePreviews(enabled: HomeEntries): Record<HomeEntryKey, HomePreview> {
  const { t } = useTranslation()
  const account = useAuthStore(state => state.user?.id)
  const focused = useIsFocused()
  const active = useRecordingState(state => state.active)
  const partial = useRecordingState(state => focused && enabled.recording ? state.partial : '')
  const finalText = useRecordingState(state => focused && enabled.recording ? state.finalText : '')
  const revision = useRecordingState(state => state.revision)
  const status = useSyncExternalStore(subscribeDiary, diaryStatus, diaryStatus)
  const { folders } = useRemoteFolders()
  const machines = useMachinesStore(state => state.machines)
  const diaryScope = JSON.stringify([account, status.target?.machine?.id, status.target?.revision])
  const [snapshot, setSnapshot] = useState<Snapshot>({})

  useEffect(() => {
    let live = true
    if (!account || !focused || !enabled.recording) return
    void moduleStore().then(async store => {
      if (store.userId !== account) return
      const latest = await store.latestTranscript()
      if (live && useAuthStore.getState().user?.id === account) setSnapshot(previous => ({
        ...(previous.account === account ? previous : {}), account, recording: recordingHomePreview(latest),
      }))
    }).catch(() => {})
    return () => { live = false }
  }, [account, focused, enabled.recording, revision])

  useEffect(() => {
    let live = true
    if (!account || !focused || !enabled.schedules) return
    const apply = (items: Reminder[]) => {
      if (live && useAuthStore.getState().user?.id === account) setSnapshot(previous => ({
        ...(previous.account === account ? previous : {}), account, schedules: scheduleHomePreview(items),
      }))
    }
    // Cache paints first; only one lightweight schedule request per home focus.
    void (async () => {
      const store = await moduleStore()
      if (store.userId !== account) return
      const cached = await store.cached<Reminder[]>('schedule:list')
        ?? (await store.cached<{ reminders?: Reminder[] }>('overview'))?.reminders
      if (cached) apply(cached)
      if (!live || useAuthStore.getState().user?.id !== account) return
      const response = await authApi<{ items: Reminder[] }>('/personal-modules/reminders')
      if (!live || useAuthStore.getState().user?.id !== account) return
      apply(response.items)
      await store.cache('schedule:list', response.items)
    })().catch(() => {})
    return () => { live = false }
  }, [account, focused, enabled.schedules])

  useEffect(() => {
    let live = true
    if (!account || !focused || !enabled.diary || !status.target?.machine) return
    void diaryDocuments(status.target).then(entries => {
      if (live && useAuthStore.getState().user?.id === account) setSnapshot(previous => ({
        ...(previous.account === account ? previous : {}), account, diaryScope, diary: diaryHomePreview(entries),
      }))
    }).catch(() => {})
    return () => { live = false }
  }, [account, focused, enabled.diary, status, diaryScope])

  const current = snapshot.account === account ? snapshot : {}
  const folder = folderHomePreview(folders.filter(folder => machines.some(machine => machine.id === folder.machineId && canBrowseFolders(machine))), id => machines.find(machine => machine.id === id)?.name)
  const liveText = snapshot.account === account && active ? partial || finalText : ''
  return {
    recording: liveText ? { text: liveText } : current.recording ?? { text: t(active ? 'mobile_recording_active' : 'mobile_home_no_recording') },
    schedules: current.schedules ?? { text: t(current.schedules === null ? 'mobile_home_no_schedules' : 'mobile_home_open_schedules') },
    diary: (snapshot.diaryScope === diaryScope ? current.diary : undefined) ?? { text: t('mobile_home_no_diary') },
    folders: folder ?? { text: t('mobile_home_no_folders') },
  }
}
