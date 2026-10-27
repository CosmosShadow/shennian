// @covers src/features/desktop-files/model/desktopProjectFilesUiState.ts

import { describe, expect, it } from 'vitest'
import type { ProjectFsClientState } from '../features/desktop-files/model/desktopProjectFsState'
import {
  buildProjectFileSidebarRows,
  createProjectFilesUiState,
  reduceProjectFilesUiState,
} from '../features/desktop-files/model/desktopProjectFilesUiState'

const token = (prefix: string) => `${prefix}_${'x'.repeat(40)}`
const projectId = 'project-1'
const root = token('root')
const directory = token('directory')
const file = token('file')

function clientState(overrides: Partial<ProjectFsClientState> = {}): ProjectFsClientState {
  return {
    generation: 1,
    accountId: 'account-1',
    machineId: 'machine-1',
    projectId,
    availability: 'ready',
    unavailableReason: null,
    leaseId: token('lease'),
    rootHandle: root,
    rootName: 'Project',
    expiresAt: 2_000,
    pages: {
      [root]: {
        directoryHandle: root,
        cursor: 0,
        nextCursor: 2,
        entries: [
          { handle: directory, name: 'very-long-source-directory', kind: 'directory' },
          { handle: file, name: 'README.md', kind: 'file', size: 3 },
        ],
      },
    },
    reads: {},
    pendingRequests: 0,
    error: null,
    ...overrides,
  }
}

describe('Desktop project file UI reducer', () => {
  it('starts folded and does not expose a loading row until the user expands it', () => {
    const state = createProjectFilesUiState()
    expect(buildProjectFileSidebarRows(projectId, state.branches[projectId], null)).toEqual([
      { kind: 'toggle', key: `${projectId}:files`, projectId, expanded: false },
    ])

    const expanded = reduceProjectFilesUiState(state, { type: 'toggle_group', projectId })
    expect(buildProjectFileSidebarRows(projectId, expanded.branches[projectId], null)).toEqual([
      { kind: 'toggle', key: `${projectId}:files`, projectId, expanded: true },
      {
        kind: 'status',
        key: `${projectId}:status:root:unavailable`,
        projectId,
        status: 'unavailable',
        retryable: false,
        depth: 1,
        target: 'root',
      },
    ])
  })

  it('flattens opaque directory pages, selection, and pagination without a path field', () => {
    let state = createProjectFilesUiState()
    state = reduceProjectFilesUiState(state, { type: 'toggle_group', projectId })
    state = reduceProjectFilesUiState(state, {
      type: 'client_state',
      projectId,
      state: clientState(),
    })
    state = reduceProjectFilesUiState(state, {
      type: 'toggle_directory',
      projectId,
      directoryHandle: directory,
    })
    state = reduceProjectFilesUiState(state, {
      type: 'client_state',
      projectId,
      state: clientState({
        pages: {
          ...clientState().pages,
          [directory]: {
            directoryHandle: directory,
            cursor: 0,
            nextCursor: null,
            entries: [{ handle: token('nested'), name: 'index.ts', kind: 'file', size: 10 }],
          },
        },
      }),
    })

    const rows = buildProjectFileSidebarRows(projectId, state.branches[projectId], file)
    expect(rows.map((row) => row.kind)).toEqual(['toggle', 'entry', 'entry', 'entry', 'more'])
    expect(rows.filter((row) => row.kind === 'entry').map((row) => row.entry.name)).toEqual([
      'very-long-source-directory',
      'index.ts',
      'README.md',
    ])
    expect(rows.find((row) => row.kind === 'entry' && row.entry.handle === file)).toMatchObject({
      selected: true,
      depth: 1,
    })
    expect(rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'path'))).toBe(true)
  })

  it.each([
    ['offline', 'offline', true],
    ['permission_denied', 'permission', false],
    ['unavailable', 'unavailable', false],
  ] as const)('maps %s to the expected local status', (availability, status, retryable) => {
    let state = createProjectFilesUiState()
    state = reduceProjectFilesUiState(state, { type: 'toggle_group', projectId })
    state = reduceProjectFilesUiState(state, {
      type: 'client_state',
      projectId,
      state: clientState({ availability, leaseId: null, rootHandle: null, pages: {} }),
    })
    expect(
      buildProjectFileSidebarRows(projectId, state.branches[projectId], null)[1],
    ).toMatchObject({
      kind: 'status',
      status,
      retryable,
    })
  })

  it('clears directories and preview immediately when authorization loses its lease', () => {
    let state = createProjectFilesUiState()
    state = reduceProjectFilesUiState(state, { type: 'toggle_group', projectId })
    state = reduceProjectFilesUiState(state, {
      type: 'client_state',
      projectId,
      state: clientState(),
    })
    state = reduceProjectFilesUiState(state, {
      type: 'toggle_directory',
      projectId,
      directoryHandle: directory,
    })
    state = reduceProjectFilesUiState(state, {
      type: 'preview_started',
      preview: {
        projectId,
        fileHandle: file,
        filename: 'README.md',
        requestId: 1,
        returnFocusTestId: 'file-row',
      },
    })
    state = reduceProjectFilesUiState(state, {
      type: 'client_state',
      projectId,
      state: clientState({
        generation: 2,
        availability: 'permission_denied',
        leaseId: null,
        rootHandle: null,
        pages: {},
        reads: {},
      }),
    })
    expect(state.branches[projectId]).toMatchObject({
      expanded: true,
      expandedDirectories: {},
      pendingTargets: {},
    })
    expect(state.preview).toBeNull()
  })

  it('drops a late preview result after an account scope reset', () => {
    let state = reduceProjectFilesUiState(createProjectFilesUiState(), {
      type: 'preview_started',
      preview: {
        projectId,
        fileHandle: file,
        filename: 'README.md',
        requestId: 3,
        returnFocusTestId: 'file-row',
      },
    })
    state = reduceProjectFilesUiState(state, { type: 'reset_scope' })
    const reset = state
    state = reduceProjectFilesUiState(state, {
      type: 'preview_succeeded',
      projectId,
      requestId: 3,
      content: 'secret',
      data: null,
    })
    expect(state).toBe(reset)
    expect(state.preview).toBeNull()
  })
})
