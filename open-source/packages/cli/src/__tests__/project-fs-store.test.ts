// @arch open-source/docs/cli-runtime.md
// @covers src/session/project-fs-store.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ProjectFsHandleStore,
  ProjectFsStoreError,
  type TrustedProjectFsAuthority,
} from '../session/project-fs-store.js'

const PROJECT_REF = 'p'.repeat(32)

describe('project-scoped opaque file handle store', () => {
  let root = ''
  let clock = 1_800_000_000_000
  let tokenCounter = 0
  let store: ProjectFsHandleStore

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-project-fs-'))
    clock = 1_800_000_000_000
    tokenCounter = 0
    store = new ProjectFsHandleStore({
      now: () => clock,
      randomToken: () => `token_${String(++tokenCounter).padStart(40, '0')}`,
    })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function authority(overrides: Partial<TrustedProjectFsAuthority> = {}): TrustedProjectFsAuthority {
    return {
      projectRef: PROJECT_REF,
      scopeId: 'server-scope',
      accountScope: 'account-digest',
      machineId: 'machine-1',
      projectId: 'project-1',
      rootPath: fs.realpathSync.native(root),
      rootDigest: 'root-digest',
      authorizationEpoch: 4,
      daemonInstallationId: 'daemon-installation',
      generation: 'generation-1',
      expiresAt: clock + 60 * 60_000,
      ...overrides,
    }
  }

  it('pages a stable sorted snapshot, expands a directory, and reads exact chunks', async () => {
    fs.writeFileSync(path.join(root, 'z.txt'), 'abcdef')
    fs.mkdirSync(path.join(root, 'folder'))
    fs.writeFileSync(path.join(root, 'folder', 'inside.md'), '# hello')
    fs.writeFileSync(path.join(root, '.env'), 'fake-test-only')

    const opened = await store.open(authority(), { projectRef: PROJECT_REF, limit: 1 })
    expect(opened.page.entries.map((entry) => entry.name)).toEqual(['folder'])
    expect(opened.page.nextCursor).toBe(1)
    expect(JSON.stringify(opened)).not.toContain(root)
    expect(JSON.stringify(opened)).not.toContain('.env')

    const second = await store.list(authority(), {
      projectRef: PROJECT_REF,
      leaseId: opened.leaseId,
      directoryHandle: opened.root.handle,
      cursor: opened.page.nextCursor!,
      limit: 1,
    })
    expect(second.entries.map((entry) => entry.name)).toEqual(['z.txt'])
    expect(second.nextCursor).toBeNull()

    const folder = opened.page.entries[0]!
    const nested = await store.list(authority(), {
      projectRef: PROJECT_REF,
      leaseId: opened.leaseId,
      directoryHandle: folder.handle,
      cursor: 0,
    })
    expect(nested.entries.map((entry) => entry.name)).toEqual(['inside.md'])

    const file = second.entries[0]!
    const firstRead = await store.read(authority(), {
      projectRef: PROJECT_REF,
      leaseId: opened.leaseId,
      fileHandle: file.handle,
      offset: 0,
      limitBytes: 2,
      encoding: 'binary',
    })
    expect(Buffer.from(firstRead.dataBase64!, 'base64').toString()).toBe('ab')
    expect(firstRead.nextOffset).toBe(2)
    const finalRead = await store.read(authority(), {
      projectRef: PROJECT_REF,
      leaseId: opened.leaseId,
      fileHandle: file.handle,
      offset: 2,
      limitBytes: 10,
    })
    expect(Buffer.from(finalRead.dataBase64!, 'base64').toString()).toBe('cdef')
    expect(finalRead.nextOffset).toBeNull()
  })

  it('invalidates leases across account, machine, root, authorization, daemon, and generation changes', async () => {
    fs.writeFileSync(path.join(root, 'one.txt'), 'one')
    const dimensions: Array<Partial<TrustedProjectFsAuthority>> = [
      { accountScope: 'other-account' },
      { machineId: 'machine-2' },
      { projectId: 'project-2' },
      { rootDigest: 'other-root' },
      { authorizationEpoch: 5 },
      { daemonInstallationId: 'other-daemon' },
      { generation: 'generation-2' },
    ]
    for (const changed of dimensions) {
      const opened = await store.open(authority(), { projectRef: PROJECT_REF })
      await expect(store.list(authority(changed), {
        projectRef: PROJECT_REF,
        leaseId: opened.leaseId,
        directoryHandle: opened.root.handle,
      })).rejects.toBeInstanceOf(ProjectFsStoreError)
      store.revokeAll()
    }
  })

  it('expires, closes, and explicitly revokes every handle without retaining restart state', async () => {
    fs.writeFileSync(path.join(root, 'one.txt'), 'one')
    const opened = await store.open(authority(), { projectRef: PROJECT_REF })
    store.close(authority(), PROJECT_REF, opened.leaseId)
    await expect(store.list(authority(), {
      projectRef: PROJECT_REF,
      leaseId: opened.leaseId,
      directoryHandle: opened.root.handle,
    })).rejects.toMatchObject({ code: 'handle_invalid' })

    const reopened = await store.open(authority(), { projectRef: PROJECT_REF })
    store.revokeScope('server-scope')
    await expect(store.list(authority(), {
      projectRef: PROJECT_REF,
      leaseId: reopened.leaseId,
      directoryHandle: reopened.root.handle,
    })).rejects.toMatchObject({ code: 'handle_invalid' })

    const expiring = await store.open(authority(), { projectRef: PROJECT_REF })
    clock += 11 * 60_000
    await expect(store.list(authority(), {
      projectRef: PROJECT_REF,
      leaseId: expiring.leaseId,
      directoryHandle: expiring.root.handle,
    })).rejects.toMatchObject({ code: 'handle_invalid' })
  })

  it('fails closed on snapshot mutations, discontinuous reads, oversized reads, and file replacement', async () => {
    fs.writeFileSync(path.join(root, 'one.txt'), '1234')
    fs.writeFileSync(path.join(root, 'two.txt'), '5678')
    const opened = await store.open(authority(), { projectRef: PROJECT_REF, limit: 1 })
    fs.writeFileSync(path.join(root, 'three.txt'), '9')
    await expect(store.list(authority(), {
      projectRef: PROJECT_REF,
      leaseId: opened.leaseId,
      directoryHandle: opened.root.handle,
      cursor: 1,
      limit: 1,
    })).rejects.toMatchObject({ code: 'source_changed' })

    fs.unlinkSync(path.join(root, 'three.txt'))
    const fresh = await store.open(authority(), { projectRef: PROJECT_REF })
    const file = fresh.page.entries.find((entry) => entry.name === 'one.txt')!
    await expect(store.read(authority(), {
      projectRef: PROJECT_REF,
      leaseId: fresh.leaseId,
      fileHandle: file.handle,
      offset: 1,
      limitBytes: 1,
    })).rejects.toMatchObject({ code: 'source_changed' })
    await expect(store.read(authority(), {
      projectRef: PROJECT_REF,
      leaseId: fresh.leaseId,
      fileHandle: file.handle,
      offset: 0,
      limitBytes: 256 * 1024 + 1,
    })).rejects.toMatchObject({ code: 'read_too_large' })

    fs.renameSync(path.join(root, 'one.txt'), path.join(root, 'old.txt'))
    fs.writeFileSync(path.join(root, 'one.txt'), '1234')
    await expect(store.read(authority(), {
      projectRef: PROJECT_REF,
      leaseId: fresh.leaseId,
      fileHandle: file.handle,
      offset: 0,
      limitBytes: 1,
    })).rejects.toMatchObject({ code: 'source_changed' })
  })

  it('does not issue handles for symlinks, hard links, hidden credentials, or non-regular entries', async () => {
    fs.writeFileSync(path.join(root, 'safe.txt'), 'safe')
    fs.linkSync(path.join(root, 'safe.txt'), path.join(root, 'hard.txt'))
    fs.symlinkSync(os.tmpdir(), path.join(root, 'escape'))
    fs.mkdirSync(path.join(root, '.ssh'))
    const opened = await store.open(authority(), { projectRef: PROJECT_REF })
    expect(opened.page.entries).toEqual([])
  })

  it('denies protected roots and enforces the per-account-machine lease ceiling', async () => {
    const protectedStore = new ProjectFsHandleStore({
      protectedRoots: () => [fs.realpathSync.native(root)],
    })
    await expect(protectedStore.open(authority(), { projectRef: PROJECT_REF }))
      .rejects.toMatchObject({ code: 'sensitive_path_denied' })

    for (let index = 0; index < 8; index += 1) {
      await store.open(authority({ projectId: `project-${index}` }), { projectRef: PROJECT_REF })
    }
    await expect(store.open(authority({ projectId: 'project-over-limit' }), {
      projectRef: PROJECT_REF,
    })).rejects.toMatchObject({ code: 'rate_limited' })
  })
})
