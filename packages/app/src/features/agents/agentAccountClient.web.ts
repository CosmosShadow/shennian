// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/agent-account-client-platform-errors.test.ts

export { isAgentAccountNotFound } from './agentAccountClient.types'

import type { AgentWorkspace } from '@shennian/wire'
import type { AgentAccountClient } from './agentAccountClient.types'

type AgentOperation =
  | 'agent.list'
  | 'agent.get'
  | 'agent.create'
  | 'agent.update'
  | 'agent.delete'
  | 'agent.avatar.set'
  | 'agent.avatar.remove'
  | 'agent.recover'
  | 'agent.configureDraft'

type DesktopResult =
  | { ok: true; value: unknown }
  | {
      ok: false
      error: {
        code: string
        message: string
        retryable: boolean
        action?: 'retry' | 'sign_in'
      }
    }

type DesktopAgentAccountBridge = {
  execute(command: {
    requestId: string
    operation: AgentOperation
    input: Record<string, unknown>
  }): Promise<DesktopResult>
}

type DesktopAgentWindow = typeof globalThis & {
  shennianDesktop?: { account?: DesktopAgentAccountBridge }
}

let requestSequence = 0

export class DesktopAgentAccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopAgentAccountError'
  }
}

export const agentAccountClient: AgentAccountClient = {
  async listAgents() {
    const value = await execute('agent.list', {})
    const agents = requireObject(value).agents
    if (!Array.isArray(agents)) throw invalidOutput()
    return agents.map(requireAgent)
  },
  async getAgent(agentId) {
    return requireAgent(requireObject(await execute('agent.get', { agentId })).agent)
  },
  async createAgent(definition) {
    const value = await execute('agent.create', { definition: toJsonObject(definition) })
    return requireAgent(requireObject(value).agent)
  },
  async updateAgent(agentId, changes) {
    const value = await execute('agent.update', { agentId, changes: toJsonObject(changes) })
    return requireAgent(requireObject(value).agent)
  },
  async deleteAgent(agentId) {
    await execute('agent.delete', { agentId })
  },
  async setAgentAvatar(agentId, image, contentType) {
    const value = await execute('agent.avatar.set', {
      agentId,
      contentType,
      base64: bytesToBase64(new Uint8Array(await image.arrayBuffer())),
    })
    const avatar = requireObject(value).avatar
    if (!avatar || typeof avatar !== 'object' || Array.isArray(avatar)) throw invalidOutput()
    return avatar as NonNullable<AgentWorkspace['avatar']>
  },
  async removeAgentAvatar(agentId) {
    await execute('agent.avatar.remove', { agentId })
  },
  async recoverAgent(agentId) {
    return requireAgent(requireObject(await execute('agent.recover', { agentId })).agent)
  },
  async configureAgentDraft<T>(transcript: string, draft: unknown) {
    return execute('agent.configureDraft', {
      draft: { transcript, draft: toJsonObject(draft) },
    }) as Promise<T>
  },
}

function requireBridge(): DesktopAgentAccountBridge {
  const bridge = (globalThis as DesktopAgentWindow).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopAgentAccountError(
      'BRIDGE_UNAVAILABLE',
      'Desktop Agent account bridge is unavailable.',
      false,
    )
  }
  return bridge
}

async function execute(operation: AgentOperation, input: Record<string, unknown>): Promise<unknown> {
  const requestId = `agent-account-${Date.now()}-${++requestSequence}`
  const result = await requireBridge().execute({ requestId, operation, input })
  if (result.ok) return result.value
  throw new DesktopAgentAccountError(
    result.error.code,
    result.error.message,
    result.error.retryable,
    result.error.action,
  )
}

function toJsonObject(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('Agent input is not JSON-compatible')
  const parsed = JSON.parse(serialized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Agent input must be an object')
  }
  return parsed as Record<string, unknown>
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOutput()
  return value as Record<string, unknown>
}

function requireAgent(value: unknown): AgentWorkspace {
  const agent = requireObject(value)
  if (typeof agent.id !== 'string' || typeof agent.displayName !== 'string') throw invalidOutput()
  return agent as AgentWorkspace
}

function invalidOutput(): DesktopAgentAccountError {
  return new DesktopAgentAccountError('INVALID_OUTPUT', 'Desktop Agent response is invalid.', false)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 16 * 1024)))
  }
  return btoa(binary)
}
