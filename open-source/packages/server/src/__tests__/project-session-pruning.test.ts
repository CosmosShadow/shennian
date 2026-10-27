// @covers open-source/packages/server/src/services/project-session-pruning.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listProjectSessions: vi.fn(),
  deleteSessionForUser: vi.fn(),
}))

vi.mock('../services/sessions.js', () => mocks)

import { pruneOldestProjectSessions } from '../services/project-session-pruning.js'

function session(
  id: string,
  opts?: { userId?: string; pinned?: boolean; running?: boolean; activityAt?: string },
) {
  return {
    id,
    userId: opts?.userId ?? 'user-1',
    lastActivityAt: opts?.activityAt ?? '2026-01-01T00:00:00.000Z',
    userState: opts?.pinned ? { pinnedAt: '2026-01-02T00:00:00.000Z' } : null,
    activity: opts?.running ? { runPhase: 'thinking' } : null,
  }
}

describe('project session pruning', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes only the oldest owned conversations that are neither pinned nor running', async () => {
    mocks.listProjectSessions.mockResolvedValue([
      session('pinned', { pinned: true }),
      session('running', { running: true }),
      session('shared', { userId: 'user-2' }),
      session('eligible-1', { activityAt: '2026-01-04T00:00:00.000Z' }),
      session('eligible-2', { activityAt: '2026-01-05T00:00:00.000Z' }),
      session('eligible-3', { activityAt: '2026-01-06T00:00:00.000Z' }),
    ])

    await expect(
      pruneOldestProjectSessions({
        machineId: 'machine-1',
        workDir: '/code/demo',
        userId: 'user-1',
        count: 2,
      }),
    ).resolves.toEqual({ deletedSessionIds: ['eligible-1', 'eligible-2'], protectedCount: 3 })

    expect(mocks.listProjectSessions).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workDir: '/code/demo',
      userId: 'user-1',
      limit: 10_000,
      order: 'asc',
    })
    expect(mocks.deleteSessionForUser).toHaveBeenNthCalledWith(
      1, 'eligible-1', 'user-1', { nativeCleanupPolicy: 'none' },
    )
    expect(mocks.deleteSessionForUser).toHaveBeenNthCalledWith(
      2, 'eligible-2', 'user-1', { nativeCleanupPolicy: 'none' },
    )
    expect(mocks.deleteSessionForUser).not.toHaveBeenCalledWith('pinned', expect.anything())
    expect(mocks.deleteSessionForUser).not.toHaveBeenCalledWith('running', expect.anything())
  })
})
