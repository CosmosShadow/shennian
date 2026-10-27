// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-workspace-command.test.ts

import { loadConfig } from '../config/index.js'
import { SERVERS } from '../region.js'

const PUBLIC_ID = /^[A-Za-z0-9_-]{32}$/

/** A shared link is a locator, never an API origin or an authorization grant. */
export function parsePublishedAgentUrl(value: string, serverUrl: string): string {
  let shared: URL
  let server: URL
  try {
    shared = new URL(value)
    server = new URL(serverUrl)
  } catch {
    throw new PublicAgentClientError('published_agent_url_invalid', 'Use a Shennian published Agent URL.')
  }
  const match = /^\/p\/([A-Za-z0-9_-]{32})\/?$/.exec(shared.pathname)
  if (shared.origin !== server.origin || !match || shared.search || shared.hash
    || !PUBLIC_ID.test(match[1]!)) {
    throw new PublicAgentClientError('published_agent_url_invalid', 'Use a Shennian published Agent URL.')
  }
  return match[1]!
}

export function publishedAgentUrl(publicId: string, serverUrl: string): string {
  if (!PUBLIC_ID.test(publicId)) {
    throw new PublicAgentClientError('published_agent_id_invalid', 'Shennian returned an invalid publication id.')
  }
  return new URL(`/p/${publicId}`, serverUrl).toString()
}

export class PublicAgentClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextAction: Record<string, string> | null = null,
  ) {
    super(message)
  }
}

export class PublicAgentClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  list() {
    return this.request('GET', '/api/agent-cli/agents')
  }

  get(agentId: string) {
    return this.request('GET', `/api/agent-cli/agents/${encodeURIComponent(agentId)}`)
  }

  create(input: Record<string, unknown>) {
    return this.request('POST', '/api/agent-cli/agents', input)
  }

  update(agentId: string, input: Record<string, unknown>) {
    return this.request('PATCH', `/api/agent-cli/agents/${encodeURIComponent(agentId)}`, input)
  }

  delete(agentId: string) {
    return this.request('DELETE', `/api/agent-cli/agents/${encodeURIComponent(agentId)}`)
  }

  listRooms(agentId: string) {
    return this.request('GET', `/api/agent-cli/agents/${encodeURIComponent(agentId)}/rooms`)
  }

  createRoomSession(agentId: string, input: {
    roomId: string
    assignmentIntentId: string
    activationMode: 'auto_follow' | 'mention_only' | 'paused'
  }) {
    return this.request(
      'POST',
      `/api/agent-cli/agents/${encodeURIComponent(agentId)}/room-sessions`,
      input,
    )
  }

  removeFromRoom(agentId: string, roomId: string) {
    return this.request(
      'POST',
      `/api/agent-cli/agents/${encodeURIComponent(agentId)}/rooms/${encodeURIComponent(roomId)}/remove`,
      {},
    )
  }

  async getPublication(agentId: string) {
    const response = await this.request('GET', `/api/agents/${encodeURIComponent(agentId)}/publication`)
    const publication = response.publication
    if (!isRecord(publication) || typeof publication.publicId !== 'string') return response
    const config = loadConfig()
    return {
      ...response,
      publication: {
        ...publication,
        shareUrl: publishedAgentUrl(publication.publicId, config.serverUrl ?? SERVERS.cn.url),
      },
    }
  }

  getPublicationReadiness(agentId: string) {
    return this.request('GET', `/api/agents/${encodeURIComponent(agentId)}/publication/readiness`)
  }

  createPublicationDraft(agentId: string, input: {
    displayName: string; description: string; dailyMessageLimit?: number
  }) {
    return this.request('POST', `/api/agents/${encodeURIComponent(agentId)}/publication/draft`, input)
  }

  setPublicationAnonymousAccess(agentId: string, allowed: boolean,
    expectedGeneration: number, expectedPolicyVersion: number) {
    return this.request('PUT', `/api/agents/${encodeURIComponent(agentId)}/publication/anonymous-access`, {
      allowed, expectedGeneration, expectedPolicyVersion,
    })
  }

  updatePublication(agentId: string, input: {
    expectedGeneration: number; expectedPolicyVersion: number
    displayName: string; description: string; dailyMessageLimit: number
  }) {
    return this.request('PUT', `/api/agents/${encodeURIComponent(agentId)}/publication`, input)
  }

  activatePublication(agentId: string, expectedGeneration: number, expectedPolicyVersion: number) {
    return this.request('POST', `/api/agents/${encodeURIComponent(agentId)}/publication/activate`, {
      expectedGeneration, expectedPolicyVersion,
    })
  }

  pausePublication(agentId: string, expectedGeneration: number, expectedPolicyVersion: number) {
    return this.request('POST', `/api/agents/${encodeURIComponent(agentId)}/publication/pause`, {
      expectedGeneration, expectedPolicyVersion,
    })
  }

  revokePublication(agentId: string, expectedGeneration: number) {
    return this.request('POST', `/api/agents/${encodeURIComponent(agentId)}/publication/revoke`, {
      expectedGeneration,
    })
  }

  listPublicationConversations(agentId: string, cursor?: string) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    return this.request('GET', `/api/agents/${encodeURIComponent(agentId)}/publication/conversations${suffix}`)
  }

  listMyDirectConversations(cursor?: string) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    return this.request('GET', `/api/agent-direct-conversations${suffix}`)
  }

  openPublishedAgent(url: string) {
    const publicId = this.publicIdFromUrl(url)
    return this.request('GET', `/api/published-agents/${publicId}`)
  }

  readPublishedAgent(url: string, paging: { after?: string; before?: string } = {}) {
    const publicId = this.publicIdFromUrl(url)
    const suffix = messagePageSuffix(paging)
    return this.request('GET', `/api/published-agents/${publicId}/conversation${suffix}`)
  }

  readDirectConversation(conversationId: string, paging: { after?: string; before?: string } = {}) {
    const suffix = messagePageSuffix(paging)
    return this.request('GET', `/api/agent-direct-conversations/${encodeURIComponent(conversationId)}${suffix}`)
  }

  sendPublishedAgent(url: string, input: { text: string; clientMessageId: string }) {
    const publicId = this.publicIdFromUrl(url)
    return this.request('POST', `/api/published-agents/${publicId}/messages`, input)
  }

  private publicIdFromUrl(url: string): string {
    const config = loadConfig()
    return parsePublishedAgentUrl(url, config.serverUrl ?? SERVERS.cn.url)
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const config = loadConfig()
    if (!config.machineToken) {
      throw new PublicAgentClientError(
        'not_paired',
        'Shennian CLI is not paired.',
        { type: 'run_command', command: 'shennian pair --browser' },
      )
    }
    const baseUrl = (config.serverUrl ?? SERVERS.cn.url).replace(/\/+$/, '')
    let response: Response
    try {
      response = await this.fetchImpl(`${baseUrl}${path}`, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${config.machineToken}`,
          ...(body == null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body == null ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new PublicAgentClientError('server_unavailable', 'Shennian service is unavailable.')
    }
    const value = await readJson(response)
    if (!response.ok) {
      const record = isRecord(value) ? value : {}
      throw new PublicAgentClientError(
        typeof record.error === 'string' ? record.error : `http_${response.status}`,
        typeof record.message === 'string' ? record.message : 'Agent request failed.',
        isStringRecord(record.nextAction) ? record.nextAction : null,
      )
    }
    if (!isRecord(value)) {
      throw new PublicAgentClientError(
        'invalid_server_response',
        'Shennian returned an invalid Agent response.',
      )
    }
    return value
  }
}

function messagePageSuffix(paging: { after?: string; before?: string }): string {
  if (paging.after !== undefined && paging.before !== undefined) {
    throw new PublicAgentClientError('published_agent_cursor_invalid', 'Use --after or --before, not both.')
  }
  return paging.after !== undefined
    ? `?after=${encodeURIComponent(paging.after)}`
    : `?before=${encodeURIComponent(paging.before ?? 'latest')}`
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
