// @covers src/features/desktop-files/model/desktopProjectFsClient.ts

import { describe, expect, it, vi } from 'vitest'
import {
  PROJECT_FS_OPAQUE_CAPABILITY,
  type Machine,
  type NianProject,
  type ReqFrame,
  type ResFrame,
} from '@shennian/wire'
import type { RelayState } from '@shennian/shared'
import {
  ProjectFsClient,
  ProjectFsClientError,
  type ProjectFsClientContext,
} from '../features/desktop-files/model/desktopProjectFsClient'

const token = (prefix: string) => `${prefix}_${'x'.repeat(40)}`
const projectRef = token('project')
const leaseId = token('lease')
const rootHandle = token('root')
const fileHandle = token('file')

function context(overrides: Partial<ProjectFsClientContext> = {}): ProjectFsClientContext {
  const machine: Machine = {
    id: 'machine-1',
    name: 'Mac',
    os: 'darwin',
    agentList: [],
    paired: true,
    online: true,
    lastSeen: new Date(0).toISOString(),
    daemonInstallationId: 'daemon-1',
    sessionSyncCapabilities: [PROJECT_FS_OPAQUE_CAPABILITY],
  }
  const project: NianProject = {
    id: 'project-1',
    machineId: machine.id,
    machineName: machine.name,
    machineOnline: true,
    workDir: '/legacy/path-not-used',
    displayName: 'Project',
    fileBrowserRef: projectRef,
    lastActivityAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
  return { accountId: 'account-1', authGeneration: 1, machine, project, ...overrides }
}

function openResponse(
  payload: unknown = {
    leaseId,
    root: { handle: rootHandle, name: 'Project', kind: 'directory' },
    page: {
      directoryHandle: rootHandle,
      cursor: 0,
      nextCursor: null,
      entries: [{ handle: fileHandle, name: 'README.md', kind: 'file', size: 3 }],
    },
    expiresAt: 2_000,
  },
): ResFrame {
  return { type: 'res', id: 'response-1', ok: true, payload }
}

function relayFixture(initialState: RelayState = 'connected') {
  let relayState = initialState
  let listener: ((state: RelayState) => void) | null = null
  const sendWhenReady = vi.fn(
    async (_machineId: string, _frame: Omit<ReqFrame, 'id'>): Promise<ResFrame> => openResponse(),
  )
  return {
    relay: {
      getState: vi.fn(() => relayState),
      onStateChange: vi.fn((_machineId: string, next: (state: RelayState) => void) => {
        listener = next
        return () => {
          listener = null
        }
      }),
      sendWhenReady,
    },
    sendWhenReady,
    transition(state: RelayState) {
      relayState = state
      listener?.(state)
    },
  }
}

function projectClient(fixture: ReturnType<typeof relayFixture>): ProjectFsClient {
  return new ProjectFsClient((machineId, method, params) =>
    fixture.sendWhenReady(machineId, { type: 'req', method, params }),
  )
}

describe('project fs path-free client adapter', () => {
  it('fails closed without a live capability, Server project ref, or connected Relay', async () => {
    const cases: ProjectFsClientContext[] = [
      context({ project: { ...context().project!, fileBrowserRef: undefined } }),
      context({ project: { ...context().project!, fileBrowserRef: '/Users/me/project' } }),
      context({ machine: { ...context().machine!, sessionSyncCapabilities: [] } }),
    ]
    for (const candidate of cases) {
      const fixture = relayFixture()
      const client = projectClient(fixture)
      client.setContext(candidate)
      await expect(client.open()).rejects.toMatchObject({ kind: 'unavailable' })
      expect(fixture.sendWhenReady).not.toHaveBeenCalled()
    }

    const offline = relayFixture('disconnected')
    const client = projectClient(offline)
    client.setContext(context({ machine: { ...context().machine!, online: false } }))
    await expect(client.open()).rejects.toMatchObject({ kind: 'offline' })
    expect(offline.sendWhenReady).not.toHaveBeenCalled()
  })

  it('opens with only the opaque project reference and retains path-free metadata', async () => {
    const fixture = relayFixture()
    const client = projectClient(fixture)
    client.setContext(context())
    await client.open(25)

    expect(fixture.sendWhenReady).toHaveBeenCalledWith('machine-1', {
      type: 'req',
      method: 'project.fs.open',
      params: { projectRef, limit: 25 },
    })
    const frame = fixture.sendWhenReady.mock.calls[0]?.[1]
    expect(frame.method).not.toMatch(/^fs\./)
    expect(frame.params).not.toHaveProperty('path')
    expect(frame.params).not.toHaveProperty('workDir')
    expect(frame.params).not.toHaveProperty('__projectFsAuthority')
    expect(client.getState()).toMatchObject({
      availability: 'ready',
      leaseId,
      rootHandle,
      rootName: 'Project',
    })
    expect(client.getState().pages[rootHandle]?.entries[0]).toEqual({
      handle: fileHandle,
      name: 'README.md',
      kind: 'file',
      size: 3,
    })
  })

  it('aborts a pending request and drops its late response after account/project replacement', async () => {
    const fixture = relayFixture()
    let resolveResponse!: (response: ResFrame) => void
    fixture.sendWhenReady.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve
        }),
    )
    const client = projectClient(fixture)
    client.setContext(context())
    const pending = client.open()
    client.setContext(
      context({
        accountId: 'account-2',
        authGeneration: 2,
        project: { ...context().project!, id: 'project-2', fileBrowserRef: token('project-2') },
      }),
    )

    await expect(pending).rejects.toBeInstanceOf(ProjectFsClientError)
    resolveResponse(openResponse())
    await Promise.resolve()
    expect(client.getState()).toMatchObject({
      accountId: 'account-2',
      projectId: 'project-2',
      leaseId: null,
    })
  })

  it('binds directory pages and preview chunks to the current opaque lease', async () => {
    const fixture = relayFixture()
    fixture.sendWhenReady
      .mockResolvedValueOnce(openResponse())
      .mockResolvedValueOnce({
        type: 'res',
        id: 'response-2',
        ok: true,
        payload: {
          leaseId,
          directoryHandle: rootHandle,
          cursor: 0,
          nextCursor: null,
          entries: [{ handle: fileHandle, name: 'README.md', kind: 'file', size: 3 }],
          expiresAt: 2_100,
        },
      })
      .mockResolvedValueOnce({
        type: 'res',
        id: 'response-3',
        ok: true,
        payload: {
          leaseId,
          fileHandle,
          offset: 0,
          bytesRead: 3,
          nextOffset: null,
          totalSize: 3,
          text: 'abc',
          encoding: 'utf-8',
          mimeType: 'text/markdown',
          expiresAt: 2_200,
        },
      })
      .mockResolvedValueOnce({
        type: 'res',
        id: 'response-4',
        ok: true,
        payload: { closed: true },
      })
    const client = projectClient(fixture)
    client.setContext(context())
    await client.open()
    await client.list({ directoryHandle: rootHandle, cursor: 0, limit: 10 })
    await client.read({ fileHandle, offset: 0, limitBytes: 16, encoding: 'auto' })

    expect(fixture.sendWhenReady.mock.calls.slice(1, 3).map((call) => call[1])).toEqual([
      {
        type: 'req',
        method: 'project.fs.list',
        params: { projectRef, leaseId, directoryHandle: rootHandle, cursor: 0, limit: 10 },
      },
      {
        type: 'req',
        method: 'project.fs.read',
        params: { projectRef, leaseId, fileHandle, offset: 0, limitBytes: 16, encoding: 'auto' },
      },
    ])
    expect(client.getState().reads[fileHandle]?.[0]?.text).toBe('abc')
    await client.close()
    expect(client.getState()).toMatchObject({ leaseId: null, pages: {}, reads: {} })
  })

  it('invalidates handles across disconnect and reconnect generations', async () => {
    const fixture = relayFixture()
    const client = projectClient(fixture)
    client.setContext(context())
    await client.open()
    const openedGeneration = client.getState().generation

    client.setContext(context({ machine: { ...context().machine!, online: false } }))
    expect(client.getState()).toMatchObject({ availability: 'offline', leaseId: null })
    expect(client.getState().generation).toBe(openedGeneration + 1)
    client.setContext(context())
    expect(client.getState()).toMatchObject({ availability: 'ready', leaseId: null })
    expect(client.getState().generation).toBe(openedGeneration + 2)
  })

  it('clears authority state on structured revocation and rejects malformed path-bearing results', async () => {
    const revoked = relayFixture()
    revoked.sendWhenReady.mockResolvedValueOnce(openResponse()).mockResolvedValueOnce({
      type: 'res',
      id: 'response-2',
      ok: false,
      error: 'permission_denied',
      payload: {
        rejection: {
          code: 'permission_denied',
          retryable: false,
          requiredAction: 'reauthenticate',
        },
      },
    })
    const client = projectClient(revoked)
    client.setContext(context())
    await client.open()
    await expect(client.list({ directoryHandle: rootHandle })).rejects.toMatchObject({
      kind: 'permission_denied',
    })
    expect(client.getState()).toMatchObject({
      availability: 'permission_denied',
      leaseId: null,
      pages: {},
    })

    const malformed = relayFixture()
    malformed.sendWhenReady.mockResolvedValueOnce(
      openResponse({
        leaseId,
        root: { handle: rootHandle, name: 'Project', kind: 'directory', path: '/private/root' },
        page: { directoryHandle: rootHandle, cursor: 0, nextCursor: null, entries: [] },
        expiresAt: 2_000,
      }),
    )
    const malformedClient = projectClient(malformed)
    malformedClient.setContext(context())
    await expect(malformedClient.open()).rejects.toMatchObject({ kind: 'protocol' })
    expect(malformedClient.getState()).toMatchObject({
      availability: 'error',
      leaseId: null,
      pages: {},
    })
  })
})
