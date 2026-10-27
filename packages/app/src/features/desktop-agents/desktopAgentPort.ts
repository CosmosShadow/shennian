// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-agent-port.test.ts

import type { AgentWorkspace } from '@shennian/wire'
import { requireDesktopAccountSyncBridge } from '../desktop-control/desktopAccountRuntime'

type Mutation = 'agent.update' | 'agent.delete' | 'agent.recover'
type Result =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean; action?: 'retry' | 'sign_in' } }
type AccountBridge = {
  execute(command: { requestId: string; operation: Mutation; input: Record<string, unknown> }): Promise<Result>
}
type DesktopWindow = typeof globalThis & { shennianDesktop?: { account?: AccountBridge } }

let sequence = 0

export class DesktopAgentPortError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopAgentPortError'
  }
}

/** Desktop Agent projection and mutation port. Renderer never reads SQLite or owns credentials. */
export const desktopAgentPort = {
  async listAgents(): Promise<AgentWorkspace[]> {
    const result = await projection('agent.projection.list', [])
    const agents = object(result).agents
    if (!Array.isArray(agents)) invalidOutput()
    return agents.map(agent)
  },
  async getAgent(agentId: string): Promise<AgentWorkspace | null> {
    const value = object(await projection('agent.projection.get', [agentId])).agent
    return value === null ? null : agent(value)
  },
  async updateAgent(agentId: string, changes: unknown): Promise<AgentWorkspace> {
    return agent(object(await mutate('agent.update', { agentId, changes: jsonObject(changes) })).agent)
  },
  async deleteAgent(agentId: string): Promise<void> {
    await mutate('agent.delete', { agentId })
  },
  async recoverAgent(agentId: string): Promise<AgentWorkspace> {
    return agent(object(await mutate('agent.recover', { agentId })).agent)
  },
}

async function projection(operation: 'agent.projection.list' | 'agent.projection.get', args: unknown[]): Promise<unknown> {
  const result = await requireDesktopAccountSyncBridge().command({ requestId: crypto.randomUUID(), operation, args })
  if (result.ok) return result.value
  throw new DesktopAgentPortError(result.error.code, result.error.message, result.error.retryable, result.error.action)
}

async function mutate(operation: Mutation, input: Record<string, unknown>): Promise<unknown> {
  const result = await accountBridge().execute({ requestId: `desktop-agent-${++sequence}`, operation, input })
  if (result.ok) return result.value
  throw new DesktopAgentPortError(result.error.code, result.error.message, result.error.retryable, result.error.action)
}

function accountBridge(): AccountBridge {
  const bridge = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopAgentPortError('BRIDGE_UNAVAILABLE', 'Desktop Agent mutation bridge is unavailable.', false)
  }
  return bridge
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidOutput()
  return value as Record<string, unknown>
}

function agent(value: unknown): AgentWorkspace {
  const item = object(value)
  if (
    typeof item.id !== 'string' || !item.id || typeof item.displayName !== 'string' ||
    typeof item.description !== 'string' || typeof item.machineId !== 'string' || !Array.isArray(item.sessions)
  ) invalidOutput()
  return item as AgentWorkspace
}

function jsonObject(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('Desktop Agent changes must be JSON-compatible.')
  const parsed = JSON.parse(serialized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Desktop Agent changes must be an object.')
  }
  return parsed as Record<string, unknown>
}

function invalidOutput(): never {
  throw new DesktopAgentPortError('INVALID_OUTPUT', 'Desktop Agent response is invalid.', false)
}
