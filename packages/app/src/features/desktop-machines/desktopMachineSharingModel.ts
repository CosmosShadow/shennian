// @arch docs/design/desktop/unified-desktop-control.md#页面清单与交互矩阵
// @test ../../__tests__/desktop-machine-sharing.test.ts

import type { MachineGrant } from '@shennian/wire'

export type DesktopMachineSharingInvite = {
  grantId: string
  inviteUrl: string
  expiresAt: string | null
}

export type DesktopMachineSharingClient = {
  list(machineId: string): Promise<MachineGrant[]>
  create(machineId: string, expiresAt?: string): Promise<DesktopMachineSharingInvite>
  revoke(machineId: string, grantId: string): Promise<void>
}

export type DesktopMachineSharingState = {
  grants: MachineGrant[]
  invite: DesktopMachineSharingInvite | null
  loading: boolean
  busy: 'create' | `revoke:${string}` | null
  failure: string | null
}

const emptyState = (): DesktopMachineSharingState => ({
  grants: [], invite: null, loading: true, busy: null, failure: null,
})

export class DesktopMachineSharingModel {
  private state = emptyState()
  private listeners = new Set<() => void>()
  private generation = 0
  private loadSequence = 0
  private active = false

  constructor(private readonly options: {
    accountId: string
    machineId: string
    currentAccount(): string | null
    isOwner(): boolean
    client: DesktopMachineSharingClient
  }) {}

  getState = (): DesktopMachineSharingState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  start(): () => void {
    this.active = true
    this.generation += 1
    void this.reload()
    return () => this.stop()
  }
  stop(): void {
    this.active = false
    this.generation += 1
    this.publish(emptyState())
  }
  reload = async (): Promise<boolean> => {
    const generation = this.generation
    if (!this.authorized(generation) || this.state.busy) return false
    const sequence = ++this.loadSequence
    this.publish({ ...this.state, loading: true, failure: null })
    try {
      const grants = await this.options.client.list(this.options.machineId)
      if (!this.authorized(generation) || sequence !== this.loadSequence) return false
      this.publish({ ...this.state, grants, loading: false, failure: null })
      return true
    } catch (error) {
      if (this.current(generation) && sequence === this.loadSequence) {
        this.publish({ ...this.state, grants: [], loading: false, failure: message(error) })
      }
      return false
    }
  }
  create = (expiresAt?: string): Promise<boolean> => this.run('create', async () => {
    const invite = await this.options.client.create(this.options.machineId, expiresAt)
    const grants = await this.options.client.list(this.options.machineId)
    return { invite, grants }
  }, result => ({ ...this.state, invite: result.invite, grants: result.grants }))
  revoke = (grantId: string): Promise<boolean> => {
    if (!this.state.grants.some(grant => grant.id === grantId)) return Promise.resolve(false)
    return this.run(`revoke:${grantId}`, async () => {
      await this.options.client.revoke(this.options.machineId, grantId)
      return this.options.client.list(this.options.machineId)
    }, grants => ({
      ...this.state,
      grants,
      invite: this.state.invite?.grantId === grantId ? null : this.state.invite,
    }))
  }
  clearInvite = (): void => {
    if (this.current(this.generation) && !this.state.busy) this.publish({ ...this.state, invite: null })
  }
  clearFailure = (): void => {
    if (this.current(this.generation) && !this.state.busy) this.publish({ ...this.state, failure: null })
  }

  private async run<T>(
    busy: NonNullable<DesktopMachineSharingState['busy']>,
    operation: () => Promise<T>,
    commit: (value: T) => DesktopMachineSharingState,
  ): Promise<boolean> {
    const generation = this.generation
    if (!this.authorized(generation) || this.state.busy) return false
    this.publish({ ...this.state, busy, failure: null })
    try {
      const result = await operation()
      if (!this.authorized(generation) || this.state.busy !== busy) return false
      this.publish({ ...commit(result), busy: null, failure: null })
      return true
    } catch (error) {
      if (this.current(generation) && this.state.busy === busy) {
        this.publish({ ...this.state, busy: null, failure: message(error) })
      }
      return false
    }
  }
  private current(generation: number): boolean {
    return this.active && generation === this.generation && this.options.currentAccount() === this.options.accountId
  }
  private authorized(generation: number): boolean {
    return this.current(generation) && this.options.isOwner()
  }
  private publish(next: DesktopMachineSharingState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Desktop machine sharing failed.'
}
