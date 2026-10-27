// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/attachment-download.test.ts
import { useRef, useSyncExternalStore } from 'react'
import { Toast } from './Toast'

export { DOWNLOAD_FEEDBACK_MS, downloadFeedback } from './downloadFeedbackPolicy'
export type { DownloadResult, DownloadNotice } from './downloadFeedbackPolicy'
import { DOWNLOAD_FEEDBACK_MS, type DownloadNotice } from './downloadFeedbackPolicy'

export function DownloadFeedback({ notice, onHide }: { notice: DownloadNotice | null; onHide: () => void }) {
  const instance = useRef({ notice, id: 0 })
  if (instance.current.notice !== notice) instance.current = { notice, id: instance.current.id + 1 }
  return <Toast key={instance.current.id} message={notice?.message ?? ''} visible={!!notice} type={notice?.type}
    onHide={onHide} duration={DOWNLOAD_FEEDBACK_MS} />
}

let globalNotice: DownloadNotice | null = null
const listeners = new Set<() => void>()
export function showDownloadFeedback(notice: DownloadNotice | null) {
  globalNotice = notice
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => globalNotice
export function DownloadFeedbackHost() {
  const notice = useSyncExternalStore(subscribe, snapshot, snapshot)
  return <DownloadFeedback notice={notice} onHide={() => showDownloadFeedback(null)} />
}
