// @covers packages/app/src/features/agents/agentAccountClient.web.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopAgentAccountError,
  agentAccountClient,
} from '../features/agents/agentAccountClient.web'

type DesktopRoot = typeof globalThis & { shennianDesktop?: unknown }

afterEach(() => {
  delete (globalThis as DesktopRoot).shennianDesktop
})
describe('Desktop Agent account client', () => {
  it('fails closed when the main-process account bridge is absent', async () => {
    await expect(agentAccountClient.listAgents()).rejects.toEqual(
      expect.objectContaining<Partial<DesktopAgentAccountError>>({
        name: 'DesktopAgentAccountError',
        code: 'BRIDGE_UNAVAILABLE',
      }),
    )
  })

  it('uses fixed Agent operations without exposing an HTTP path or method', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { agents: [{ id: 'agent-1', displayName: 'Reviewer' }] },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { agent: { id: 'agent-2', displayName: 'Builder' } },
      })
    ;(globalThis as DesktopRoot).shennianDesktop = { account: { execute } }

    await expect(agentAccountClient.listAgents()).resolves.toEqual([
      { id: 'agent-1', displayName: 'Reviewer' },
    ])
    await expect(
      agentAccountClient.createAgent({ displayName: 'Builder', machineId: 'machine-1' }),
    ).resolves.toEqual({ id: 'agent-2', displayName: 'Builder' })

    expect(execute).toHaveBeenNthCalledWith(1, {
      requestId: expect.stringMatching(/^agent-account-/),
      operation: 'agent.list',
      input: {},
    })
    expect(execute).toHaveBeenNthCalledWith(2, {
      requestId: expect.stringMatching(/^agent-account-/),
      operation: 'agent.create',
      input: { definition: { displayName: 'Builder', machineId: 'machine-1' } },
    })
    expect(JSON.stringify(execute.mock.calls)).not.toContain('/agents')
    expect(JSON.stringify(execute.mock.calls)).not.toContain('PATCH')
  })

  it('serializes avatar bytes for the main process instead of sending Blob objects', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      value: { avatar: { url: 'avatar.jpg' } },
    })
    ;(globalThis as DesktopRoot).shennianDesktop = { account: { execute } }

    await agentAccountClient.setAgentAvatar(
      'agent-1',
      new Blob([new Uint8Array([1, 2, 3])]),
      'image/jpeg',
    )

    expect(execute).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^agent-account-/),
      operation: 'agent.avatar.set',
      input: {
        agentId: 'agent-1',
        contentType: 'image/jpeg',
        base64: 'AQID',
      },
    })
  })
})
