import { getAgentDisplayName, getSessionListSummary, getProjectDirName } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'

export function formatSessionClockTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  const diffDay = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDay < 7) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function latestIso(...values: Array<string | undefined | null>): string | null {
  let latest: string | null = null
  let latestMs = 0
  for (const value of values) {
    if (!value) continue
    const ms = new Date(value).getTime()
    if (!Number.isFinite(ms) || ms <= latestMs) continue
    latest = value
    latestMs = ms
  }
  return latest
}

type BuildSessionDisplayOptions = {
  session: NianSession
  preview?: string
  previewAt?: string
  draft?: string
  sendingPreview?: string
  now?: number
  isTyping: boolean
  fallbackMachineName?: string
  workingLabel: string
  toolRunningLabel: string
  toolRunningCountLabel: string
  imageLabel: string
  imagesLabel: (count: number) => string
  fileLabel: string
  filesLabel: (count: number) => string
  hideMachineName?: boolean
  hideProjectName?: boolean
  hideAgentLabel?: boolean
}

export function buildSessionDisplay({
  session,
  preview,
  previewAt,
  draft,
  sendingPreview,
  isTyping,
  now,
  fallbackMachineName = '',
  workingLabel,
  toolRunningLabel,
  toolRunningCountLabel,
  imageLabel,
  imagesLabel,
  fileLabel,
  filesLabel,
  hideMachineName = false,
  hideProjectName = true,
  hideAgentLabel = false,
}: BuildSessionDisplayOptions) {
  const agentLabel = getAgentDisplayName(session.agentType)
  const projectName = getProjectDirName(session.workDir) || session.workDir
  const metaLabel = [
    hideMachineName ? '' : session.machineName?.trim() || fallbackMachineName,
    hideProjectName ? '' : projectName,
    hideAgentLabel ? '' : agentLabel,
  ]
    .filter(Boolean)
    .join(' · ')
  const summary = getSessionListSummary(session, {
    preview,
    draft,
    sendingPreview,
    isTyping,
    now,
    workingLabel,
    toolRunningLabel,
    toolRunningCountLabel,
    imageLabel,
    imagesLabel,
    fileLabel,
    filesLabel,
  })
  const hasProjectedPreview = preview !== undefined
  const visiblePreview = hasProjectedPreview ? preview.trim() : session.lastMessagePreview?.trim()
  const timeStr = formatSessionClockTime(
    hasProjectedPreview
      ? latestIso(previewAt, session.lastVisibleEventAt) ||
          (visiblePreview ? null : session.createdAt)
      : session.lastVisibleEventAt ||
          session.lastMessagePreviewAt ||
          (visiblePreview ? null : session.createdAt),
  )

  return { metaLabel, summary, timeStr }
}
