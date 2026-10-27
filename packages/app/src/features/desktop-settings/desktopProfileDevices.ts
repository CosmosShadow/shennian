// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-profile-devices.test.ts
import type { ProfileDevice } from '../account/profileAccountClient.types'

export type DesktopDeviceSnapshot = {
  accountId: string
  devices: ProfileDevice[]
  loaded: boolean
  revision: number
}
export function parseDesktopDeviceSnapshot(raw: unknown): DesktopDeviceSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid device projection')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).length !== 4 ||
    !Object.keys(value).every(key => ['accountId', 'devices', 'loaded', 'revision'].includes(key)) ||
    typeof value.accountId !== 'string' || !value.accountId || typeof value.loaded !== 'boolean' ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
    !Array.isArray(value.devices) || value.devices.length > 1000) {
    throw new Error('Invalid device projection')
  }
  const ids = new Set<string>()
  const devices = value.devices.map(rawDevice => {
    if (!rawDevice || typeof rawDevice !== 'object' || Array.isArray(rawDevice)) throw new Error('Invalid device projection')
    const device = rawDevice as Record<string, unknown>
    const keys = ['id', 'platform', 'name', 'lastActiveAt', 'createdAt', 'current']
    if (Object.keys(device).length !== keys.length || !Object.keys(device).every(key => keys.includes(key)) ||
      typeof device.id !== 'string' || !device.id || device.id.length > 1024 || ids.has(device.id) ||
      typeof device.platform !== 'string' || device.platform.length > 1024 ||
      typeof device.name !== 'string' || device.name.length > 1024 ||
      typeof device.lastActiveAt !== 'string' || device.lastActiveAt.length > 1024 ||
      typeof device.createdAt !== 'string' || device.createdAt.length > 1024 ||
      typeof device.current !== 'boolean') throw new Error('Invalid device projection')
    ids.add(device.id)
    return device as ProfileDevice
  })
  return {
    accountId: value.accountId,
    devices,
    loaded: value.loaded,
    revision: value.revision as number,
  }
}

type State = { devices: ProfileDevice[]; loaded: boolean; refreshing: boolean; error: string | null }
type Options = {
  accountId: string | null
  currentAccount(): string | null
  subscribeAccount(listener: () => void): () => void
  subscribeRevision(listener: () => void): () => void
  read(): Promise<DesktopDeviceSnapshot>
  refreshRemote(): Promise<unknown>
}
const empty = (): State => ({ devices: [], loaded: false, refreshing: false, error: null })

/** Only committed main snapshots populate this short-lived view; HTTP replies never do. */
export class DesktopProfileDevicesModel {
  private state = empty()
  private listeners = new Set<() => void>()
  private generation = 0
  private active = false
  private revision = -1
  private readSequence = 0
  private errorSource: 'read' | 'remote' | null = null
  private remote: Promise<void> | null = null
  constructor(private readonly options: Options) {}
  getState = (): State => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener) }
  }
  private publish(state: State): void { this.state = state; for (const listener of this.listeners) listener() }
  private current(generation: number): boolean {
    return this.active && generation === this.generation && !!this.options.accountId &&
      this.options.currentAccount() === this.options.accountId
  }
  start(): () => void {
    this.active = true
    this.generation++
    const unsubscribeAccount = this.options.subscribeAccount(() => {
      if (this.options.currentAccount() !== this.options.accountId) {
        this.active = false; this.generation++; this.remote = null; this.revision = -1
        this.publish(empty())
      }
    })
    let unsubscribeRevision = () => {}
    try { unsubscribeRevision = this.options.subscribeRevision(() => { void this.read() }) }
    catch { this.errorSource = 'read'; this.publish({ ...this.state, error: 'Device projection unavailable' }) }
    if (this.options.accountId) { void this.read(); void this.refresh() }
    return () => {
      this.active = false; this.generation++; this.remote = null; this.revision = -1
      unsubscribeRevision(); unsubscribeAccount(); this.publish(empty())
    }
  }
  private async read(): Promise<void> {
    const generation = this.generation
    const sequence = ++this.readSequence
    if (!this.current(generation)) return
    try {
      const snapshot = await this.options.read()
      if (!this.current(generation)) return
      if (snapshot.accountId !== this.options.accountId) throw new Error('Device projection account mismatch')
      if (snapshot.revision < this.revision) return
      this.revision = snapshot.revision
      const error = this.errorSource === 'read' ? null : this.state.error
      if (this.errorSource === 'read') this.errorSource = null
      this.publish({ ...this.state, devices: snapshot.devices, loaded: snapshot.loaded, error })
    } catch {
      if (this.current(generation) && sequence === this.readSequence) {
        this.errorSource = 'read'
        this.publish({ ...this.state, error: 'Device projection unavailable' })
      }
    }
  }
  refresh = (): Promise<void> => {
    if (this.remote) return this.remote
    const generation = this.generation
    if (!this.current(generation)) return Promise.resolve()
    this.errorSource = null
    this.publish({ ...this.state, refreshing: true, error: null })
    const pending = (async () => {
      try {
        await this.options.refreshRemote()
        if (this.current(generation)) await this.read()
      } catch {
        if (this.current(generation)) {
          this.errorSource = 'remote'
          this.publish({ ...this.state, error: 'Device refresh failed' })
        }
      } finally {
        if (this.current(generation)) this.publish({ ...this.state, refreshing: false })
      }
    })()
    this.remote = pending
    void pending.then(() => { if (this.remote === pending) this.remote = null })
    return pending
  }
}
