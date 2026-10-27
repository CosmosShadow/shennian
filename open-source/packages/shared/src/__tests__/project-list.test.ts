// @covers open-source/packages/shared/src/lib/project-list.ts

import { describe, expect, it } from 'vitest'
import type { NianProject, NianSession } from '@shennian/wire'
import {
  buildProjectKey,
  filterProjectSessions,
  getProjectDisplayName,
  getProjectDirName,
  groupSessionsIntoProjects,
  sortProjects,
} from '../lib/project-list'

function makeSession(overrides: Partial<NianSession> = {}): NianSession {
  return {
    id: 's1',
    machineId: 'm1',
    machineName: 'Macbook',
    userId: 'u1',
    agentType: 'codex',
    agentSessionId: 'a1',
    modelId: 'gpt-5.4',
    title: 'Session',
    status: 'active',
    workDir: '/tmp/demo',
    lastMessagePreview: 'hello',
    lastActivityAt: '2026-04-28T12:00:00.000Z',
    createdAt: '2026-04-28T11:00:00.000Z',
    updatedAt: '2026-04-28T12:00:00.000Z',
    userState: null,
    activity: null,
    ...overrides,
  }
}

describe('project list helpers', () => {
  it('joins Windows native and App conversations to the real project ID', () => {
    const sessions = [
      makeSession({ id: 'native', workDir: 'C:/Users/simpl' }),
      makeSession({ id: 'app', workDir: 'C:\\Users\\simpl' }),
    ]
    const project = {
      id: 'project-real', machineId: 'm1', machineName: 'Windows', machineOnline: true,
      workDir: 'C:\\Users\\simpl', displayName: 'simpl',
      createdAt: sessions[0].createdAt, updatedAt: sessions[0].updatedAt,
      lastActivityAt: sessions[0].lastActivityAt,
      defaultAgentType: 'opencode' as const, defaultModelId: 'flash',
    }
    expect(groupSessionsIntoProjects(sessions, [project])).toEqual([
      expect.objectContaining({ id: 'project-real', sessionCount: 2, defaultModelId: 'flash' }),
    ])
    expect(buildProjectKey('m1', sessions[0].workDir)).toBe(buildProjectKey('m1', sessions[1].workDir))
    expect(buildProjectKey('m2', sessions[0].workDir)).not.toBe(buildProjectKey('m1', sessions[0].workDir))
    const canonical = { ...project, id: 'project-forward', workDir: 'C:/Users/simpl', defaultModelId: 'saved-flash' }
    for (const records of [[project, canonical], [canonical, project]]) {
      expect(groupSessionsIntoProjects(sessions, records)).toEqual([
        expect.objectContaining({ id: canonical.id, sessionCount: 2, defaultModelId: 'saved-flash' }),
      ])
    }
  })

  it('keeps a synchronized project after all local sessions are gone', () => {
    const record: NianProject = {
      id: 'project-1',
      machineId: 'm1',
      machineName: 'Macbook',
      machineOnline: true,
      workDir: '/tmp/archived',
      displayName: 'archived',
      lastActivityAt: '2026-04-28T12:00:00.000Z',
      createdAt: '2026-04-01T12:00:00.000Z',
      updatedAt: '2026-04-28T12:00:00.000Z',
    }

    expect(groupSessionsIntoProjects([], [record])).toEqual([
      expect.objectContaining({
        key: 'm1:/tmp/archived',
        sessionCount: 0,
        latestSessionId: '',
      }),
    ])
  })

  it('keeps explicit project defaults separate from the latest conversation', () => {
    const record: NianProject = {
      id: 'project-1',
      machineId: 'm1',
      machineName: 'Macbook',
      machineOnline: true,
      workDir: '/code/demo',
      displayName: 'demo',
      defaultAgentType: 'claude',
      defaultModelId: 'claude-opus-4-1',
      lastActivityAt: '2026-08-29T12:00:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-29T12:00:00.000Z',
    }
    const [project] = groupSessionsIntoProjects([makeSession({ workDir: '/code/demo' })], [record])

    expect(project).toMatchObject({
      defaultAgentType: 'claude',
      defaultModelId: 'claude-opus-4-1',
      latestAgentType: 'codex',
      latestModelId: 'gpt-5.4',
    })
  })

  it('sorts synchronized project records by server activity even without cached sessions', () => {
    const project = (id: string, lastActivityAt: string): NianProject => ({
      id,
      machineId: 'm1',
      machineName: 'Macbook',
      machineOnline: true,
      workDir: `/tmp/${id}`,
      displayName: id,
      lastActivityAt,
      createdAt: lastActivityAt,
      updatedAt: lastActivityAt,
    })
    const projects = groupSessionsIntoProjects([], [
      project('older', '2026-04-01T12:00:00.000Z'),
      project('newer', '2026-04-28T12:00:00.000Z'),
    ])
    expect(sortProjects(projects).map((item) => item.dirName)).toEqual(['newer', 'older'])
  })

  it('builds stable keys and directory names', () => {
    expect(buildProjectKey('m1', '/tmp/demo')).toBe('m1:/tmp/demo')
    expect(getProjectDirName('/home/example/code/shennian')).toBe('shennian')
    expect(getProjectDirName('C:\\Users\\example\\Documents')).toBe('Documents')
    expect(getProjectDirName('~')).toBe('~')
  })

  it('groups sessions by machine and work directory', () => {
    const grouped = groupSessionsIntoProjects([
      makeSession({ id: 'older', title: 'Older', lastActivityAt: '2026-04-28T10:00:00.000Z' }),
      makeSession({ id: 'newer', title: 'Newer', lastActivityAt: '2026-04-28T13:00:00.000Z' }),
      makeSession({ id: 'other', workDir: '/tmp/other', title: 'Other dir' }),
    ])

    expect(grouped).toHaveLength(2)
    expect(grouped.find((item) => item.key === 'm1:/tmp/demo')).toMatchObject({
      dirName: 'demo',
      latestSessionId: 'newer',
      latestSessionTitle: 'Newer',
      sessionCount: 2,
    })
  })

  it('shows Worker conversations in Projects while keeping other manager internals hidden', () => {
    const manager = makeSession({
      id: 'manager',
      agentType: 'manager',
      agentSessionId: 'codex-manager-thread',
      workDir: '/tmp/demo',
      lastActivityAt: '2026-04-28T12:00:00.000Z',
    })
    const substrate = makeSession({
      id: 'substrate',
      agentType: 'codex',
      agentSessionId: 'codex-manager-thread',
      workDir: '/tmp/demo',
      lastActivityAt: '2026-04-28T14:00:00.000Z',
    })
    const worker = makeSession({
      id: 'sess_worker_123',
      agentType: 'codex',
      agentSessionId: 'codex-worker-thread',
      workDir: '/tmp/demo',
      lastActivityAt: '2026-04-28T15:00:00.000Z',
    })
    const normal = makeSession({
      id: 'normal',
      agentType: 'codex',
      agentSessionId: 'codex-normal-thread',
      workDir: '/tmp/demo',
      lastActivityAt: '2026-04-28T13:00:00.000Z',
    })

    const grouped = groupSessionsIntoProjects([manager, substrate, worker, normal])

    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({
      latestSessionId: 'sess_worker_123',
      sessionCount: 2,
    })
  })

  it('keeps Agent-owned conversations out of Projects', () => {
    const ordinary = makeSession({ id: 'ordinary', agentSessionId: 'ordinary-thread' })
    const managed = makeSession({
      id: 'managed',
      agentIdentityId: 'agent-1',
      lastActivityAt: '2026-04-28T15:00:00.000Z',
    })

    expect(filterProjectSessions([managed, ordinary]).map((session) => session.id)).toEqual([
      'ordinary',
    ])
    expect(groupSessionsIntoProjects([managed, ordinary])).toEqual([
      expect.objectContaining({
        latestSessionId: 'ordinary',
        sessionCount: 1,
      }),
    ])
  })

  it('formats project display names with optional machine prefix', () => {
    const [project] = groupSessionsIntoProjects([
      makeSession({ machineId: 'm1', machineName: 'MacBook Pro', workDir: '/tmp/demo' }),
    ])

    expect(getProjectDisplayName(project)).toBe('MacBook Pro · demo')
    expect(getProjectDisplayName(project, { showMachineName: false })).toBe('demo')
  })

  it('sorts pinned first, then recent project activity across machines', () => {
    const recent = {
      ...makeSession({
        id: 'recent',
        workDir: '/tmp/recent',
        lastActivityAt: '2026-04-28T13:00:00.000Z',
      }),
    }
    const working = {
      ...makeSession({
        id: 'working',
        workDir: '/tmp/working',
        lastActivityAt: '2026-04-28T12:00:00.000Z',
        activity: {
          sessionId: 'working',
          runId: 'r1',
          runPhase: 'thinking',
          startedAt: '2026-04-28T12:00:00.000Z',
          updatedAt: '2026-04-28T12:01:00.000Z',
        },
      }),
    }
    const pinned = {
      ...makeSession({
        id: 'pinned',
        workDir: '/tmp/pinned',
        lastActivityAt: '2026-04-28T11:00:00.000Z',
      }),
    }
    const windows = {
      ...makeSession({
        id: 'windows',
        machineId: 'm2',
        machineName: 'Windows',
        workDir: 'C:\\Users\\example\\Documents',
        lastActivityAt: '2026-04-28T15:00:00.000Z',
      }),
    }

    const projects = groupSessionsIntoProjects([recent, working, pinned, windows])
    const sorted = sortProjects(projects, {
      isPinned: (project) => project.key === 'm1:/tmp/pinned',
    })

    expect(sorted.map((item) => item.key)).toEqual([
      'm1:/tmp/pinned',
      'm2:C:/Users/example/Documents',
      'm1:/tmp/recent',
      'm1:/tmp/working',
    ])
  })

  it('uses updated and live activity timestamps when project last activity is missing or stale', () => {
    const updatedOnly = makeSession({
      id: 'updated-only',
      workDir: '/tmp/updated-only',
      lastActivityAt: '',
      updatedAt: '2026-04-28T16:00:00.000Z',
      createdAt: '2026-04-28T09:00:00.000Z',
    })
    const liveActivity = makeSession({
      id: 'live-activity',
      workDir: '/tmp/live-activity',
      lastActivityAt: '2026-04-28T10:00:00.000Z',
      updatedAt: '2026-04-28T10:00:00.000Z',
      activity: {
        sessionId: 'live-activity',
        runId: 'r2',
        runPhase: 'streaming_text',
        startedAt: '2026-04-28T10:00:00.000Z',
        updatedAt: '2026-04-28T17:00:00.000Z',
      },
    })
    const normal = makeSession({
      id: 'normal-project',
      workDir: '/tmp/normal-project',
      lastActivityAt: '2026-04-28T15:00:00.000Z',
      updatedAt: '2026-04-28T15:00:00.000Z',
    })

    const sorted = sortProjects(groupSessionsIntoProjects([normal, updatedOnly, liveActivity]))

    expect(sorted.map((item) => item.latestSessionId)).toEqual([
      'live-activity',
      'updated-only',
      'normal-project',
    ])
  })

  it('falls back to project creation time and then path for stable ordering', () => {
    const newerCreated = makeSession({
      id: 'newer-created',
      workDir: '/tmp/newer-created',
      lastActivityAt: '',
      updatedAt: '',
      createdAt: '2026-04-28T12:00:00.000Z',
    })
    const alpha = makeSession({
      id: 'alpha',
      workDir: '/tmp/alpha',
      lastActivityAt: '',
      updatedAt: '',
      createdAt: '2026-04-28T10:00:00.000Z',
    })
    const beta = makeSession({
      id: 'beta',
      workDir: '/tmp/beta',
      lastActivityAt: '',
      updatedAt: '',
      createdAt: '2026-04-28T10:00:00.000Z',
    })

    const sorted = sortProjects(groupSessionsIntoProjects([beta, newerCreated, alpha]))

    expect(sorted.map((item) => item.key)).toEqual([
      'm1:/tmp/newer-created',
      'm1:/tmp/alpha',
      'm1:/tmp/beta',
    ])
  })
})
