// @arch docs/features/desktop-machine-access-boundary.md
// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-machine-agents.test.ts

import type { AcpExternalSessionInfo, AgentType, NianSession, ResFrame } from '@shennian/wire'
import { desktopAccountActions } from '../desktop-control/useDesktopAccountSync'
import type { DesktopSessionLaunchInput } from '../desktop-launch/desktopSessionLaunch'

export type DesktopMachineAgentCatalogEntry = {
  id: string
  name: string
  website?: string
  platforms?: string[]
}

type AccountResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

type AccountBridge = {
  execute(command: {
    requestId: string
    operation: 'machine.agentCatalog.list'
    input: Record<string, never>
  }): Promise<AccountResult>
}

type DesktopWindow = typeof globalThis & {
  shennianDesktop?: { account?: AccountBridge }
}

let catalogRequestSequence = 0

export const desktopMachineAgentsPort = {
  async listCatalog(): Promise<DesktopMachineAgentCatalogEntry[]> {
    const result = await requireAccountBridge().execute({
      requestId: `desktop-machine-agents-${Date.now()}-${++catalogRequestSequence}`,
      operation: 'machine.agentCatalog.list',
      input: {},
    })
    if (!result.ok) throw new Error(result.error.message)
    const agents = requireObject(result.value).agents
    if (!Array.isArray(agents)) throw invalidResult()
    return agents.map(readCatalogEntry)
  },

  async refresh(machineId: string): Promise<void> {
    requireSuccessfulResponse(await desktopAccountActions.requestMachineOperation<ResFrame>(
      'machine.agents.refresh',
      machineId,
      {},
      { connectTimeoutMs: 15_000, responseTimeoutMs: 120_000 },
    ))
  },

  async startAuth(machineId: string, agentType: AgentType, methodId: string): Promise<void> {
    requireSuccessfulResponse(await desktopAccountActions.requestMachineOperation<ResFrame>(
      'machine.agentAuth.start',
      machineId,
      { agentType, methodId },
      { connectTimeoutMs: 15_000, responseTimeoutMs: 150_000 },
    ))
  },

  async listExternalSessions(
    machineId: string,
    agentType: AgentType,
  ): Promise<AcpExternalSessionInfo[]> {
    const response = requireSuccessfulResponse(
      await desktopAccountActions.requestMachineOperation<ResFrame>(
        'machine.externalSessions.list',
        machineId,
        { agentType },
        { connectTimeoutMs: 15_000, responseTimeoutMs: 30_000 },
      ),
    )
    const sessions = requireObject(response.payload).sessions
    if (!Array.isArray(sessions)) throw invalidResult()
    return sessions.map(readExternalSession)
  },

  async importExternalSession(input: {
    machineId: string
    agentType: AgentType
    external: AcpExternalSessionInfo
    sessionId: string
  }): Promise<void> {
    requireSuccessfulResponse(await desktopAccountActions.requestMachineOperation<ResFrame>(
      'machine.externalSessions.import',
      input.machineId,
      {
        agentType: input.agentType,
        agentSessionId: input.external.agentSessionId,
        sessionId: input.sessionId,
        cwd: input.external.cwd,
        title: input.external.title,
      },
      { connectTimeoutMs: 15_000, responseTimeoutMs: 120_000 },
    ))
  },

  createSession(input: DesktopSessionLaunchInput): Promise<NianSession> {
    return desktopAccountActions.createSession(input)
  },

  async persistSession(session: NianSession): Promise<void> {
    await desktopAccountActions.persistSession(session)
  },

  async discardCreatedSession(sessionId: string): Promise<void> {
    await desktopAccountActions.deleteSession(sessionId, 'none')
  },
}

function requireAccountBridge(): AccountBridge {
  const bridge = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new Error('Desktop account bridge is unavailable.')
  }
  return bridge
}

function requireSuccessfulResponse(response: ResFrame): ResFrame {
  if (!response || response.type !== 'res' || typeof response.ok !== 'boolean') {
    throw invalidResult()
  }
  if (!response.ok) throw new Error(response.error || 'Machine operation failed.')
  return response
}

function readCatalogEntry(value: unknown): DesktopMachineAgentCatalogEntry {
  const entry = requireObject(value)
  if (typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string' || !entry.name) {
    throw invalidResult()
  }
  if (entry.website !== undefined && typeof entry.website !== 'string') throw invalidResult()
  if (entry.platforms !== undefined && (
    !Array.isArray(entry.platforms) || entry.platforms.some(platform => typeof platform !== 'string')
  )) throw invalidResult()
  return entry as DesktopMachineAgentCatalogEntry
}

function readExternalSession(value: unknown): AcpExternalSessionInfo {
  const session = requireObject(value)
  if (
    typeof session.agentSessionId !== 'string' || !session.agentSessionId ||
    typeof session.cwd !== 'string' || !session.cwd ||
    (session.title !== undefined && typeof session.title !== 'string') ||
    (session.updatedAt !== undefined && typeof session.updatedAt !== 'string')
  ) throw invalidResult()
  return session as AcpExternalSessionInfo
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResult()
  return value as Record<string, unknown>
}

function invalidResult(): Error {
  return new Error('Desktop machine agents bridge returned invalid data.')
}
