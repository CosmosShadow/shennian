// @arch open-source/docs/server-runtime.md
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/projects.test.ts

import { createHash } from 'node:crypto'
import { filterAvailableAgentTypes, type AgentType, type NianProject } from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { mintProjectFsReference } from './project-fs-authority.js'

export function normalizeProjectWorkDir(workDir: string): string {
  const trimmed = workDir.trim()
  if (trimmed === '/' || trimmed === '~') return trimmed
  return trimmed.replace(/[\\/]+$/, '')
}

export function isPersistentProjectWorkDir(workDir: string): boolean {
  const normalized = normalizeProjectWorkDir(workDir)
  if (!normalized) return false
  return !(
    normalized === '/tmp' ||
    normalized.startsWith('/tmp/') ||
    normalized === '/private/tmp' ||
    normalized.startsWith('/private/tmp/') ||
    normalized.startsWith('/var/folders/')
  )
}

export function projectIdFor(machineId: string, workDir: string): string {
  const normalized = normalizeProjectWorkDir(workDir)
  return `project_${createHash('sha256').update(`${machineId}\0${normalized}`).digest('hex').slice(0, 20)}`
}

export function projectDisplayName(workDir: string): string {
  const normalized = normalizeProjectWorkDir(workDir)
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) || normalized || '未命名项目'
}

function toNianProject(
  userId: string,
  project: {
    id: string
    machineId: string
    workDir: string
    displayName: string
    defaultAgentType: string | null
    defaultModelId: string | null
    lastActivityAt: Date
    createdAt: Date
    updatedAt: Date
  },
  machine: { name: string; online: boolean },
): NianProject {
  return {
    id: project.id,
    machineId: project.machineId,
    machineName: machine.name,
    machineOnline: machine.online,
    workDir: project.workDir,
    displayName: project.displayName,
    defaultAgentType: project.defaultAgentType
      ? filterAvailableAgentTypes([project.defaultAgentType])[0] ?? null
      : null,
    defaultModelId: project.defaultModelId,
    lastActivityAt: project.lastActivityAt.toISOString(),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    fileBrowserRef: mintProjectFsReference(userId, project),
  }
}

type ProjectProjectionInput = {
  machineId: string
  workDir: string
  lastActivityAt?: Date
  createdAt?: Date
}

async function upsertProjectProjection(params: ProjectProjectionInput): Promise<void> {
  const workDir = normalizeProjectWorkDir(params.workDir)
  if (!isPersistentProjectWorkDir(workDir)) return
  const id = projectIdFor(params.machineId, workDir)
  const lastActivityAt = params.lastActivityAt ?? new Date()
  const existing = await prisma.sessionProject.findUnique({ where: { id } })
  if (!existing) {
    try {
      await prisma.sessionProject.create({
        data: {
          id,
          machineId: params.machineId,
          workDir,
          displayName: projectDisplayName(workDir),
          lastActivityAt,
          ...(params.createdAt ? { createdAt: params.createdAt } : {}),
        },
      })
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
    }
    return
  }
  if (lastActivityAt > existing.lastActivityAt) {
    await prisma.sessionProject.update({ where: { id }, data: { lastActivityAt } })
  }
}

export async function upsertSessionProject(
  params: ProjectProjectionInput & { agentIdentityId: string | null; sessionScope?: string | null },
): Promise<void> {
  // Agent-owned and steward sessions never become user projects.
  if (params.agentIdentityId != null || params.sessionScope === 'steward') return
  await upsertProjectProjection(params)
}

async function accessibleMachines(userId: string) {
  const now = new Date()
  const [owned, grants] = await Promise.all([
    prisma.machine.findMany({
      where: { userId, paired: true },
      select: { id: true, name: true, online: true },
    }),
    prisma.machineGrant.findMany({
      where: {
        granteeId: userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { machine: { select: { id: true, name: true, online: true, paired: true } } },
    }),
  ])
  const machines = new Map(owned.map((machine) => [machine.id, machine]))
  for (const grant of grants) {
    if (grant.machine.paired && !machines.has(grant.machine.id)) {
      machines.set(grant.machine.id, grant.machine)
    }
  }
  return machines
}

async function backfillProjects(machineIds: string[]): Promise<void> {
  if (machineIds.length === 0) return
  const grouped = await prisma.nianSession.groupBy({
    by: ['machineId', 'workDir'],
    where: {
      machineId: { in: machineIds },
      agentIdentityId: null,
      sessionScope: { not: 'steward' },
      deletedAt: null,
      workDir: { not: '' },
    },
    _max: { lastActivityAt: true },
    _min: { createdAt: true },
  })
  await Promise.all(
    grouped
      .filter((group) => isPersistentProjectWorkDir(group.workDir))
      .map((group) =>
        upsertSessionProject({
          machineId: group.machineId,
          workDir: group.workDir,
          agentIdentityId: null,
          lastActivityAt: group._max.lastActivityAt ?? undefined,
          createdAt: group._min.createdAt ?? undefined,
        }),
      ),
  )
}

export async function listUserProjects(userId: string): Promise<NianProject[]> {
  const machines = await accessibleMachines(userId)
  const machineIds = [...machines.keys()]
  await backfillProjects(machineIds)
  if (machineIds.length === 0) return []
  const projects = await prisma.sessionProject.findMany({
    where: { machineId: { in: machineIds } },
    orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
  })
  return projects
    .filter((project) => isPersistentProjectWorkDir(project.workDir))
    .map((project) => {
      const machine = machines.get(project.machineId)!
      return toNianProject(userId, project, machine)
    })
}

export async function getUserProject(userId: string, projectId: string) {
  const machines = await accessibleMachines(userId)
  const project = await prisma.sessionProject.findUnique({ where: { id: projectId } })
  if (!project || !machines.has(project.machineId)) throw new Error('Project not found')
  return project
}

export async function createProjectForUser(params: {
  userId: string
  machineId: string
  workDir: string
}): Promise<NianProject> {
  const workDir = normalizeProjectWorkDir(params.workDir)
  if (!isPersistentProjectWorkDir(workDir)) throw new Error('Invalid project directory')

  const machines = await accessibleMachines(params.userId)
  const machine = machines.get(params.machineId)
  if (!machine) throw new Error('Machine not found')

  await upsertProjectProjection({ machineId: params.machineId, workDir })
  const project = await prisma.sessionProject.findUnique({
    where: { id: projectIdFor(params.machineId, workDir) },
  })
  if (!project) throw new Error('Project creation failed')

  return toNianProject(params.userId, project, machine)
}

export async function updateProjectLaunchDefaults(params: {
  userId: string
  projectId: string
  agentType: AgentType
  modelId: string | null
}): Promise<NianProject> {
  const machines = await accessibleMachines(params.userId)
  const existing = await prisma.sessionProject.findUnique({ where: { id: params.projectId } })
  const machine = existing ? machines.get(existing.machineId) : null
  if (!existing || !machine) throw new Error('Project not found')
  const project = await prisma.sessionProject.update({
    where: { id: existing.id },
    data: { defaultAgentType: params.agentType, defaultModelId: params.modelId },
  })
  return toNianProject(params.userId, project, machine)
}

export async function removeProjectForUser(
  userId: string,
  projectId: string,
  deleteSession: (sessionId: string, userId: string) => Promise<unknown>,
): Promise<{ deletedSessionIds: string[] }> {
  const project = await prisma.sessionProject.findUnique({
    where: { id: projectId },
    include: { machine: { select: { userId: true } } },
  })
  if (!project) throw new Error('Project not found')
  if (project.machine.userId !== userId) throw new Error('Not authorized')

  const normalizedWorkDir = normalizeProjectWorkDir(project.workDir)
  const workDirCandidates =
    normalizedWorkDir === '/' || normalizedWorkDir === '~'
      ? [normalizedWorkDir]
      : [normalizedWorkDir, `${normalizedWorkDir}/`, `${normalizedWorkDir}\\`]
  const sessions = await prisma.nianSession.findMany({
    where: {
      machineId: project.machineId,
      workDir: { in: workDirCandidates },
      agentIdentityId: null,
      deletedAt: null,
    },
    select: { id: true },
  })

  for (const session of sessions) {
    await deleteSession(session.id, userId)
  }

  await prisma.sessionProject.delete({ where: { id: project.id } })
  return { deletedSessionIds: sessions.map((session) => session.id) }
}
