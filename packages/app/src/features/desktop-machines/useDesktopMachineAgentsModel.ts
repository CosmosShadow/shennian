// @arch docs/features/desktop-machine-access-boundary.md
// @test ../../__tests__/desktop-machine-agents.test.ts

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { useMachinesStore, useSessionsStore } from '@shennian/shared'
import type { AcpExternalSessionInfo, AgentInfo, AgentType } from '@shennian/wire'
import {
  desktopAccountActions,
  useDesktopAccountSync,
} from '../desktop-control/useDesktopAccountSync'
import { isMachineOwner } from '../machines/utils/machineAccessPolicy'
import { desktopMachineAgentsPort } from './desktopMachineAgentsPort'
import { selectInstalledAgents } from './desktopMachineAgentsPresentation'

export function useDesktopMachineAgentsModel(machineId: string) {
  const router = useRouter()
  const sync = useDesktopAccountSync()
  const machine = useMachinesStore((state) => state.machines.find((item) => item.id === machineId))
  const upsertSession = useSessionsStore((state) => state.upsertSession)
  const [pending, setPending] = useState<AgentType | string | null>(null)
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null)
  const [externalSessions, setExternalSessions] = useState<AcpExternalSessionInfo[]>([])
  const [externalError, setExternalError] = useState('')
  const [confirmImport, setConfirmImport] = useState<AcpExternalSessionInfo | null>(null)
  const owner = isMachineOwner(machine)
  const viewOnly = machine?.role === 'granted' && machine.permission === 'view'

  const installedAgents = useMemo(() => selectInstalledAgents(machine), [machine])
  const authenticate = useCallback(
    async (agent: AgentInfo) => {
      if (!machine?.online || !owner || pending) return
      const method = agent.acpAuthMethods?.[0]
      if (!method) {
        setNotice({ title: 'auth-unavailable', message: '' })
        return
      }
      if (method.type === 'terminal') {
        setNotice({ title: 'auth-on-machine', message: agent.type.replace(/^acp:/, '') })
        return
      }
      setPending(agent.type)
      setNotice(null)
      try {
        await desktopMachineAgentsPort.startAuth(machine.id, agent.type, method.id)
        await desktopMachineAgentsPort.refresh(machine.id)
      } catch (error) {
        setNotice({ title: 'auth-failed', message: errorMessage(error) })
      } finally {
        setPending(null)
      }
    },
    [machine, owner, pending],
  )

  const openAgent = useCallback(
    async (agent: AgentInfo) => {
      if (!machine) return
      setSelectedAgent(agent)
      setExternalSessions([])
      setExternalError('')
      if (!owner || !machine.online || !agent.acpCapabilities?.listSessions) return
      setPending(`list:${agent.type}`)
      try {
        setExternalSessions(
          await desktopMachineAgentsPort.listExternalSessions(machine.id, agent.type),
        )
      } catch (error) {
        setExternalError(errorMessage(error))
      } finally {
        setPending(null)
      }
    },
    [machine, owner],
  )

  const importExternal = useCallback(async () => {
    const external = confirmImport
    const agent = selectedAgent
    if (!external || !agent || !machine || !owner || pending || !agent.acpCapabilities?.loadSession)
      return
    setPending(`import:${external.agentSessionId}`)
    setExternalError('')
    let createdSessionId = ''
    try {
      const created = await desktopMachineAgentsPort.createSession({
        machineId: machine.id,
        agentType: agent.type,
        workDir: external.cwd,
        sessionMode: 'standard',
      })
      createdSessionId = created.id
      await desktopMachineAgentsPort.importExternalSession({
        machineId: machine.id,
        agentType: agent.type,
        external,
        sessionId: created.id,
      })
      const session = {
        ...created,
        agentSessionId: external.agentSessionId,
        title: external.title || created.title,
      }
      await desktopMachineAgentsPort.persistSession(session)
      upsertSession(session)
      setConfirmImport(null)
      setSelectedAgent(null)
      router.navigate(`/(main)/chat/${session.id}`)
    } catch (error) {
      let message = errorMessage(error)
      if (createdSessionId) {
        try {
          await desktopMachineAgentsPort.discardCreatedSession(createdSessionId)
        } catch (cleanupError) {
          message = `${message}\n${errorMessage(cleanupError)}`
        }
      }
      setConfirmImport(null)
      setExternalError(message)
    } finally {
      setPending(null)
    }
  }, [confirmImport, machine, owner, pending, router, selectedAgent, upsertSession])

  return {
    sync,
    machine,
    owner,
    viewOnly,
    installedAgents,
    pending,
    notice,
    selectedAgent,
    externalSessions,
    externalError,
    confirmImport,
    authenticate,
    openAgent,
    closeAgent: () => {
      setSelectedAgent(null)
      setConfirmImport(null)
    },
    requestImport: setConfirmImport,
    cancelImport: () => setConfirmImport(null),
    importExternal,
    dismissNotice: () => setNotice(null),
    retrySync: () => desktopAccountActions.reconnect('manual'),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
