import { create } from 'zustand'
import {
  filterAvailableAgentInfos,
  filterAvailableAgentTypes,
  type Machine,
  type UpgradeEventPayload,
  type AgentInfo,
} from '@shennian/wire'

export type UpgradeState = {
  state: UpgradeEventPayload['state']
  version?: string
  from?: string
  to?: string
  error?: string
  reason?: string
  progress?: number
}

type MachinesState = {
  machines: Machine[]
  loading: boolean
  remoteResolved: boolean
  upgradeStates: Record<string, UpgradeState>
  setMachines(machines: Machine[]): void
  updateMachineStatus(
    machineId: string,
    online: boolean,
    region?: string,
    cliVersion?: string,
    autoUpgrade?: 'none' | 'patch',
    sync?: Pick<Machine, 'sessionSyncProtocolVersion' | 'sessionSyncDataEpoch' | 'sessionSyncCapabilities' | 'daemonInstallationId' | 'updaterProtocolVersion' | 'remoteAccessDisabledAt'>,
  ): void
  updateMachineCliVersion(machineId: string, cliVersion: string): void
  updateMachineAgentList(machineId: string, agentList: string[]): void
  updateMachineAgents(machineId: string, agentList: string[], agents: AgentInfo[]): void
  handleUpgradeEvent(payload: UpgradeEventPayload): void
  renameMachine(machineId: string, name: string): void
  removeMachine(machineId: string): void
  setLoading(loading: boolean): void
  setRemoteResolved(resolved: boolean): void
}

function sanitizeMachine(machine: Machine): Machine {
  return {
    ...machine,
    agentList: filterAvailableAgentTypes(machine.agentList),
    ...(machine.agents ? { agents: filterAvailableAgentInfos(machine.agents) } : {}),
  }
}

export const useMachinesStore = create<MachinesState>((set) => ({
  machines: [],
  loading: true,
  remoteResolved: false,
  upgradeStates: {},

  setMachines(machines) {
    set({ machines: machines.map(sanitizeMachine), loading: false })
  },

  updateMachineStatus(machineId, online, region, cliVersion, autoUpgrade, sync) {
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === machineId
          ? {
              ...m,
              online,
              ...(region ? { region } : {}),
              ...(cliVersion ? { cliVersion } : {}),
              ...(autoUpgrade ? { autoUpgrade } : {}),
              ...(sync?.sessionSyncProtocolVersion != null
                ? { sessionSyncProtocolVersion: sync.sessionSyncProtocolVersion }
                : {}),
              ...(sync?.sessionSyncDataEpoch != null
                ? { sessionSyncDataEpoch: sync.sessionSyncDataEpoch }
                : {}),
              ...(sync?.sessionSyncCapabilities
                ? { sessionSyncCapabilities: sync.sessionSyncCapabilities }
                : {}),
              ...(sync?.daemonInstallationId
                ? { daemonInstallationId: sync.daemonInstallationId }
                : {}),
              ...(sync?.updaterProtocolVersion != null
                ? { updaterProtocolVersion: sync.updaterProtocolVersion }
                : {}),
              ...(sync && Object.prototype.hasOwnProperty.call(sync, 'remoteAccessDisabledAt')
                ? { remoteAccessDisabledAt: sync.remoteAccessDisabledAt ?? null }
                : {}),
            }
          : m,
      ),
    }))
  },

  updateMachineCliVersion(machineId, cliVersion) {
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === machineId ? { ...m, cliVersion } : m,
      ),
    }))
  },

  updateMachineAgentList(machineId, agentList) {
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === machineId ? sanitizeMachine({ ...m, agentList }) : m,
      ),
    }))
  },

  updateMachineAgents(machineId, agentList, agents) {
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === machineId ? sanitizeMachine({ ...m, agentList, agents }) : m,
      ),
    }))
  },

  handleUpgradeEvent(payload) {
    const { machineId, state } = payload as UpgradeEventPayload & { machineId: string }

    set((s) => {
      const upgradeStates = { ...s.upgradeStates }

      if (state === 'success' || state === 'healthy') {
        const to = (payload as { to?: string }).to
        upgradeStates[machineId] = { state, to }
        const machines = s.machines.map((m) =>
          m.id === machineId && to ? { ...m, cliVersion: to } : m,
        )
        return { upgradeStates, machines }
      }

      if (state === 'rolledback' || state === 'rolled_back') {
        const p = payload as { to?: string; reason?: string }
        upgradeStates[machineId] = { state, to: p.to, reason: p.reason }
      } else if (state === 'failed' || state === 'recovery_failed') {
        const p = payload as { error?: string }
        upgradeStates[machineId] = { state, error: p.error }
      } else if (state === 'downloading') {
        const p = payload as { version?: string; progress?: number }
        upgradeStates[machineId] = { state, version: p.version, progress: p.progress }
      } else if (state === 'restarting' || state === 'starting' || state === 'recovering') {
        const p = payload as { from?: string; to?: string }
        upgradeStates[machineId] = { state, from: p.from, to: p.to }
      } else {
        upgradeStates[machineId] = { state }
      }

      return { upgradeStates }
    })
  },

  renameMachine(machineId, name) {
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === machineId ? { ...m, name } : m,
      ),
    }))
  },

  removeMachine(machineId) {
    set((s) => ({
      machines: s.machines.filter((m) => m.id !== machineId),
    }))
  },

  setLoading(loading) {
    set({ loading })
  },

  setRemoteResolved(resolved) {
    set({ remoteResolved: resolved })
  },
}))
