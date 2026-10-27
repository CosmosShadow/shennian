// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/project-list.test.ts

import { normalizeProjectMatchPath, type AgentType, type NianProject, type NianSession } from '@shennian/wire'
import {
  filterManagerSubstrateSessions,
  hasSessionUnread,
  isManagerWorkerSession,
  isSessionWorking,
} from './session-list'

export type SessionProject = {
  id: string
  key: string
  machineId: string
  machineName: string
  workDir: string
  dirName: string
  lastActivityAt: string
  updatedAt: string
  createdAt: string
  sortActivityAt: string
  latestSessionId: string
  latestSessionTitle: string
  latestSessionPreview: string | null
  latestAgentType: AgentType
  latestModelId: string | null
  defaultAgentType: AgentType | null
  defaultModelId: string | null
  sessionCount: number
  isWorking: boolean
  hasUnread: boolean
}

function toMillis(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function newerIso(left: string | null | undefined, right: string | null | undefined): string {
  return toMillis(right) > toMillis(left) ? (right ?? '') : (left ?? '')
}

function olderIso(left: string | null | undefined, right: string | null | undefined): string {
  if (!left) return right ?? ''
  if (!right) return left
  return toMillis(right) < toMillis(left) ? right : left
}

function sessionSortActivityAt(session: NianSession): string {
  if (session.lastVisibleEventAt) return session.lastVisibleEventAt
  if (session.lastMessagePreviewAt) return session.lastMessagePreviewAt
  const candidates: Array<string | null | undefined> = [
    session.lastActivityAt,
    session.updatedAt,
    session.activity?.updatedAt,
    session.createdAt,
  ]
  let latest = ''
  for (const candidate of candidates) {
    latest = newerIso(latest, candidate)
  }
  return latest
}

function projectSortMillis(project: SessionProject): number {
  if (project.sessionCount > 0 && project.sortActivityAt) {
    return toMillis(project.sortActivityAt)
  }
  return Math.max(
    toMillis(project.sortActivityAt),
    toMillis(project.lastActivityAt),
    toMillis(project.updatedAt),
  )
}

export function buildProjectKey(machineId: string, workDir: string): string {
  return `${machineId}:${normalizeProjectMatchPath(workDir)}`
}

export function getProjectDirName(workDir: string): string {
  const trimmed = workDir.trim()
  if (!trimmed) return ''
  if (trimmed === '~' || trimmed === '/') return trimmed
  const normalized = trimmed.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]+/).filter(Boolean)
  return segments[segments.length - 1] ?? normalized
}

export function getProjectDisplayName(
  project: Pick<SessionProject, 'machineId' | 'machineName' | 'workDir' | 'dirName'>,
  opts?: { showMachineName?: boolean },
): string {
  const projectName = project.dirName || getProjectDirName(project.workDir) || project.workDir
  if (opts?.showMachineName === false) return projectName
  const machineName = project.machineName || project.machineId
  return machineName ? `${machineName} · ${projectName}` : projectName
}

export function filterProjectSessions(sessions: NianSession[]): NianSession[] {
  const ordinaryIds = new Set(filterManagerSubstrateSessions(sessions).map((session) => session.id))
  return sessions.filter((session) =>
    session.agentIdentityId == null
    && (ordinaryIds.has(session.id) || isManagerWorkerSession(session)),
  )
}

export function groupSessionsIntoProjects(
  sessions: NianSession[],
  projectRecords: NianProject[] = [],
): SessionProject[] {
  const map = new Map<string, SessionProject>()

  for (const project of projectRecords) {
    const key = buildProjectKey(project.machineId, project.workDir)
    // Legacy Windows records can exist under both spellings. Choose consistently,
    // not by sync/activity order, so saving defaults cannot flip to the other ID.
    const existing = map.get(key)
    if (existing) {
      const canonical = normalizeProjectMatchPath(project.workDir)
      const existingIsCanonical = existing.workDir === canonical
      const incomingIsCanonical = project.workDir === canonical
      if (existingIsCanonical && !incomingIsCanonical) continue
      if (existingIsCanonical === incomingIsCanonical && existing.id < project.id) continue
    }
    map.set(key, {
      id: project.id,
      key,
      machineId: project.machineId,
      machineName: project.machineName,
      workDir: project.workDir,
      dirName: project.displayName || getProjectDirName(project.workDir),
      lastActivityAt: project.lastActivityAt,
      updatedAt: project.updatedAt,
      createdAt: project.createdAt,
      sortActivityAt: project.lastActivityAt,
      latestSessionId: '',
      latestSessionTitle: '',
      latestSessionPreview: null,
      latestAgentType: 'codex',
      latestModelId: null,
      defaultAgentType: project.defaultAgentType ?? null,
      defaultModelId: project.defaultModelId ?? null,
      sessionCount: 0,
      isWorking: false,
      hasUnread: false,
    })
  }

  for (const session of filterProjectSessions(sessions)) {
    if (session.deletedAt) continue
    const key = buildProjectKey(session.machineId, session.workDir)
    const existing = map.get(key)
    const isWorking = isSessionWorking(session)
    const hasUnread = hasSessionUnread(session)

    if (!existing) {
      map.set(key, {
        id: '',
        key,
        machineId: session.machineId,
        machineName: session.machineName?.trim() ?? '',
        workDir: session.workDir,
        dirName: getProjectDirName(session.workDir) || session.workDir,
        lastActivityAt: session.lastActivityAt,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        sortActivityAt: sessionSortActivityAt(session),
        latestSessionId: session.id,
        latestSessionTitle: session.title,
        latestSessionPreview: session.lastMessagePreview ?? null,
        latestAgentType: session.agentType,
        latestModelId: session.modelId ?? null,
        defaultAgentType: null,
        defaultModelId: null,
        sessionCount: 1,
        isWorking,
        hasUnread,
      })
      continue
    }

    const isFirstSession = existing.sessionCount === 0
    existing.sessionCount += 1
    existing.isWorking = existing.isWorking || isWorking
    existing.hasUnread = existing.hasUnread || hasUnread
    if (!existing.machineName && session.machineName?.trim()) {
      existing.machineName = session.machineName.trim()
    }

    existing.lastActivityAt = newerIso(existing.lastActivityAt, session.lastActivityAt)
    existing.updatedAt = newerIso(existing.updatedAt, session.updatedAt)
    existing.createdAt = olderIso(existing.createdAt, session.createdAt)

    const sessionActivityAt = sessionSortActivityAt(session)
    if (isFirstSession || toMillis(sessionActivityAt) > toMillis(existing.sortActivityAt)) {
      existing.sortActivityAt = newerIso(existing.sortActivityAt, sessionActivityAt)
      existing.latestSessionId = session.id
      existing.latestSessionTitle = session.title
      existing.latestSessionPreview = session.lastMessagePreview ?? null
      existing.latestAgentType = session.agentType
      existing.latestModelId = session.modelId ?? null
    }
  }

  return [...map.values()]
}

export function sortProjects(
  projects: SessionProject[],
  opts?: { isPinned?: (project: SessionProject) => boolean },
): SessionProject[] {
  const isPinned = opts?.isPinned
  return [...projects].sort((left, right) => {
    const leftPinned = isPinned?.(left) ? 1 : 0
    const rightPinned = isPinned?.(right) ? 1 : 0
    if (leftPinned !== rightPinned) return rightPinned - leftPinned

    const leftActivity = projectSortMillis(left)
    const rightActivity = projectSortMillis(right)
    if (leftActivity !== rightActivity) return rightActivity - leftActivity

    const leftCreated = toMillis(left.createdAt)
    const rightCreated = toMillis(right.createdAt)
    if (leftCreated !== rightCreated) return rightCreated - leftCreated

    const leftWorking = left.isWorking ? 1 : 0
    const rightWorking = right.isWorking ? 1 : 0
    if (leftWorking !== rightWorking) return rightWorking - leftWorking

    const leftUnread = left.hasUnread ? 1 : 0
    const rightUnread = right.hasUnread ? 1 : 0
    if (leftUnread !== rightUnread) return rightUnread - leftUnread

    const leftMachine = (left.machineName || left.machineId).toLocaleLowerCase()
    const rightMachine = (right.machineName || right.machineId).toLocaleLowerCase()
    if (leftMachine !== rightMachine) return leftMachine.localeCompare(rightMachine)

    const leftPath = left.workDir.toLocaleLowerCase()
    const rightPath = right.workDir.toLocaleLowerCase()
    if (leftPath !== rightPath) return leftPath.localeCompare(rightPath)

    return left.key.localeCompare(right.key)
  })
}
