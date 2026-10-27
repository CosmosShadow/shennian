// @covers packages/app/src/features/projects/projectAccountClient.web.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectAccountClient } from '../features/projects/projectAccountClient.web'

const defaults = { defaultAgentType: 'codex' as const, defaultModelId: null }
const project = { id: 'project-1', machineId: 'machine-1', workDir: '/work', ...defaults }
afterEach(() => vi.unstubAllGlobals())

describe('Desktop project defaults', () => {
  it('uses the fixed main command and returns persisted defaults', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, value: { project } })
    vi.stubGlobal('shennianDesktop', { account: { execute } })
    expect(await projectAccountClient.updateDefaults(project.id, defaults)).toEqual(project)
    expect(execute).toHaveBeenCalledWith({
      requestId: expect.any(String), operation: 'project.defaults.update',
      input: { projectId: project.id, ...defaults },
    })
  })
  it('fails without a bridge without sending an HTTP request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('shennianDesktop', undefined)
    await expect(projectAccountClient.updateDefaults(project.id, defaults))
      .rejects.toMatchObject({ code: 'BRIDGE_UNAVAILABLE' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves main permission failures and never retries', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: false,
      error: { code: 'FORBIDDEN', message: 'Access denied', retryable: false } })
    vi.stubGlobal('shennianDesktop', { account: { execute } })
    await expect(projectAccountClient.updateDefaults(project.id, defaults))
      .rejects.toMatchObject({ code: 'FORBIDDEN', retryable: false })
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it.each([null, {}, { project: { ...project, id: 'another-project' } },
    { project: { ...project, defaultAgentType: 'claude' } }])(
    'rejects incomplete or mismatched persisted results: %j', async (value) => {
      vi.stubGlobal('shennianDesktop', { account: {
        execute: vi.fn().mockResolvedValue({ ok: true, value }),
      } })
      await expect(projectAccountClient.updateDefaults(project.id, defaults))
        .rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    },
  )
})
