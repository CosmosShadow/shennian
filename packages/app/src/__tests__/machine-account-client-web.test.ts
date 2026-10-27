/**
 * @covers packages/app/src/features/machines/machineAccountClient.web.ts
 * @covers packages/app/src/features/machines/machineAccountClient.native.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopMachineAccountError,
  machineAccountClient,
} from '../features/machines/machineAccountClient.web'

type DesktopRoot = typeof globalThis & { shennianDesktop?: unknown }

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

afterEach(() => {
  delete (globalThis as DesktopRoot).shennianDesktop
})

describe('Desktop machine account client', () => {
  it('fails closed when the main-process account bridge is absent', async () => {
    await expect(machineAccountClient.listMachines()).rejects.toEqual(
      expect.objectContaining<Partial<DesktopMachineAccountError>>({
        name: 'DesktopMachineAccountError',
        code: 'BRIDGE_UNAVAILABLE',
      }),
    )
  })

  it('uses only fixed machine-domain operations', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { machines: [{ id: 'machine-1', name: 'Studio', os: 'darwin', agentList: [] }] },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { grantId: 'grant-1', inviteUrl: 'https://example.test/invite', expiresAt: null },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { project: { id: 'project-1', machineId: 'machine-1', workDir: '/work' } },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { session: { id: 'session-1' } },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { agents: [{ id: 'acp-1', name: 'ACP One', platforms: ['darwin-arm64'] }] },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { machineName: 'Studio', ownerName: 'Alice', expiresAt: null },
      })
      .mockResolvedValueOnce({ ok: true, value: { machineId: 'machine-1' } })
    ;(globalThis as DesktopRoot).shennianDesktop = { account: { execute } }

    await expect(machineAccountClient.listMachines()).resolves.toHaveLength(1)
    await expect(machineAccountClient.createGrant('machine-1')).resolves.toEqual({
      grantId: 'grant-1',
      inviteUrl: 'https://example.test/invite',
      expiresAt: null,
    })
    await expect(machineAccountClient.createProject('machine-1', '/work')).resolves.toEqual(
      expect.objectContaining({ id: 'project-1' }),
    )
    await expect(
      machineAccountClient.createSession({
        machineId: 'machine-1',
        agentType: 'codex',
        workDir: '/work',
        sessionMode: 'standard',
      }),
    ).resolves.toEqual({ id: 'session-1' })
    await expect(machineAccountClient.listAgentCatalog()).resolves.toEqual([
      { id: 'acp-1', name: 'ACP One', platforms: ['darwin-arm64'] },
    ])
    await expect(machineAccountClient.previewGrant('share-token')).resolves.toEqual({
      machineName: 'Studio', ownerName: 'Alice', expiresAt: null,
    })
    await expect(machineAccountClient.redeemGrant('share-token')).resolves.toBe('machine-1')

    expect(execute.mock.calls.map(([command]) => command.operation)).toEqual([
      'machine.list',
      'machine.grant.create',
      'project.create',
      'session.create',
      'machine.agentCatalog.list',
      'machine.grant.preview',
      'machine.grant.redeem',
    ])
    expect(execute).toHaveBeenNthCalledWith(4, {
      requestId: expect.stringMatching(/^machine-account-/),
      operation: 'session.create',
      input: {
        machineId: 'machine-1',
        agentType: 'codex',
        workDir: '/work',
        settings: { sessionMode: 'standard' },
      },
    })
    expect(JSON.stringify(execute.mock.calls)).not.toContain('/machines')
    expect(JSON.stringify(execute.mock.calls)).not.toContain('POST')
    expect(JSON.stringify(execute.mock.calls)).not.toContain('Authorization')
    expect(execute).toHaveBeenNthCalledWith(6, {
      requestId: expect.stringMatching(/^machine-account-/),
      operation: 'machine.grant.preview',
      input: { shareToken: 'share-token' },
    })
    expect(execute).toHaveBeenNthCalledWith(7, {
      requestId: expect.stringMatching(/^machine-account-/),
      operation: 'machine.grant.redeem',
      input: { shareToken: 'share-token' },
    })
  })

  it('rejects malformed main-process responses', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, value: { machines: [{ id: 1 }] } })
    ;(globalThis as DesktopRoot).shennianDesktop = { account: { execute } }

    await expect(machineAccountClient.listMachines()).rejects.toEqual(
      expect.objectContaining({ code: 'INVALID_OUTPUT' }),
    )
  })

  it('accepts old pairing responses without inventing a target machine', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ok:true,value:undefined}).mockResolvedValueOnce({ok:true,value:{machine:{id:'paired-machine'}}})
    ;(globalThis as DesktopRoot).shennianDesktop = {account:{execute}}
    expect(await machineAccountClient.claimPair('old-code')).toEqual({machineId:undefined})
    expect(await machineAccountClient.claimPair('new-code')).toEqual({machineId:'paired-machine'})
  })

  it('keeps authenticated HTTP inside the native adapter', () => {
    const native = read('../features/machines/machineAccountClient.native.ts')
    const web = read('../features/machines/machineAccountClient.web.ts')
    const callsites = [
      '../features/machines/screens/MachinesScreen.tsx',
      '../features/machines/screens/MachineDetailScreen.tsx',
      '../features/machines/screens/MachineAgentsScreen.tsx',
      '../features/machines/components/MachinePickerCard.tsx',
      '../features/machines/screens/CreateProjectScreen.tsx',
      '../features/machines/screens/MachineInstallScreen.tsx',
      '../features/machines/hooks/useMachineCardActions.ts',
      '../features/machines/hooks/useMachineLaunchState.ts',
      '../features/machine-sharing/MachineInviteAcceptanceScreen.tsx',
      '../features/machine-sharing/MachineSharingScreen.tsx',
    ].map(read)

    expect(native).toContain("import { authApi } from '../../config/api'")
    expect(web).not.toContain('authApi')
    expect(web).not.toContain("'/machines")
    expect(web).not.toContain("'/sessions")
    expect(web).not.toContain("'/projects")
    for (const source of callsites) {
      expect(source).not.toContain('authApi')
      expect(source).toContain('machineAccountClient')
    }
  })
})
