// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-model.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useMachinesStore } from '@shennian/shared'
import type { AgentType, Machine, NianSession } from '@shennian/wire'
import { usePrimaryMachine } from '../personal-workspace/usePrimaryMachine'
import { useAuthStore } from '../../config/auth'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { getMachineAgentModels } from '../../utils/models'
import { machineAccountClient } from '../machines/machineAccountClient'
import { sessionAccountClient } from '../sessions/sessionAccountClient'
import { useStewardSessionsStore } from './stewardSessionsStore'
import { subscribeStewardResync, subscribeStewardSessionEvents } from './stewardSessionEvents'
import {
  STEWARD_WORKDIR,
  currentStewardSession,
  newerStewardSession,
  resolveStewardAgent,
  stewardAgentChoices,
  type StewardPreferences,
  type StewardSwitchMark,
} from './stewardModel'
import {
  appendStewardSwitchMark,
  pruneStewardSwitchMarks,
  readStewardPreferences,
  readStewardSwitchMarks,
  writeStewardPreferences,
} from './stewardStorage'

export type StewardStatus =
  | 'loading'
  | 'no_machine'
  | 'no_tool'
  | 'starting'
  | 'ready'
  | 'failed'

const CREATE_TIMEOUT_MS = 15_000

/** A stuck local write must surface as a retryable failure, never an endless spinner. */
function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('steward_create_timeout')), ms)
    task.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export type StewardSetup = { machine: Machine; agentType: AgentType; modelId?: string }

/**
 * Owns which machine, AI, model and conversation the steward page shows.
 *
 * One conversation per machine: picking another machine opens that machine's own conversation
 * (created only when it has none), so what the page shows always belongs to the machine named in
 * the title. Switching the AI tool or the model stays inside the open conversation — it only
 * retargets it and leaves a rule where the switch happened. A new conversation is started only
 * when the user explicitly asks for one.
 */
export function useStewardConversation() {
  const primary = usePrimaryMachine({ cachedDisplay: true })
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const machines = useMachinesStore((state) => state.machines)
  const sessions = useStewardSessionsStore((state) => state.sessions)
  const hydrated = useStewardSessionsStore((state) => state.hydrated)
  const upsertSession = useStewardSessionsStore((state) => state.upsert)
  const removeSessions = useStewardSessionsStore((state) => state.remove)
  const [prefs, setPrefs] = useState<StewardPreferences | null>(null)
  const [marks, setMarks] = useState<readonly StewardSwitchMark[]>([])
  const [failed, setFailed] = useState(false)
  const creating = useRef(false)

  // Reload on every focus: the settings page changes these choices while this page waits
  // underneath, and the Server copy carries the read state the unread dots are computed from.
  useFocusEffect(useCallback(() => {
    let active = true
    void useStewardSessionsStore.getState().hydrate(accountId)
    void useStewardSessionsStore.getState().refresh(accountId)
    void readStewardPreferences(accountId).then((loaded) => { if (active) setPrefs(loaded) })
    void readStewardSwitchMarks(accountId).then((loaded) => { if (active) setMarks(loaded) })
    return () => { active = false }
  }, [accountId]))

  const machine: Machine | null = useMemo(
    () => machines.find(item => item.id === primary.record?.machine?.id && item.paired && item.role !== 'granted' && !item.remoteAccessDisabledAt) ?? null,
    [machines, primary.record?.machine?.id],
  )
  // The machine's own conversation, not whatever was open last on another machine.
  const session = useMemo(
    () => currentStewardSession(sessions.filter(item => item.agentType === 'shennian'), machine?.id, prefs?.sessionId),
    [machine?.id, prefs?.sessionId, sessions],
  )
  // The conversation itself says which AI it is talking to; the remembered choice only
  // decides what a brand-new conversation starts with.
  const agentType: AgentType | null = useMemo(
    () => resolveStewardAgent(machine, session?.agentType ?? prefs?.agentType),
    [machine, prefs?.agentType, session?.agentType],
  )
  const models = useMemo(
    () => (machine && agentType ? getMachineAgentModels(machine, agentType) : []),
    [machine, agentType],
  )
  const preferredModelId = undefined // Model selection is owned by the Client's private model settings.
  const modelId = preferredModelId && models.some((model) => model.id === preferredModelId)
    ? preferredModelId
    : undefined

  const remember = useCallback(async (changes: StewardPreferences, strict = false) => {
    const next = await writeStewardPreferences(accountId, changes, strict)
    setPrefs(next)
    return next
  }, [accountId])

  /** Starts another conversation on the current (or given) machine; only the user asks for this. */
  const startNew = useCallback(async (target?: Partial<StewardSetup>, resetContext = false): Promise<boolean> => {
    const chosenMachine = target?.machine ?? machine
    const chosenAgent = target?.agentType ?? agentType
    const chosenModel = target && 'modelId' in target ? target.modelId : modelId
    if (!chosenMachine || chosenMachine.id !== machine?.id || !chosenAgent || creating.current) return false
    if (resetContext && !chosenMachine.agents?.some(agent => agent.type === 'shennian' && agent.supportsFreshPersonalContext === true)) return false
    creating.current = true
    setFailed(false)
    try {
      const open = currentStewardSession(sessions, chosenMachine.id, prefs?.sessionId)
      const reusable = !resetContext && open && open.localCreationState === 'draft'
        && open.agentType === chosenAgent && (open.modelId ?? undefined) === chosenModel
      if (reusable) {
        await remember({ machineId: chosenMachine.id, agentType: chosenAgent, modelId: chosenModel, sessionId: open.id }, true)
        return true
      }
      const draft = await withTimeout(machineAccountClient.createSession({
        machineId: chosenMachine.id,
        agentType: chosenAgent,
        workDir: STEWARD_WORKDIR,
        sessionMode: 'standard',
        sessionScope: 'steward',
        ...(chosenModel ? { modelId: chosenModel } : {}),
      }), CREATE_TIMEOUT_MS)
      upsertSession(draft)
      await remember({
        machineId: chosenMachine.id, agentType: chosenAgent, modelId: chosenModel, sessionId: draft.id,
      }, true)
      return true
    } catch {
      setFailed(true)
      return false
    } finally {
      creating.current = false
    }
  }, [agentType, machine, modelId, prefs?.sessionId, remember, sessions, upsertSession])

  /**
   * Retargets the open conversation at another AI tool or model: the history stays, a rule marks
   * the switch, and the machine's daemon moves the running session over on the next message.
   */
  const retarget = useCallback(async (changes: { agentType?: AgentType; modelId?: string | undefined; modelChanged?: boolean }) => {
    if (!session || !machine) return
    const nextAgent = changes.agentType ?? (session.agentType as AgentType)
    const nextModel = changes.modelChanged ? changes.modelId : (session.modelId ?? undefined)
    if (nextAgent === session.agentType && !changes.modelChanged) return
    const updated: NianSession = {
      ...session,
      agentType: nextAgent,
      modelId: nextModel ?? null,
      modelSource: 'session',
      updatedAt: new Date().toISOString(),
    }
    upsertSession(updated)
    await remember({ agentType: nextAgent, modelId: nextModel })
    // A tool switch resets the model to that tool's default; saying both would read as two changes.
    const toolChanged = Boolean(changes.agentType && changes.agentType !== session.agentType)
    const mark: StewardSwitchMark = {
      sessionId: session.id,
      ts: Date.now(),
      ...(toolChanged ? { agentType: nextAgent } : {}),
      ...(!toolChanged && changes.modelChanged
        ? (nextModel ? { modelId: nextModel } : { defaultModel: true as const })
        : {}),
    }
    setMarks(await appendStewardSwitchMark(accountId, mark))
    try {
      if (session.localCreationState === 'draft') {
        await accountRuntime.persistSession(updated)
      } else {
        await sessionAccountClient.updateSession(session.id, {
          agentType: nextAgent,
          modelId: nextModel ?? null,
          modelSource: 'session',
        })
        await accountRuntime.persistSession(updated)
      }
    } catch {
      // The next message carries the choice anyway; the index catches up with it.
    }
  }, [accountId, machine, remember, session, upsertSession])

  const selectAgent = useCallback(async (type: AgentType) => {
    if (!session) return remember({ agentType: type })
    await retarget({ agentType: type, modelId: undefined, modelChanged: true })
  }, [remember, retarget, session])

  const selectModel = useCallback(async (next: string | undefined) => {
    if (!session) return remember({ modelId: next })
    await retarget({ modelId: next, modelChanged: true })
  }, [remember, retarget, session])

  /** Opens one of this machine's earlier conversations (from the history list). */
  const openConversation = useCallback(async (id: string) => {
    const picked = sessions.find((item) => item.id === id)
    if (!picked) return
    await remember({ machineId: picked.machineId, sessionId: id })
  }, [remember, sessions])

  /** Deletes one past conversation (server, local and machine-side copy). */
  const deleteOne = useCallback(async (id: string): Promise<boolean> => {
    try {
      await accountRuntime.deleteSession(id, 'auto')
      removeSessions([id])
      if (prefs?.sessionId === id) await remember({ sessionId: undefined })
      return true
    } catch {
      return false
    }
  }, [prefs?.sessionId, remember, removeSessions])

  /**
   * Clears the whole steward timeline: every conversation is deleted (server and local, and the
   * machine-side copy). Returns false if any deletion failed, so nothing is reported as cleared
   * that is not.
   */
  const clearHistory = useCallback(async (): Promise<boolean> => {
    let ok = true
    const gone: string[] = []
    for (const item of sessions) {
      try {
        await accountRuntime.deleteSession(item.id, 'auto')
        gone.push(item.id)
      } catch {
        ok = false
      }
    }
    removeSessions(gone)
    await remember({ sessionId: undefined })
    setMarks(await pruneStewardSwitchMarks(accountId, sessions.filter((item) => !gone.includes(item.id)).map((item) => item.id)))
    return ok
  }, [accountId, remember, removeSessions, sessions])

  // The machine may open a newer steward conversation by itself (a scheduled task, a terminal
  // handover): follow it. The relay pushes that as a live `session.update`, so refresh on the
  // event instead of polling; a reconnect/foreground resync covers what a dropped connection missed.
  useEffect(() => {
    if (!session) return
    const machineId = session.machineId
    void useStewardSessionsStore.getState().refresh(accountId)
    const unsubscribeSession = subscribeStewardSessionEvents((updatedMachineId) => {
      if (updatedMachineId === machineId) void useStewardSessionsStore.getState().refresh(accountId)
    })
    const unsubscribeResync = subscribeStewardResync(() => {
      void useStewardSessionsStore.getState().refresh(accountId)
    })
    return () => {
      unsubscribeSession()
      unsubscribeResync()
    }
  }, [accountId, session?.id, session?.machineId])
  const followed = newerStewardSession(sessions.filter(item => item.agentType === 'shennian'), session)
  useEffect(() => {
    if (!followed) return
    void remember({ sessionId: followed.id })
  }, [followed, remember])

  // First entry, or this machine has no conversation yet: make sure there is one to show.
  useEffect(() => {
    if (primary.loading || primary.error || !prefs || !hydrated || !machine || !agentType || creating.current) return
    if (session) return
    let active = true
    void (async () => {
      if (prefs.sessionId) {
        try {
          const remote = await sessionAccountClient.getSession(prefs.sessionId)
          if (!active) return
          if (remote.userId === accountId && remote.sessionScope === 'steward'
            && remote.machineId === machine.id && remote.agentType === 'shennian') {
            upsertSession(remote)
            return
          }
        } catch { /* fall through to a fresh conversation */ }
      }
      if (active) await startNew()
    })()
    return () => { active = false }
  }, [accountId, agentType, hydrated, machine, prefs, primary.loading, primary.error, session, startNew, upsertSession])

  // A focus refresh must not unmount the live chat, its draft and scroll position.
  const status: StewardStatus = !prefs || (primary.loading && !primary.record)
    ? 'loading'
    : !machine
      ? 'no_machine'
      : !agentType
        ? 'no_tool'
        : failed
          ? 'failed'
          : session
            ? 'ready'
            : 'starting'

  return {
    accountId,
    status,
    machine,
    machines: machine ? [machine] : [],
    primaryError: primary.error || (!primary.loading && !machine ? 'personal_primary_not_configured' : undefined),
    agentType,
    agentChoices: stewardAgentChoices(machine),
    models,
    modelId,
    showModel: false,
    showEffort: false,
    showMachineName: prefs?.showMachineName === true,
    sessions,
    session,
    sessionId: session?.id ?? null,
    marks,
    startNew,
    resetContext: () => startNew(undefined, true),
    openConversation,
    selectAgent,
    selectModel,
    clearHistory,
    deleteOne,
    remember,
    retry: () => startNew(),
  }
}
