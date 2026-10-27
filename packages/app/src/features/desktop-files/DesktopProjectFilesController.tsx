// @arch docs/features/desktop-project-files-opaque-protocol.md
// @test src/__tests__/project-files-workspace.test.ts

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { useMachinesStore, useProjectsStore } from '@shennian/shared'
import type { ProjectFsEntry, ResFrame } from '@shennian/wire'
import { getPreviewFileType } from '../../components/chat/filePreviewLanguage'
import {
  saveDesktopFileStream,
  type DesktopSavedFile,
} from '../desktop-control/desktopFileOperations'
import { desktopAccountActions, useDesktopAccountSync } from '../desktop-control/useDesktopAccountSync'
import {
  ProjectFsClient,
  ProjectFsClientError,
  type ProjectFsClientContext,
} from './model/desktopProjectFsClient'
import {
  buildProjectFileSidebarRows,
  createProjectFilesUiState,
  reduceProjectFilesUiState,
  type ProjectFileSidebarRow,
  type ProjectFilesUiState,
} from './model/desktopProjectFilesUiState'
import {
  type ProjectFsClientErrorState,
} from './model/desktopProjectFsState'
import {
  decodeBase64Chunks,
  encodeBase64,
  PROJECT_PREVIEW_MAX_BYTES,
} from './model/desktopProjectFilePreviewBytes'

const READ_CHUNK_BYTES = 256 * 1024

type RegisteredClient = {
  client: ProjectFsClient
  unsubscribe: () => void
}

type ProjectTarget = {
  projectId: string
  machineId: string
}

type DesktopProjectFilesControllerValue = {
  state: ProjectFilesUiState
  rowsFor(target: ProjectTarget): ProjectFileSidebarRow[]
  toggleFiles(target: ProjectTarget): void
  refresh(target: ProjectTarget): void
  toggleDirectory(target: ProjectTarget, directoryHandle: string): void
  loadMore(target: ProjectTarget, directoryHandle: string): void
  retry(target: ProjectTarget, requestTarget: string): void
  openFile(target: ProjectTarget, entry: ProjectFsEntry, returnFocusTestId: string): void
  downloadPreview(): Promise<DesktopSavedFile | null>
  retryPreview(): void
  closePreview(): void
}

const DesktopProjectFilesControllerContext = createContext<DesktopProjectFilesControllerValue | null>(null)

export function DesktopProjectFilesControllerProvider({ children }: { children: ReactNode }) {
  const desktopState = useDesktopAccountSync()
  const accountId = desktopState.accountId
  const machines = useMachinesStore((value) => value.machines)
  const projects = useProjectsStore((value) => value.projects)
  const [state, dispatch] = useReducer(
    reduceProjectFilesUiState,
    undefined,
    createProjectFilesUiState,
  )
  const stateRef = useRef(state)
  const clientsRef = useRef(new Map<string, RegisteredClient>())
  const authGenerationRef = useRef(0)
  const previousAccountRef = useRef(accountId)
  const previewRequestIdRef = useRef(0)
  stateRef.current = state

  const disposeClient = useCallback((projectId: string) => {
    const registered = clientsRef.current.get(projectId)
    if (!registered) return
    registered.unsubscribe()
    registered.client.dispose()
    clientsRef.current.delete(projectId)
  }, [])

  const disposeAll = useCallback(() => {
    for (const registered of clientsRef.current.values()) {
      registered.unsubscribe()
      registered.client.dispose()
    }
    clientsRef.current.clear()
  }, [])

  useEffect(() => {
    if (previousAccountRef.current === accountId) return
    previousAccountRef.current = accountId
    authGenerationRef.current += 1
    previewRequestIdRef.current += 1
    disposeAll()
    dispatch({ type: 'reset_scope' })
  }, [accountId, disposeAll])

  useEffect(() => {
    for (const [projectId, registered] of clientsRef.current) {
      const project = projects.find((candidate) => candidate.id === projectId) ?? null
      const machine = project
        ? (machines.find((candidate) => candidate.id === project.machineId) ?? null)
        : null
      if (!project || !machine || project.machineId !== machine.id) {
        disposeClient(projectId)
        dispatch({ type: 'remove_project', projectId })
        continue
      }
      registered.client.setContext(
        buildClientContext(accountId, authGenerationRef.current, machine, project),
      )
    }
  }, [accountId, disposeClient, machines, projects])

  useEffect(() => disposeAll, [disposeAll])

  const ensureClient = useCallback(
    (target: ProjectTarget, recreate = false): ProjectFsClient | null => {
      if (recreate) disposeClient(target.projectId)
      const existing = clientsRef.current.get(target.projectId)
      if (existing) return existing.client
      const project = projects.find((candidate) => candidate.id === target.projectId) ?? null
      const machine = machines.find((candidate) => candidate.id === target.machineId) ?? null
      if (!project || !machine || project.machineId !== target.machineId) return null

      const client = new ProjectFsClient((machineId, method, params) =>
        desktopAccountActions.requestMachineOperation<ResFrame>(method, machineId, params),
      )
      const unsubscribe = client.subscribe((clientState) => {
        dispatch({ type: 'client_state', projectId: target.projectId, state: clientState })
      })
      clientsRef.current.set(target.projectId, { client, unsubscribe })
      client.setContext(buildClientContext(accountId, authGenerationRef.current, machine, project))
      dispatch({ type: 'client_state', projectId: target.projectId, state: client.getState() })
      return client
    },
    [accountId, disposeClient, machines, projects],
  )

  const loadRoot = useCallback(
    async (target: ProjectTarget, recreate = false) => {
      const client = ensureClient(target, recreate)
      if (!client) return
      const clientState = client.getState()
      if (clientState.availability !== 'ready' && clientState.availability !== 'error') return
      dispatch({ type: 'request_started', projectId: target.projectId, target: 'root' })
      try {
        await client.open()
        dispatch({ type: 'request_finished', projectId: target.projectId, target: 'root' })
      } catch (error) {
        if (isStale(error)) return
        dispatch({
          type: 'request_failed',
          projectId: target.projectId,
          error: { target: 'root', ...errorState(error) },
        })
      }
    },
    [ensureClient],
  )

  const loadDirectory = useCallback(
    async (target: ProjectTarget, directoryHandle: string, cursor: number) => {
      const client = ensureClient(target)
      if (!client) return
      dispatch({ type: 'request_started', projectId: target.projectId, target: directoryHandle })
      try {
        await client.list({ directoryHandle, cursor })
        dispatch({ type: 'request_finished', projectId: target.projectId, target: directoryHandle })
      } catch (error) {
        if (isStale(error)) return
        dispatch({
          type: 'request_failed',
          projectId: target.projectId,
          error: { target: directoryHandle, ...errorState(error) },
        })
      }
    },
    [ensureClient],
  )

  const toggleFiles = useCallback(
    (target: ProjectTarget) => {
      const wasExpanded = stateRef.current.branches[target.projectId]?.expanded ?? false
      dispatch({ type: 'toggle_group', projectId: target.projectId })
      if (!wasExpanded) void loadRoot(target)
    },
    [loadRoot],
  )

  const refresh = useCallback(
    (target: ProjectTarget) => {
      const branch = stateRef.current.branches[target.projectId]
      if (!branch?.expanded) return
      previewRequestIdRef.current += 1
      if (stateRef.current.preview?.projectId === target.projectId) {
        dispatch({ type: 'preview_closed' })
      }
      const current = clientsRef.current.get(target.projectId)?.client
      void (async () => {
        if (current?.getState().leaseId) await current.close().catch(() => undefined)
        disposeClient(target.projectId)
        await loadRoot(target)
      })()
    },
    [disposeClient, loadRoot],
  )

  const toggleDirectory = useCallback(
    (target: ProjectTarget, directoryHandle: string) => {
      const branch = stateRef.current.branches[target.projectId]
      const wasExpanded = branch?.expandedDirectories[directoryHandle] ?? false
      dispatch({ type: 'toggle_directory', projectId: target.projectId, directoryHandle })
      if (!wasExpanded && !branch?.clientState?.pages[directoryHandle]) {
        void loadDirectory(target, directoryHandle, 0)
      }
    },
    [loadDirectory],
  )

  const loadMore = useCallback(
    (target: ProjectTarget, directoryHandle: string) => {
      const page = stateRef.current.branches[target.projectId]?.clientState?.pages[directoryHandle]
      if (page?.nextCursor != null) void loadDirectory(target, directoryHandle, page.nextCursor)
    },
    [loadDirectory],
  )

  const retry = useCallback(
    (target: ProjectTarget, requestTarget: string) => {
      const branch = stateRef.current.branches[target.projectId]
      if (requestTarget === 'root' || !branch?.clientState?.leaseId) {
        void loadRoot(target, branch?.clientState?.availability === 'offline')
        return
      }
      const page = branch.clientState.pages[requestTarget]
      void loadDirectory(target, requestTarget, page?.nextCursor ?? 0)
    },
    [loadDirectory, loadRoot],
  )

  const openFile = useCallback(
    (target: ProjectTarget, entry: ProjectFsEntry, returnFocusTestId: string) => {
      if (entry.kind !== 'file') return
      const client = ensureClient(target)
      if (!client?.getState().leaseId) return
      const requestId = ++previewRequestIdRef.current
      dispatch({
        type: 'preview_started',
        preview: {
          projectId: target.projectId,
          fileHandle: entry.handle,
          filename: entry.name,
          requestId,
          returnFocusTestId,
        },
      })
      void readPreview(client, entry, () => {
        const preview = stateRef.current.preview
        return preview?.projectId === target.projectId && preview.requestId === requestId
      })
        .then(({ content, data }) => {
          dispatch({
            type: 'preview_succeeded',
            projectId: target.projectId,
            requestId,
            content,
            data,
          })
        })
        .catch((error) => {
          if (isStale(error)) return
          dispatch({
            type: 'preview_failed',
            projectId: target.projectId,
            requestId,
            error: errorState(error),
          })
        })
    },
    [ensureClient],
  )

  const closePreview = useCallback(() => {
    const returnFocusTestId = stateRef.current.preview?.returnFocusTestId
    previewRequestIdRef.current += 1
    dispatch({ type: 'preview_closed' })
    if (returnFocusTestId && typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-testid="${returnFocusTestId}"]`)?.focus()
      })
    }
  }, [])

  const retryPreview = useCallback(() => {
    const preview = stateRef.current.preview
    if (!preview) return
    const project = projects.find((candidate) => candidate.id === preview.projectId)
    if (!project) return
    openFile(
      { projectId: project.id, machineId: project.machineId },
      { handle: preview.fileHandle, name: preview.filename, kind: 'file' },
      preview.returnFocusTestId,
    )
  }, [openFile, projects])

  const downloadPreview = useCallback(async (): Promise<DesktopSavedFile | null> => {
    const preview = stateRef.current.preview
    if (!preview || preview.loading || preview.error) return null
    const registered = clientsRef.current.get(preview.projectId)
    if (!registered?.client.getState().leaseId) throw new ProjectFsClientError('unavailable')
    const requestId = preview.requestId
    const isCurrent = () => {
      const currentPreview = stateRef.current.preview
      return currentPreview?.projectId === preview.projectId && currentPreview.requestId === requestId
    }
    return saveDesktopFileStream(
      preview.filename,
      async (offset, limitBytes) => {
        const page = await registered.client.read({
          fileHandle: preview.fileHandle,
          offset,
          limitBytes,
          encoding: 'binary',
        })
        return {
          bytes: decodeBase64Chunks([page.dataBase64 ?? ''], page.bytesRead),
          offset: page.offset,
          nextOffset: page.nextOffset,
          totalSize: page.totalSize,
        }
      },
      { isCurrent },
    )
  }, [])

  const value = useMemo<DesktopProjectFilesControllerValue>(
    () => ({
      state,
      rowsFor: (target) =>
        buildProjectFileSidebarRows(
          target.projectId,
          state.branches[target.projectId],
          state.preview?.projectId === target.projectId ? state.preview.fileHandle : null,
        ),
      toggleFiles,
      refresh,
      toggleDirectory,
      loadMore,
      retry,
      openFile,
      downloadPreview,
      retryPreview,
      closePreview,
    }),
    [closePreview, downloadPreview, loadMore, openFile, refresh, retry, retryPreview, state, toggleDirectory, toggleFiles],
  )

  return (
    <DesktopProjectFilesControllerContext.Provider value={value}>
      {children}
    </DesktopProjectFilesControllerContext.Provider>
  )
}

export function useDesktopProjectFilesController(): DesktopProjectFilesControllerValue {
  const value = useContext(DesktopProjectFilesControllerContext)
  if (!value) throw new Error('DesktopProjectFilesControllerProvider is missing')
  return value
}

function buildClientContext(
  accountId: string | null,
  authGeneration: number,
  machine: ProjectFsClientContext['machine'],
  project: ProjectFsClientContext['project'],
): ProjectFsClientContext {
  return { accountId, authGeneration, machine, project }
}

async function readPreview(
  client: ProjectFsClient,
  entry: ProjectFsEntry,
  isCurrent: () => boolean,
): Promise<{ content: string | null; data: string | null }> {
  const cached = client.getState().reads[entry.handle] ?? []
  const chunks = cached.map((page) => page.dataBase64 ?? '')
  let nextOffset = cached.length > 0 ? cached[cached.length - 1]?.nextOffset : 0
  let totalSize = cached[0]?.totalSize ?? entry.size ?? 0
  while (nextOffset !== null) {
    if (!isCurrent()) throw new ProjectFsClientError('stale')
    if (totalSize > PROJECT_PREVIEW_MAX_BYTES) throw previewTooLarge()
    const page = await client.read({
      fileHandle: entry.handle,
      offset: nextOffset,
      limitBytes: READ_CHUNK_BYTES,
      encoding: 'binary',
    })
    chunks.push(page.dataBase64 ?? '')
    totalSize = page.totalSize
    nextOffset = page.nextOffset
  }
  if (!isCurrent()) throw new ProjectFsClientError('stale')
  const bytes = decodeBase64Chunks(chunks, totalSize)
  const type = getPreviewFileType(entry.name)
  const binary =
    type === 'image' || type === 'pdf' || type === 'audio' || type === 'video' || type === 'unknown'
  return binary
    ? { content: null, data: encodeBase64(bytes) }
    : { content: new TextDecoder('utf-8').decode(bytes), data: null }
}

function errorState(error: unknown): ProjectFsClientErrorState {
  if (error instanceof ProjectFsClientError && error.detail) return error.detail
  return { code: 'io_error', retryable: true, requiredAction: 'retry' }
}

function isStale(error: unknown): boolean {
  return error instanceof ProjectFsClientError && error.kind === 'stale'
}

function previewTooLarge(): ProjectFsClientError {
  return new ProjectFsClientError('remote', {
    code: 'read_too_large',
    retryable: false,
    requiredAction: 'none',
  })
}
