// @covers src/features/desktop-files/model/desktopProjectFsState.ts

import { describe, expect, it } from 'vitest'
import {
  createProjectFsClientState,
  reduceProjectFsClientState,
} from '../features/desktop-files/model/desktopProjectFsState'

const token = (prefix: string) => `${prefix}_${'x'.repeat(40)}`

describe('project fs account/project generation reducer', () => {
  it('clears opaque state on scope replacement and ignores the late prior generation', () => {
    let state = reduceProjectFsClientState(createProjectFsClientState(), {
      type: 'replace_scope',
      accountId: 'account-a',
      machineId: 'machine-a',
      projectId: 'project-a',
      availability: 'ready',
      unavailableReason: null,
    })
    const oldGeneration = state.generation
    state = reduceProjectFsClientState(state, {
      type: 'request_started',
      generation: oldGeneration,
    })
    state = reduceProjectFsClientState(state, {
      type: 'open_succeeded',
      generation: oldGeneration,
      leaseId: token('lease'),
      rootHandle: token('root'),
      rootName: 'Project',
      page: { directoryHandle: token('root'), cursor: 0, nextCursor: null, entries: [] },
      expiresAt: 2_000,
    })
    expect(state.leaseId).toBe(token('lease'))

    state = reduceProjectFsClientState(state, {
      type: 'replace_scope',
      accountId: 'account-b',
      machineId: 'machine-b',
      projectId: 'project-b',
      availability: 'ready',
      unavailableReason: null,
    })
    const replaced = state
    expect(state).toMatchObject({ accountId: 'account-b', leaseId: null, pages: {}, reads: {} })

    state = reduceProjectFsClientState(state, {
      type: 'open_succeeded',
      generation: oldGeneration,
      leaseId: token('late'),
      rootHandle: token('late-root'),
      rootName: 'Leaked',
      page: { directoryHandle: token('late-root'), cursor: 0, nextCursor: null, entries: [] },
      expiresAt: 3_000,
    })
    expect(state).toBe(replaced)
  })

  it('keeps paginated names and preview chunks only inside the current in-memory lease', () => {
    let state = reduceProjectFsClientState(createProjectFsClientState(), {
      type: 'replace_scope',
      accountId: 'account-a',
      machineId: 'machine-a',
      projectId: 'project-a',
      availability: 'ready',
      unavailableReason: null,
    })
    const generation = state.generation
    const root = token('root')
    const file = token('file')
    state = reduceProjectFsClientState(state, {
      type: 'open_succeeded',
      generation,
      leaseId: token('lease'),
      rootHandle: root,
      rootName: 'Project',
      expiresAt: 2_000,
      page: {
        directoryHandle: root,
        cursor: 0,
        nextCursor: 1,
        entries: [{ handle: file, name: 'README.md', kind: 'file', size: 6 }],
      },
    })
    state = reduceProjectFsClientState(state, {
      type: 'list_succeeded',
      generation,
      expiresAt: 2_100,
      page: {
        directoryHandle: root,
        cursor: 1,
        nextCursor: null,
        entries: [{ handle: token('dir'), name: 'src', kind: 'directory' }],
      },
    })
    state = reduceProjectFsClientState(state, {
      type: 'read_succeeded',
      generation,
      page: {
        leaseId: token('lease'),
        fileHandle: file,
        offset: 0,
        bytesRead: 3,
        nextOffset: 3,
        totalSize: 6,
        text: 'abc',
        expiresAt: 2_200,
      },
    })
    expect(state.pages[root]?.entries.map((entry) => entry.name)).toEqual(['README.md', 'src'])
    expect(state.reads[file]?.map((page) => page.text)).toEqual(['abc'])

    state = reduceProjectFsClientState(state, {
      type: 'request_failed',
      generation,
      error: { code: 'permission_denied', retryable: false, requiredAction: 'reauthenticate' },
    })
    expect(state).toMatchObject({
      availability: 'permission_denied',
      leaseId: null,
      pages: {},
      reads: {},
    })
  })
})
