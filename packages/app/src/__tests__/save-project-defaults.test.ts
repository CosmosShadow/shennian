// @covers packages/app/src/features/projects/services/saveProjectDefaults.ts
import { describe, expect, it, vi } from 'vitest'
import type { NianProject } from '@shennian/wire'
import { saveProjectDefaults } from '../features/projects/services/saveProjectDefaults'

describe('save project defaults', () => {
  const target = { id: '', machineId: 'windows', workDir: 'C:/Users/simpl' }
  const defaults = { defaultAgentType: 'opencode' as const, defaultModelId: 'shennian-bailian/deepseek-v4-flash-0731' }
  const project = { ...target, id: 'project-real', ...defaults } as NianProject
  it('materializes a session-only group before PATCH and returns the persisted defaults', async () => {
    const createProject = vi.fn().mockResolvedValue(project)
    const updateDefaults = vi.fn().mockResolvedValue(project)
    expect(await saveProjectDefaults(target, defaults, { createProject, updateDefaults })).toEqual(project)
    expect(createProject).toHaveBeenCalledWith('windows', target.workDir)
    expect(updateDefaults).toHaveBeenCalledWith('project-real', defaults)
  })
  it('uses an existing project ID without creating another project', async () => {
    const createProject = vi.fn()
    const updateDefaults = vi.fn().mockResolvedValue(project)
    await saveProjectDefaults(project, defaults, { createProject, updateDefaults })
    expect(createProject).not.toHaveBeenCalled()
  })
  it('never sends a malformed PATCH if project creation fails or returns no ID', async () => {
    const updateDefaults = vi.fn()
    await expect(saveProjectDefaults(target, defaults, {
      createProject: vi.fn().mockRejectedValue(new Error('offline')), updateDefaults,
    })).rejects.toThrow('offline')
    await expect(saveProjectDefaults(target, defaults, {
      createProject: vi.fn().mockResolvedValue(target), updateDefaults,
    })).rejects.toThrow('Project ID')
    expect(updateDefaults).not.toHaveBeenCalled()
  })
})
