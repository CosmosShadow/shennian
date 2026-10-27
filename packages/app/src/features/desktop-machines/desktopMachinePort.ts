// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-machine-port.test.ts

import type { Machine, ResFrame } from '@shennian/wire'

export type DesktopClaimedMachine = Pick<Machine, 'id' | 'name' | 'os' | 'agentList'>

type Result =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

type AccountOperation = 'machine.list' | 'machine.pair.claim' | 'machine.update' | 'machine.remove'
type SyncOperation =
  | 'machine.observe'
  | 'machine.unobserve'
  | 'machine.upgrade.start'
  | 'machine.upgrade.setPolicy'
  | 'machine.remoteAccess.pause'

type DesktopMachineBridge = {
  account: {
    execute(command: {
      requestId: string
      operation: AccountOperation
      input: Record<string, unknown>
    }): Promise<Result>
  }
  sync: {
    command(command: {
      requestId: string
      operation: SyncOperation
      args: unknown[]
    }): Promise<Result>
  }
}

let requestSequence = 0

export class DesktopMachinePortError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'DesktopMachinePortError'
  }
}

export const desktopMachinePort = {
  async listMachines(): Promise<Machine[]> {
    const value = await accountCommand('machine.list', {})
    const machines = object(value).machines
    if (!Array.isArray(machines)) throw invalidOutput()
    return machines.map(readMachine)
  },

  async claimPair(pairToken: string): Promise<DesktopClaimedMachine> {
    const value = object(await accountCommand('machine.pair.claim', { pairToken }))
    return readClaimedMachine(value.machine)
  },

  async rename(machineId: string, name: string): Promise<void> {
    await accountCommand('machine.update', { machineId, name })
  },

  async remove(machineId: string): Promise<void> {
    await accountCommand('machine.remove', { machineId })
  },

  async observe(machineId: string): Promise<boolean> {
    const value = await syncCommand('machine.observe', [machineId])
    if (typeof value !== 'boolean') throw invalidOutput()
    return value
  },

  async unobserve(machineId: string): Promise<void> {
    await syncCommand('machine.unobserve', [machineId])
  },

  async setUpgradePolicy(machineId: string, enabled: boolean): Promise<ResFrame> {
    return machineCommand(
      'machine.upgrade.setPolicy',
      machineId,
      { policy: enabled ? 'patch' : 'none' },
      15_000,
      30_000,
    )
  },

  async pauseRemoteAccess(machineId: string): Promise<ResFrame> {
    return machineCommand('machine.remoteAccess.pause', machineId, {}, 15_000, 45_000)
  },

  async startUpgrade(
    machineId: string,
    version: string,
    confirmedMajor: boolean,
  ): Promise<ResFrame> {
    return machineCommand(
      'machine.upgrade.start',
      machineId,
      { version, confirmedMajor },
      15_000,
    )
  },
}

async function machineCommand(
  operation: Extract<SyncOperation, `machine.${string}`>,
  machineId: string,
  params: Record<string, unknown>,
  connectTimeoutMs: number,
  responseTimeoutMs?: number,
): Promise<ResFrame> {
  const args: unknown[] = [machineId, params, connectTimeoutMs]
  if (responseTimeoutMs !== undefined) args.push(responseTimeoutMs)
  const value = await syncCommand(operation, args)
  if (!value || typeof value !== 'object' || (value as ResFrame).type !== 'res' ||
      typeof (value as ResFrame).ok !== 'boolean') throw invalidOutput()
  return value as ResFrame
}

async function accountCommand(operation: AccountOperation, input: Record<string, unknown>): Promise<unknown> {
  const result = await requireBridge().account.execute({
    requestId: nextRequestId('account'),
    operation,
    input,
  })
  return unwrap(result)
}

async function syncCommand(operation: SyncOperation, args: unknown[]): Promise<unknown> {
  const result = await requireBridge().sync.command({
    requestId: nextRequestId('sync'),
    operation,
    args,
  })
  return unwrap(result)
}

function requireBridge(): DesktopMachineBridge {
  const bridge = (globalThis as typeof globalThis & { shennianDesktop?: Partial<DesktopMachineBridge> })
    .shennianDesktop
  if (!bridge?.account || typeof bridge.account.execute !== 'function' ||
      !bridge.sync || typeof bridge.sync.command !== 'function') {
    throw new DesktopMachinePortError('BRIDGE_UNAVAILABLE', 'Desktop machine bridge is unavailable.', false)
  }
  return bridge as DesktopMachineBridge
}

function unwrap(result: Result): unknown {
  if (result.ok) return result.value
  throw new DesktopMachinePortError(result.error.code, result.error.message, result.error.retryable)
}

function readMachine(value: unknown): Machine {
  const machine = object(value)
  if (typeof machine.id !== 'string' || typeof machine.name !== 'string' ||
      typeof machine.os !== 'string' || !Array.isArray(machine.agentList)) throw invalidOutput()
  return machine as Machine
}

function readClaimedMachine(value: unknown): DesktopClaimedMachine {
  const machine = object(value)
  if (typeof machine.id !== 'string' || typeof machine.name !== 'string' ||
      typeof machine.os !== 'string' || !Array.isArray(machine.agentList)) throw invalidOutput()
  return machine as DesktopClaimedMachine
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOutput()
  return value as Record<string, unknown>
}

function nextRequestId(scope: 'account' | 'sync'): string {
  return `desktop-machine-${scope}-${Date.now()}-${++requestSequence}`
}

function invalidOutput(): DesktopMachinePortError {
  return new DesktopMachinePortError('INVALID_OUTPUT', 'Desktop machine bridge returned invalid data.', false)
}
