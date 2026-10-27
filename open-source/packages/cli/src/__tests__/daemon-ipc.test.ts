// @covers open-source/packages/cli/src/daemon-ipc/server.ts
// @covers open-source/packages/cli/src/daemon-ipc/client.ts
// @covers open-source/packages/cli/src/daemon-ipc/paths.ts
// @covers open-source/packages/cli/src/daemon-ipc/secret.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import {
  getManagedRoomIpcRoot,
  resolveDaemonIpcPaths,
  resolveManagedRoomIpcPaths,
} from '../daemon-ipc/paths.js'
import {
  DAEMON_IPC_MAX_REQUEST_BYTES,
  DAEMON_IPC_VERSION,
} from '../daemon-ipc/protocol.js'
import {
  assertUnixSocketEndpointLength,
  daemonIpcListenOptions,
  startDaemonIpcServer,
  timingSafeSecretEqual,
} from '../daemon-ipc/server.js'
import { readDaemonIpcSecret } from '../daemon-ipc/secret.js'

const roots: string[] = []

function tempPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdi-'))
  roots.push(root)
  return resolveDaemonIpcPaths(root, process.platform)
}

// The reserved Vitest unit-fixture directory (see vitest.config.ts) already
// consumes part of the macOS 104-byte sockaddr_un budget; how much is left
// depends on the OS-assigned os.tmpdir() length for this session. Probe once
// so sessions where a real Unix socket cannot fit skip instead of failing.
const socketPathTooLongForThisEnvironment = (() => {
  if (process.platform === 'win32') return false
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdi-'))
  try {
    assertUnixSocketEndpointLength(resolveDaemonIpcPaths(probeRoot, process.platform).endpoint, process.platform)
    return false
  } catch {
    return true
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true })
  }
})()

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('daemon local IPC', () => {
  it('keeps the managed Room bridge outside the persistent Shennian credential tree', () => {
    const shennianDir = path.join(os.tmpdir(), 'user-home', '.shennian')
    const managedRoot = getManagedRoomIpcRoot(shennianDir)
    const managedPaths = resolveManagedRoomIpcPaths(managedRoot, process.platform)

    expect(path.relative(shennianDir, managedRoot)).toMatch(/^\.\./)
    expect(managedPaths.runtimeDirectory).toBe(path.join(managedRoot, 'runtime'))
    expect(getManagedRoomIpcRoot(shennianDir)).toBe(managedRoot)
    expect(getManagedRoomIpcRoot(path.join(os.tmpdir(), 'other-home', '.shennian'))).not.toBe(
      managedRoot,
    )
  })

  it('keeps the managed Room Unix socket below the macOS sockaddr_un path limit', () => {
    const macTempDirectory = '/var/folders/yr/8dxgxmd51l7ds1rgyd2_bz5h0000gn/T'
    const managedRoot = getManagedRoomIpcRoot('/Users/demo/.shennian', macTempDirectory)
    const paths = resolveManagedRoomIpcPaths(managedRoot, 'darwin')

    expect(Buffer.byteLength(paths.endpoint, 'utf8')).toBeLessThan(104)
  })

  it.skipIf(process.platform !== 'darwin')(
    'uses the canonical macOS temp path for restricted Unix-socket access',
    () => {
      const managedRoot = getManagedRoomIpcRoot('/Users/demo/.shennian', os.tmpdir())
      expect(path.dirname(managedRoot)).toBe(fs.realpathSync.native(os.tmpdir()))
    },
  )

  it('fails clearly before macOS can silently truncate an oversized Unix socket path', () => {
    expect(() => assertUnixSocketEndpointLength(`/${'x'.repeat(104)}`, 'darwin')).toThrowError(
      expect.objectContaining({ code: 'ipc_endpoint_too_long' }),
    )
  })

  it('uses a user-scoped Windows named pipe without placing credentials in its name', () => {
    const first = resolveDaemonIpcPaths('C:\\Users\\alice\\.shennian', 'win32')
    const second = resolveDaemonIpcPaths('C:\\Users\\bob\\.shennian', 'win32')
    expect(first.transport).toBe('windows_named_pipe')
    expect(first.endpoint).toMatch(/^\\\\\.\\pipe\\shennian-daemon-[a-f0-9]{20}$/)
    expect(first.endpoint).not.toBe(second.endpoint)
    expect(first.endpoint).not.toContain('alice')
    expect(daemonIpcListenOptions(first)).toEqual({
      path: first.endpoint,
      readableAll: false,
      writableAll: false,
    })
  })

  it('compares every string credential through a fixed-length timing-safe buffer', () => {
    const timingSafeEqual = vi.spyOn(crypto, 'timingSafeEqual')
    const secret = 'daemon-ipc-secret-value-that-is-long-enough-123456'
    expect(timingSafeSecretEqual(secret, secret)).toBe(true)
    expect(timingSafeSecretEqual(`${secret.slice(0, -1)}x`, secret)).toBe(false)
    expect(timingSafeSecretEqual('short', secret)).toBe(false)
    expect(timingSafeSecretEqual(`${secret}too-long`, secret)).toBe(false)
    expect(timingSafeSecretEqual(null, secret)).toBe(false)
    expect(timingSafeEqual).toHaveBeenCalledTimes(4)
  })

  it.skipIf(process.platform === 'win32' || socketPathTooLongForThisEnvironment)(
    'serves authenticated requests over a private Unix socket',
    async () => {
      const paths = tempPaths()
      const server = await startDaemonIpcServer({
        paths,
        handlers: {
          'room.echo': (params) => ({ echoed: params ?? null }),
        },
      })
      try {
        await expect(
          callDaemonIpc({ method: 'room.echo', params: { hello: 'world' }, paths }),
        ).resolves.toEqual({
          echoed: { hello: 'world' },
        })
        expect(fs.statSync(paths.runtimeDirectory).mode & 0o777).toBe(0o700)
        expect(fs.statSync(paths.endpoint).mode & 0o777).toBe(0o600)
        expect(fs.statSync(paths.secretFile).mode & 0o777).toBe(0o600)
      } finally {
        await server.close()
      }
    },
  )

  it.skipIf(process.platform === 'win32' || socketPathTooLongForThisEnvironment)(
    'rejects requests without the private secret and never echoes it',
    async () => {
      const paths = tempPaths()
      const server = await startDaemonIpcServer({
        paths,
        handlers: { 'room.echo': () => ({ ok: true }) },
      })
      try {
        const response = await rawRequest(paths.endpoint, {
          version: DAEMON_IPC_VERSION,
          requestId: 'request_1',
          auth: 'not-the-secret',
          method: 'room.echo',
        })
        expect(response).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
        expect(JSON.stringify(response)).not.toContain(readDaemonIpcSecret(paths.secretFile))
      } finally {
        await server.close()
      }
    },
  )

  it.skipIf(process.platform === 'win32')(
    'rejects a secret file that is readable by another local user',
    () => {
      const paths = tempPaths()
      fs.mkdirSync(paths.runtimeDirectory, { recursive: true, mode: 0o700 })
      fs.writeFileSync(paths.secretFile, `${'s'.repeat(48)}\n`, { mode: 0o644 })
      fs.chmodSync(paths.secretFile, 0o644)

      expect(() => readDaemonIpcSecret(paths.secretFile)).toThrowError(
        expect.objectContaining({ code: 'unsafe_ipc_secret_permissions' }),
      )
    },
  )

  it.skipIf(process.platform === 'win32' || socketPathTooLongForThisEnvironment)(
    'bounds both request and response payloads',
    async () => {
      const paths = tempPaths()
      const server = await startDaemonIpcServer({
        paths,
        handlers: {
          'room.echo': (params) => params ?? null,
          'room.oversized': () => 'x'.repeat(DAEMON_IPC_MAX_REQUEST_BYTES),
        },
      })
      try {
        await expect(
          rawRequest(paths.endpoint, {
            version: DAEMON_IPC_VERSION,
            requestId: 'request-too-large',
            auth: readDaemonIpcSecret(paths.secretFile),
            method: 'room.echo',
            params: 'x'.repeat(DAEMON_IPC_MAX_REQUEST_BYTES),
          }),
        ).resolves.toMatchObject({ ok: false, error: { code: 'request_too_large' } })
        await expect(callDaemonIpc({ method: 'room.oversized', paths })).rejects.toMatchObject({
          code: 'response_too_large',
        })
      } finally {
        await server.close()
      }
    },
  )

  it.skipIf(process.platform === 'win32' || socketPathTooLongForThisEnvironment)(
    'refuses to replace a symlink or regular file at the socket path',
    async () => {
      const paths = tempPaths()
      fs.mkdirSync(paths.runtimeDirectory, { recursive: true })
      fs.writeFileSync(paths.endpoint, 'do not replace')
      await expect(startDaemonIpcServer({ paths, handlers: {} })).rejects.toMatchObject({
        code: 'unsafe_ipc_endpoint',
      })
      expect(fs.readFileSync(paths.endpoint, 'utf8')).toBe('do not replace')
    },
  )
})

function rawRequest(endpoint: string, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    let response = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk: string) => {
      response += chunk
      const newline = response.indexOf('\n')
      if (newline >= 0) {
        socket.destroy()
        resolve(JSON.parse(response.slice(0, newline)))
      }
    })
    socket.once('error', reject)
  })
}
