// @arch open-source/docs/server-runtime.md
// @covers src/relay/project-fs-sensitive-relay.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_FS_AUTHORITY_PARAM, type ReqFrame } from '@shennian/wire'
import { ProjectFsSensitiveRelay } from '../relay/project-fs-sensitive-relay.js'

const projectRef = 'p'.repeat(32)
const token = 't'.repeat(32)

function socket() {
  return { OPEN: 1, readyState: 1, send: vi.fn() }
}

function request(id: string): ReqFrame {
  const params = { projectRef }
  return {
    type: 'req', id, method: 'project.fs.open',
    params: {
      [PROJECT_FS_AUTHORITY_PARAM]: {
        version: 1, requestId: id, method: 'project.fs.open', params,
        authority: {
          projectRef, scopeId: token, accountScope: token, machineId: 'machine-1',
          projectId: 'project-1', rootPath: '/private/project', rootDigest: token,
          authorizationEpoch: 1, daemonInstallationId: 'daemon-1', generation: token,
          expiresAt: Date.now() + 60_000,
        },
        signature: 's'.repeat(43),
      },
    },
  }
}

function success(id: string) {
  return JSON.stringify({
    type: 'res', id, ok: true,
    payload: {
      leaseId: token,
      root: { handle: token, name: 'project', kind: 'directory' },
      page: { directoryHandle: token, cursor: 0, nextCursor: null, entries: [] },
      expiresAt: Date.now() + 60_000,
    },
  })
}

describe('project fs sensitive response relay', () => {
  const relays: ProjectFsSensitiveRelay[] = []
  afterEach(() => {
    for (const relay of relays) relay.reset()
    relays.length = 0
  })

  function relay() {
    const value = new ProjectFsSensitiveRelay()
    relays.push(value)
    return value
  }

  it('routes a validated response only to the requesting socket', () => {
    const value = relay()
    const owner = socket()
    const other = socket()
    const frame = request('owner-request')
    value.registerClientRequest({ socket: owner as never, mode: 'multiplex', machineId: 'machine-1', frame })
    value.registerClientRequest({ socket: other as never, mode: 'multiplex', machineId: 'machine-1', frame: request('other-request') })
    expect(value.observeForwardedRequest('machine-1', frame)).toBe(true)
    expect(value.routeMachineFrame('machine-1', success(frame.id))).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('owner-request'))
    expect(other.send).not.toHaveBeenCalled()
  })

  it('consumes malformed/path-bearing daemon responses and returns only a generic rejection', () => {
    const value = relay()
    const owner = socket()
    const frame = request('malformed-response')
    value.registerClientRequest({ socket: owner as never, mode: 'legacy', machineId: 'machine-1', frame })
    value.observeForwardedRequest('machine-1', frame)
    expect(value.routeMachineFrame('machine-1', JSON.stringify({
      type: 'res', id: frame.id, ok: true, payload: { path: '/private/project/secret' },
    }))).toBe(true)
    const delivered = String(owner.send.mock.calls[0]?.[0])
    expect(delivered).toContain('io_error')
    expect(delivered).not.toContain('/private/project')
  })

  it('drops late responses after client disconnect and rejects duplicate request ids', () => {
    const value = relay()
    const owner = socket()
    const frame = request('late-response')
    value.registerClientRequest({ socket: owner as never, mode: 'legacy', machineId: 'machine-1', frame })
    expect(() => value.registerClientRequest({
      socket: socket() as never, mode: 'legacy', machineId: 'machine-1', frame,
    })).toThrow('request_id_conflict')
    value.observeForwardedRequest('machine-1', frame)
    value.closeSocket(owner as never)
    expect(value.routeMachineFrame('machine-1', success(frame.id))).toBe(true)
    expect(owner.send).not.toHaveBeenCalled()
  })

  it('does not claim a response from another machine', () => {
    const value = relay()
    const frame = request('wrong-machine')
    value.observeForwardedRequest('machine-1', frame)
    expect(value.routeMachineFrame('machine-2', success(frame.id))).toBe(false)
  })
})
