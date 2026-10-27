// @covers open-source/packages/shared/src/stores/machines.ts

import { beforeEach, describe, expect, it } from 'vitest'
import type { Machine, UpgradeEventPayload } from '@shennian/wire'
import { useMachinesStore } from '../stores/machines'

function baseMachine(overrides: Partial<Machine> = {}): Machine {
  return {
    id: 'm-1',
    name: 'Alice Mac',
    os: 'macos',
    agentList: ['claude', 'codex'],
    paired: true,
    online: false,
    lastSeen: '2026-04-20T10:00:00.000Z',
    cliVersion: '0.1.28',
    role: 'owner',
    ...overrides,
  }
}

describe('machines store', () => {
  beforeEach(() => {
    useMachinesStore.setState({
      machines: [],
      loading: true,
      remoteResolved: false,
      upgradeStates: {},
    })
  })

  it('setMachines clears loading and filters unknown agent types', () => {
    useMachinesStore.getState().setMachines([
      baseMachine({ agentList: ['claude', 'totally-fake', 'codex'] }),
    ])
    const state = useMachinesStore.getState()
    expect(state.loading).toBe(false)
    expect(state.machines[0].agentList).toEqual(['claude', 'codex'])
  })

  it('preserves and deduplicates valid dynamic ACP agents', () => {
    useMachinesStore.getState().setMachines([
      baseMachine({
        agentList: ['acp:qwen-code', 'acp:company-agent', 'acp:qwen-code', 'acp:', 'acp:BAD'],
        agents: [
          { type: 'acp:qwen-code', models: [], integration: 'acp', display: { name: 'Qwen Code' } },
          { type: 'acp:company-agent', models: [], integration: 'acp', display: { name: 'Company Agent' } },
        ],
      }),
    ])
    expect(useMachinesStore.getState().machines[0]?.agentList).toEqual([
      'acp:qwen-code',
      'acp:company-agent',
    ])
  })

  it('tracks authoritative remote inventory separately from an empty local cache', () => {
    useMachinesStore.getState().setMachines([])
    expect(useMachinesStore.getState().loading).toBe(false)
    expect(useMachinesStore.getState().remoteResolved).toBe(false)

    useMachinesStore.getState().setRemoteResolved(true)
    expect(useMachinesStore.getState().remoteResolved).toBe(true)
  })

  it('updateMachineStatus patches online + optional region/cliVersion only on matching machine', () => {
    useMachinesStore.getState().setMachines([
      baseMachine({ id: 'a', online: false }),
      baseMachine({ id: 'b', online: false }),
    ])
    useMachinesStore.getState().updateMachineStatus('a', true, 'cn', '0.1.30')
    const [a, b] = useMachinesStore.getState().machines
    expect(a).toMatchObject({ id: 'a', online: true, region: 'cn', cliVersion: '0.1.30' })
    expect(b).toMatchObject({ id: 'b', online: false })
  })

  it('projects the daemon session-sync handshake onto the matching machine', () => {
    useMachinesStore.getState().setMachines([baseMachine({ id: 'a' })])
    useMachinesStore.getState().updateMachineStatus('a', true, undefined, undefined, undefined, {
      sessionSyncProtocolVersion: 1,
      sessionSyncCapabilities: ['session_index_v1'],
      daemonInstallationId: 'install-1',
      updaterProtocolVersion: 1,
    })
    expect(useMachinesStore.getState().machines[0]).toMatchObject({
      sessionSyncProtocolVersion: 1,
      sessionSyncCapabilities: ['session_index_v1'],
      daemonInstallationId: 'install-1',
      updaterProtocolVersion: 1,
    })
  })

  it('projects additive recovery-aware updater states', () => {
    useMachinesStore.getState().setMachines([baseMachine()])
    useMachinesStore.getState().handleUpgradeEvent({
      state: 'recovering', machineId: 'm-1', from: '0.4.12', to: '0.4.13',
    })
    expect(useMachinesStore.getState().upgradeStates['m-1']).toMatchObject({
      state: 'recovering', from: '0.4.12', to: '0.4.13',
    })
    useMachinesStore.getState().handleUpgradeEvent({
      state: 'healthy', machineId: 'm-1', to: '0.4.13',
    })
    expect(useMachinesStore.getState().machines[0]?.cliVersion).toBe('0.4.13')
  })

  it('projects and clears the daemon-confirmed pause state', () => {
    useMachinesStore.getState().setMachines([baseMachine({ id: 'a' })])
    useMachinesStore.getState().updateMachineStatus('a', false, undefined, undefined, undefined, {
      remoteAccessDisabledAt: '2026-09-05T12:00:00.000Z',
    })
    expect(useMachinesStore.getState().machines[0]).toMatchObject({
      online: false,
      remoteAccessDisabledAt: '2026-09-05T12:00:00.000Z',
    })
    useMachinesStore.getState().updateMachineStatus('a', true, undefined, undefined, undefined, {
      remoteAccessDisabledAt: null,
    })
    expect(useMachinesStore.getState().machines[0]).toMatchObject({
      online: true,
      remoteAccessDisabledAt: null,
    })
  })

  it('handleUpgradeEvent: success writes cliVersion and records success state', () => {
    useMachinesStore.getState().setMachines([baseMachine({ id: 'm-1', cliVersion: '0.1.28' })])
    const event: UpgradeEventPayload = {
      state: 'success',
      machineId: 'm-1',
      from: '0.1.28',
      to: '0.1.30',
    }
    useMachinesStore.getState().handleUpgradeEvent(event)
    const state = useMachinesStore.getState()
    expect(state.machines[0].cliVersion).toBe('0.1.30')
    expect(state.upgradeStates['m-1']).toEqual({ state: 'success', to: '0.1.30' })
  })

  it('handleUpgradeEvent: failed keeps machine untouched but records error', () => {
    useMachinesStore.getState().setMachines([baseMachine({ id: 'm-1', cliVersion: '0.1.28' })])
    useMachinesStore.getState().handleUpgradeEvent({
      state: 'failed',
      machineId: 'm-1',
      error: 'network timeout',
    })
    const state = useMachinesStore.getState()
    expect(state.machines[0].cliVersion).toBe('0.1.28')
    expect(state.upgradeStates['m-1']).toEqual({ state: 'failed', error: 'network timeout' })
  })

  it('handleUpgradeEvent: downloading carries version + progress', () => {
    useMachinesStore.getState().handleUpgradeEvent({
      state: 'downloading',
      machineId: 'm-1',
      version: '0.1.30',
      progress: 42,
    })
    expect(useMachinesStore.getState().upgradeStates['m-1']).toEqual({
      state: 'downloading',
      version: '0.1.30',
      progress: 42,
    })
  })

  it('renameMachine updates name only on target; removeMachine removes only target', () => {
    useMachinesStore.getState().setMachines([
      baseMachine({ id: 'a', name: 'Alice' }),
      baseMachine({ id: 'b', name: 'Bob' }),
    ])
    useMachinesStore.getState().renameMachine('a', 'Alice2')
    useMachinesStore.getState().removeMachine('b')
    const machines = useMachinesStore.getState().machines
    expect(machines).toHaveLength(1)
    expect(machines[0]).toMatchObject({ id: 'a', name: 'Alice2' })
  })

  it('updateMachineAgents sanitizes unknown agent types while preserving known ones', () => {
    useMachinesStore.getState().setMachines([baseMachine({ id: 'a' })])
    useMachinesStore.getState().updateMachineAgents('a', ['claude', 'nope'], [
      { type: 'claude', models: [] },
      { type: 'unknown' as never, models: [] },
      { type: 'codex', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
    ])
    const machine = useMachinesStore.getState().machines[0]
    expect(machine.agentList).toEqual(['claude'])
    expect(machine.agents?.map((a) => a.type)).toEqual(['claude', 'codex'])
  })
})
