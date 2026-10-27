// @arch docs/features/desktop-machine-pairing.md
// @test ../../__tests__/desktop-machine-pairing.test.ts

import type { Machine } from '@shennian/wire'
import { extractMachineInvitation } from '../../utils/scan'

export type DesktopMachineConnectionInput =
  | { kind: 'pair'; token: string }
  | { kind: 'invite'; token: string }

export type DesktopMachinePairingState = {
  input: string
  phase: 'idle' | 'navigating' | 'claiming' | 'refreshing' | 'refresh-failed'
  error:
    | 'invalid'
    | 'authentication-required'
    | 'pair-unavailable'
    | 'connection-failed'
    | 'refresh-failed'
    | null
}

type Dependencies = {
  isCurrent: () => boolean
  claimPair: (token: string) => Promise<{ id: string }>
  listMachines: () => Promise<Machine[]>
  setMachines: (machines: Machine[]) => void
  isUnauthorized: (error: unknown) => boolean
  isConnectionFailure: (error: unknown) => boolean
  onInvite: (token: string) => void
  onConnected: (machineId: string) => void
}

const PAIR_TOKEN = /^sn-[a-z]{4}-[a-z]{4}-[a-z]{4}$/
const SHARE_PAYLOAD = /^share:([A-Za-z0-9_-]{43})$/

export function parseDesktopMachineConnectionInput(value: string): DesktopMachineConnectionInput | null {
  const input = value.trim()
  const invitation = extractMachineInvitation(input)
  if (invitation) return { kind: 'invite', token: invitation.token }

  const share = SHARE_PAYLOAD.exec(input)
  if (share) return { kind: 'invite', token: share[1]! }

  const token = input.startsWith('pair:') ? input.slice(5).trim() : input
  return PAIR_TOKEN.test(token) ? { kind: 'pair', token } : null
}

export class DesktopMachinePairingModel {
  private state: DesktopMachinePairingState = { input: '', phase: 'idle', error: null }
  private listeners = new Set<() => void>()
  private active = false
  private operation = 0
  private claimedMachineId: string | null = null

  constructor(private readonly dependencies: Dependencies) {}

  getState = (): DesktopMachinePairingState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): () => void {
    this.active = true
    return () => {
      this.active = false
      this.operation += 1
      this.listeners.clear()
    }
  }

  setInput(input: string): void {
    if (this.state.phase !== 'idle') return
    this.update({ input, error: null })
  }

  async submit(): Promise<void> {
    if (!this.current() || this.state.phase !== 'idle') return
    const parsed = parseDesktopMachineConnectionInput(this.state.input)
    if (!parsed) {
      this.update({ error: 'invalid' })
      return
    }
    if (parsed.kind === 'invite') {
      this.update({ phase: 'navigating', error: null })
      this.dependencies.onInvite(parsed.token)
      return
    }

    const operation = ++this.operation
    this.claimedMachineId = null
    this.update({ phase: 'claiming', error: null })
    try {
      const claimed = await this.dependencies.claimPair(parsed.token)
      if (!this.valid(operation)) return
      this.claimedMachineId = claimed.id
      await this.refreshMachines(operation)
    } catch (error) {
      if (!this.valid(operation) || this.claimedMachineId) return
      this.update({
        phase: 'idle',
        error: this.dependencies.isUnauthorized(error)
          ? 'authentication-required'
          : this.dependencies.isConnectionFailure(error)
            ? 'connection-failed'
            : 'pair-unavailable',
      })
    }
  }

  async retryRefresh(): Promise<void> {
    if (!this.current() || !this.claimedMachineId || this.state.phase !== 'refresh-failed') return
    await this.refreshMachines(++this.operation)
  }

  private async refreshMachines(operation: number): Promise<void> {
    this.update({ phase: 'refreshing', error: null })
    try {
      const machines = await this.dependencies.listMachines()
      if (!this.valid(operation)) return
      const machineId = this.claimedMachineId
      if (!machineId || !machines.some(machine => machine.id === machineId)) {
        this.update({ phase: 'refresh-failed', error: 'refresh-failed' })
        return
      }
      this.dependencies.setMachines(machines)
      this.claimedMachineId = null
      this.update({ input: '', phase: 'idle', error: null })
      this.dependencies.onConnected(machineId)
    } catch {
      if (!this.valid(operation)) return
      this.update({ phase: 'refresh-failed', error: 'refresh-failed' })
    }
  }

  private current(): boolean {
    return this.active && this.dependencies.isCurrent()
  }

  private valid(operation: number): boolean {
    return operation === this.operation && this.current()
  }

  private update(update: Partial<DesktopMachinePairingState>): void {
    this.state = { ...this.state, ...update }
    this.listeners.forEach(listener => listener())
  }
}
