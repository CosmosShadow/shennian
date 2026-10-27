// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-shell-controller.test.ts

import type { PropsWithChildren } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  buildProjectKey,
  useMachinesStore,
  useProjectsStore,
  useSessionsStore,
} from '@shennian/shared'
import type { NianProject } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import {
  getProjectPrefsSnapshot,
  rememberProjectAlias,
  subscribeProjectPrefs,
} from '../projects/utils/projectPrefs'
import {
  loadDesktopProjectAliases,
  visibleDesktopProjects,
} from '../projects/utils/desktopProjectAliasProjection'
import type { DesktopProjectAlias } from '../desktop-control/desktopProjectContracts'
import {
  desktopAccountActions,
  useDesktopAccountSync,
} from '../desktop-control/useDesktopAccountSync'
import { useDesktopRoomProjection } from '../desktop-control/useDesktopRoomProjection'
import { selectDesktopRootSession } from './desktopShellProjectProjection'

type DesktopShellControllerValue = {
  initialSessionId: string | null
  projectRecords: NianProject[]
  deleteSession(sessionId: string): Promise<void>
}

const DesktopShellControllerContext = createContext<DesktopShellControllerValue | null>(null)

export class DesktopShellControllerError extends Error {
  constructor(readonly code: 'OFFLINE') {
    super(code)
    this.name = 'DesktopShellControllerError'
  }
}

export function DesktopShellControllerProvider({ children }: PropsWithChildren) {
  const account = useDesktopAccountSync()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const networkStatus = useNetworkStatus()
  const sessions = useSessionsStore((state) => state.sessions)
  const machines = useMachinesStore((state) => state.machines)
  const records = useProjectsStore((state) => state.projects)
  const prefs = useSyncExternalProjectPrefs()
  const aliases = useDesktopShellProjectAliases(accountId, machines, records)

  useDesktopRoomProjection(account.accountId)

  useEffect(() => {
    if (!accountId || networkStatus !== 'online') return
    void desktopAccountActions.reconnect('network-restored').catch(() => undefined)
  }, [accountId, networkStatus])

  const projectRecords = useMemo(
    () => visibleDesktopProjects(records, aliases),
    [aliases, records],
  )
  const initialSessionId = useMemo(
    () => selectDesktopRootSession({ sessions, machines, projects: projectRecords, prefs }),
    [machines, prefs, projectRecords, sessions],
  )
  const deleteSession = useCallback(async (sessionId: string) => {
    if (networkStatus === 'offline') throw new DesktopShellControllerError('OFFLINE')
    await desktopAccountActions.deleteSession(sessionId, 'auto')
  }, [networkStatus])
  const value = useMemo<DesktopShellControllerValue>(() => ({
    initialSessionId,
    projectRecords,
    deleteSession,
  }), [deleteSession, initialSessionId, projectRecords])

  return (
    <DesktopShellControllerContext.Provider value={value}>
      {children}
    </DesktopShellControllerContext.Provider>
  )
}

export function useDesktopShellController(): DesktopShellControllerValue {
  const controller = useContext(DesktopShellControllerContext)
  if (!controller) throw new Error('Desktop shell controller is required')
  return controller
}

function useDesktopShellProjectAliases(
  accountId: string,
  machines: ReturnType<typeof useMachinesStore.getState>['machines'],
  records: NianProject[],
): DesktopProjectAlias[] {
  const [projection, setProjection] = useState<{
    accountId: string
    aliases: DesktopProjectAlias[]
  }>({ accountId: '', aliases: [] })

  useEffect(() => {
    if (!accountId) {
      setProjection({ accountId: '', aliases: [] })
      return
    }
    let active = true
    void loadDesktopProjectAliases({
      resolve: () => desktopAccountActions.resolveProjectAliases(),
      isCurrent: () => active && useAuthStore.getState().user?.id === accountId,
      records: () => useProjectsStore.getState().projects,
      commit: (nextAliases) => {
        for (const alias of nextAliases) {
          rememberProjectAlias(
            accountId,
            buildProjectKey(alias.machineId, alias.aliasWorkDir),
            buildProjectKey(alias.machineId, alias.workDir),
            { id: alias.projectId, workDir: alias.workDir },
          )
        }
        setProjection({ accountId, aliases: nextAliases })
      },
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [accountId, machines, records])

  return projection.accountId === accountId ? projection.aliases : []
}

type DesktopProjectPrefs = ReturnType<typeof getProjectPrefsSnapshot>

function useSyncExternalProjectPrefs(): DesktopProjectPrefs {
  return useSyncExternalStore(
    subscribeProjectPrefs,
    getProjectPrefsSnapshot,
    getProjectPrefsSnapshot,
  )
}
