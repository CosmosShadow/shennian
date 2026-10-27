// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/relay-manager.test.ts

import { useEffect, useRef } from 'react'
import { SyncEngine } from '../sync-engine'
import { RelayManager } from '../relay-manager'
import { getRelayManager, setRelayManager } from '../relay-manager-lifecycle'
import type {
  NianSession,
  NianProject,
  Machine,
  UpgradeEventPayload,
  ChatQueueSnapshot,
  EventFrame,
} from '@shennian/wire'
import type { ClientIndexStore } from '../storage'
import type { ApiClient, ChangeNotifier } from '../sync-engine'
import { incrementRuntimeMetric } from '../runtime-metrics'

export { getRelayManager } from '../relay-manager-lifecycle'
export type UseSyncDeps = {
  store: ClientIndexStore
  api: ApiClient
  getToken: () => string | null
  getIsAuthenticated: () => boolean
  getUserId: () => string | null
  buildRelayUrl: (machineId: string) => string
  buildRelayClientUrl?: () => string
  onSessionsChange: (sessions: NianSession[]) => void
  onSessionUpdate: (session: NianSession) => void
  onSessionBatchUpdate?: (sessions: NianSession[]) => void
  onSessionIndexTargetChange?: (sessionId?: string) => void
  onSessionDelete: (sessionId: string, deletionRevision?: number) => void
  onMachinesChange: (machines: Machine[]) => void
  onMachineRemoved?: (machineId: string) => void
  onMachinesRemoteResolved?: (resolved: boolean) => void
  onProjectsChange: (projects: NianProject[]) => void
  setSessionsLoading?: (loading: boolean) => void
  onMachineStatus: (
    machineId: string,
    online: boolean,
    region?: string,
    cliVersion?: string,
    autoUpgrade?: 'none' | 'patch',
    sync?: Pick<Machine, 'sessionSyncProtocolVersion' | 'sessionSyncDataEpoch' | 'sessionSyncCapabilities' | 'daemonInstallationId' | 'updaterProtocolVersion' | 'remoteAccessDisabledAt'>,
  ) => void
  onMachineAgentList: (machineId: string, agentList: string[]) => void
  onMachineAgents: (machineId: string, agentList: string[], agents: Machine['agents']) => void
  onUpgradeEvent: (payload: UpgradeEventPayload & { machineId: string }) => void
  onSessionQueueUpdate?: (sessionId: string, queue: ChatQueueSnapshot) => void
  onSyncStart?: () => void
  onSyncEnd?: () => void
  onRelayEvent?: (event: EventFrame) => void
  onRelayConnectivityEvent?: (event: import('@shennian/wire').RelayConnectivityEvent) => void
  onReconnect?: (reason: 'relay-reconnect' | 'app-foreground' | 'network-restored') => void
  subscribeNetworkReconnect?: (handler: () => void) => () => void
  subscribeNetworkStatus?: (handler: (online: boolean) => void) => () => void
  subscribeAppLifecycle?: (handler: (active: boolean) => void) => () => void
  getChatSessionId: () => string | null
  getChatIsTyping: () => boolean
  syncCacheVersion?: string | null
  onPersonalDataReset?: () => Promise<void> | void
}

let syncEngine: SyncEngine | null = null

export function getSyncEngine(): SyncEngine | null {
  return syncEngine
}

export function createSingleFlightRecovery<Reason>(
  run: (reason: Reason) => Promise<void>,
): (reason: Reason) => Promise<void> {
  let inFlight: Promise<void> | null = null
  return (reason) => {
    if (inFlight) return inFlight
    const recovery = run(reason).finally(() => {
      if (inFlight === recovery) inFlight = null
    })
    inFlight = recovery
    return recovery
  }
}

export type NativeRelayLifecycleAction = 'resume' | 'suspend' | 'ignore'

export function resolveNativeRelayLifecycleAction(state: string): NativeRelayLifecycleAction {
  if (state === 'active') return 'resume'
  if (state === 'background') return 'suspend'
  return 'ignore'
}

export function createLifecycleBoundIndexStore(
  store: ClientIndexStore,
  isCurrent: () => boolean,
): ClientIndexStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (!isCurrent()) return Promise.reject(new Error('sync lifecycle expired'))
        return Reflect.apply(value, target, args)
      }
    },
  })
}

function createLifecycleBoundNotifier(
  notifier: ChangeNotifier,
  isCurrent: () => boolean,
): ChangeNotifier {
  return new Proxy(notifier, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (isCurrent()) Reflect.apply(value, target, args)
      }
    },
  })
}

export function createUseSync(deps: UseSyncDeps) {
  /** Track the userId that owns current local data. Persisted across effect re-runs. */
  let activeUserId: string | null = null
  let lifecycleRevision = 0

  return function useSync() {
    const token = deps.getToken()
    const isAuthenticated = deps.getIsAuthenticated()
    const userId = deps.getUserId()
    const initedRef = useRef(false)
    const wasAuthRef = useRef(false)
    const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
      if (!isAuthenticated) {
        deps.onMachinesRemoteResolved?.(false)
        console.log('[useSync] not authenticated, skipping init')
        if (wasAuthRef.current) {
          // Debounce: on native, auth state may briefly flicker to
          // unauthenticated during token refresh or AppState transitions.
          // Wait before wiping local data to avoid catastrophic data loss.
          if (!clearTimerRef.current) {
            console.log('[useSync] scheduling deferred clear (2s)')
            clearTimerRef.current = setTimeout(() => {
              clearTimerRef.current = null
              // Re-check: if auth came back, abort the clear
              if (deps.getIsAuthenticated()) {
                console.log('[useSync] auth restored before clear, aborting')
                return
              }
              console.log('[useSync] confirmed unauthenticated, clearing local data')
              deps.store.clearAll().catch(() => {})
              deps.onSessionsChange([])
              deps.onMachinesChange([])
              deps.onProjectsChange([])
              if (syncEngine) {
                syncEngine = null
              }
              activeUserId = null
            }, 2000)
          }
        }
        const currentManager = getRelayManager()
        setRelayManager(null)
        currentManager?.disconnectAll()
        initedRef.current = false
        // Don't reset wasAuthRef here — let the timer handle it
        return
      }

      // Auth is valid: cancel any pending clear
      if (clearTimerRef.current) {
        console.log('[useSync] auth valid, cancelling pending clear')
        clearTimeout(clearTimerRef.current)
        clearTimerRef.current = null
      }

      wasAuthRef.current = true
      if (initedRef.current) return
      initedRef.current = true
      const revision = ++lifecycleRevision
      const isCurrentLifecycle = () => lifecycleRevision === revision
      const networkEnabled = Boolean(token)
      deps.onMachinesRemoteResolved?.(false)
      console.log('[useSync] initializing sync engine')
      deps.setSessionsLoading?.(true)

      // Detect user switch: if activeUserId differs, clear stale data before boot
      const userSwitched = activeUserId != null && userId != null && activeUserId !== userId
      if (userSwitched) {
        console.log(`[useSync] user switched ${activeUserId} → ${userId}, clearing stale data`)
      }
      activeUserId = userId

      // Track machine relay connections acquired for background session sync
      const bgMachines = new Set<string>()

      const manager = new RelayManager({
        buildUrl: deps.buildRelayUrl,
        buildClientUrl: deps.buildRelayClientUrl,
        getToken: deps.getToken,
        onConnectivityEvent: deps.onRelayConnectivityEvent,
        // Current App requires the multiplex endpoint. Per-machine sockets are
        // retained only for old clients, never as a silent runtime fallback.
      })

      const engine = new SyncEngine({
        store: createLifecycleBoundIndexStore(deps.store, isCurrentLifecycle),
        api: deps.api,
        cacheVersion: deps.syncCacheVersion,
        onPersonalDataReset: deps.onPersonalDataReset,
        onChange: createLifecycleBoundNotifier({
          onSessionsChange: deps.onSessionsChange,
          onSessionUpdate: deps.onSessionUpdate,
          onSessionBatchUpdate: deps.onSessionBatchUpdate,
          onSessionIndexTargetChange: deps.onSessionIndexTargetChange,
          onSessionDelete: deps.onSessionDelete,
          onMachinesChange: (machines) => {
            deps.onMachinesChange(machines)
            if (!networkEnabled) return
            // Ensure we have a relay connection to every machine so session
            // create/update/delete events are received even on the list page
            const nextMachineIds = new Set(machines.map((m) => m.id))
            for (const machineId of bgMachines) {
              if (!nextMachineIds.has(machineId)) {
                bgMachines.delete(machineId)
                manager.release(machineId)
              }
            }
            for (const m of machines) {
              if (!bgMachines.has(m.id)) {
                bgMachines.add(m.id)
                manager.acquire(m.id)
              }
            }
          },
          onMachinesRemoteResolved: () => deps.onMachinesRemoteResolved?.(true),
          onMachineRemoved: deps.onMachineRemoved,
          onProjectsChange: deps.onProjectsChange,
          onMachineStatus: (machineId, online, region, cliVersion, autoUpgrade, sync) => {
            deps.onMachineStatus(machineId, online, region, cliVersion, autoUpgrade, sync)
          },
          onMachineAgentList: deps.onMachineAgentList,
          onMachineAgents: deps.onMachineAgents,
          onUpgradeEvent: deps.onUpgradeEvent,
          onSessionQueueUpdate: deps.onSessionQueueUpdate,
          onSyncStart: deps.onSyncStart,
          onSyncEnd: deps.onSyncEnd,
        }, isCurrentLifecycle),
      })
      syncEngine = engine

      const requestRecovery = createSingleFlightRecovery(
        (reason: 'relay-reconnect' | 'app-foreground' | 'network-restored') => {
          if (!networkEnabled) return Promise.resolve()
          deps.onReconnect?.(reason)
          return engine
            .onReconnect({
              currentSessionId: deps.getChatSessionId() ?? undefined,
              isTyping: deps.getChatIsTyping(),
            })
            .catch(() => {})
        },
      )

      // Personal body frames are handled by the visible chat subscription.
      // SyncEngine only consumes lightweight session/activity/machine index events.
      if (networkEnabled) {
        manager.setEventHandler((_machineId, event) => {
          deps.onRelayEvent?.(event)
          engine.handleRelayEvent(event)
        })
        manager.connectUserEvents()
        manager.setOnReconnect(() => {
          void requestRecovery('relay-reconnect')
        })
        setRelayManager(manager)
      }

      // If user switched, clear stale local data before booting the new engine
      const bootPromise = userSwitched
        ? deps.store.clearAll().then(() => engine.boot({ localOnly: !networkEnabled }))
        : engine.boot({ localOnly: !networkEnabled })
      bootPromise.catch((e) => {
        console.error('[useSync] boot failed:', e)
      })

      // Web: re-sync when user switches back to this tab
      let removeVisibility: (() => void) | undefined
      if (typeof document !== 'undefined') {
        const onVisible = () => {
          if (document.visibilityState === 'visible') {
            manager.resume()
            void requestRecovery('app-foreground')
          } else {
            void engine.flushPendingWork()
            manager.suspend()
          }
        }
        document.addEventListener('visibilitychange', onVisible)
        removeVisibility = () => document.removeEventListener('visibilitychange', onVisible)
      }

      // Native: re-sync when app comes back to foreground (AppState is RN-only)
      let removeAppState: (() => void) | undefined
      const removeNetworkStatus = deps.subscribeNetworkStatus?.((online) => {
        manager.setNetworkOnline(online)
        if (online) void requestRecovery('network-restored')
      })
      const removeNetworkReconnect = deps.subscribeNetworkStatus
        ? undefined
        : deps.subscribeNetworkReconnect?.(() => {
            manager.setNetworkOnline(true)
            manager.resume()
            void requestRecovery('network-restored')
          })
      const removeExternalAppState = deps.subscribeAppLifecycle?.((active) => {
        incrementRuntimeMetric(`sync.desktop_state.${active ? 'active' : 'suspended'}`)
        if (active) {
          manager.resume()
          void requestRecovery('app-foreground')
        } else {
          void engine.flushPendingWork()
          manager.suspend()
        }
      })
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const RN = require('react-native') as {
          Platform?: { OS: string }
          AppState?: {
            currentState?: string
            addEventListener: (evt: string, cb: (s: string) => void) => { remove: () => void }
          }
        }
        if (RN.Platform?.OS !== 'web' && RN.AppState) {
          const sub = RN.AppState.addEventListener('change', (nextState: string) => {
            incrementRuntimeMetric(`sync.app_state.${nextState}`)
            const action = resolveNativeRelayLifecycleAction(nextState)
            if (action === 'resume') {
              manager.resume()
              void requestRecovery('app-foreground')
            } else if (action === 'suspend') {
              void engine.flushPendingWork()
              manager.suspend()
            }
          })
          removeAppState = () => sub.remove()
          // A lifecycle can be installed while React Native is already in the
          // background (for example after a token refresh). Reconcile the
          // current state instead of waiting for a transition that may never
          // be emitted. Do not treat transient iOS `inactive` as background.
          if (resolveNativeRelayLifecycleAction(RN.AppState.currentState ?? '') === 'suspend') {
            void engine.flushPendingWork()
            manager.suspend()
          }
        }
      } catch {
        // Not a React Native environment, skip
      }

      return () => {
        if (isCurrentLifecycle()) lifecycleRevision += 1
        incrementRuntimeMetric('sync.lifecycle_cleanup')
        engine.cancelMachineRecoveryReconciliation()
        void engine.flushPendingWork()
        removeVisibility?.()
        removeAppState?.()
        removeExternalAppState?.()
        removeNetworkReconnect?.()
        removeNetworkStatus?.()
        if (clearTimerRef.current) {
          clearTimeout(clearTimerRef.current)
          clearTimerRef.current = null
        }
        if (getRelayManager() === manager) setRelayManager(null)
        manager.disconnectAll()
        syncEngine = null
        initedRef.current = false
      }
    }, [isAuthenticated, token, userId])
  }
}
