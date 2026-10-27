// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-command.test.ts

import { loadConfig } from '../config/index.js'
import { SERVERS } from '../region.js'
import { PublicAgentClientError } from './public-agent-client.js'

export class ProjectClientError extends PublicAgentClientError {}

/** Project and task control for the paired user; authenticates with the machine token. */
export class ProjectClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  createProject(input: { machineId: string; workDir: string; name?: string }) {
    return this.request('POST', '/api/project-cli/projects', input)
  }

  updateProject(projectId: string, input: { name?: string; agentType?: string; modelId?: string | null }) {
    return this.request('PATCH', `/api/project-cli/projects/${encodeURIComponent(projectId)}`, input)
  }

  watchTask(taskId: string, stewardSessionId: string) {
    return this.request('POST', `/api/project-cli/tasks/${encodeURIComponent(taskId)}/watch`, { stewardSessionId })
  }

  listProjects() {
    return this.request('GET', '/api/project-cli/projects')
  }
  coordinate(input: Record<string, unknown>) {
    return this.request('POST', '/api/project-cli/coordination', input)
  }

  listTasks(projectId: string, limit?: number) {
    return this.request('GET', `/api/project-cli/projects/${encodeURIComponent(projectId)}/tasks${query({ limit })}`)
  }

  createTask(projectId: string, input: {
    instruction: string; requestId: string; agentType?: string; modelId?: string
  }) {
    return this.request('POST', `/api/project-cli/projects/${encodeURIComponent(projectId)}/tasks`, input)
  }

  readTask(taskId: string, limit?: number) {
    return this.request('GET', `/api/project-cli/tasks/${encodeURIComponent(taskId)}/messages${query({ limit })}`)
  }

  sendTask(taskId: string, input: { text: string; requestId: string }) {
    return this.request('POST', `/api/project-cli/tasks/${encodeURIComponent(taskId)}/messages`, input)
  }

  stopTask(taskId: string) {
    return this.request('POST', `/api/project-cli/tasks/${encodeURIComponent(taskId)}/stop`, {})
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const config = loadConfig()
    if (!config.machineToken) {
      throw new ProjectClientError(
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
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new ProjectClientError('server_unavailable', 'Shennian service is unavailable.')
    }
    let value: unknown = null
    try { value = await response.json() } catch { /* handled below */ }
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null
    if (!response.ok) {
      throw new ProjectClientError(
        typeof record?.error === 'string' ? record.error : `http_${response.status}`,
        typeof record?.message === 'string' ? record.message : 'Project request failed.',
      )
    }
    if (!record) {
      throw new ProjectClientError('invalid_server_response', 'Shennian returned an invalid response.')
    }
    return record
  }
}

function query(params: Record<string, number | undefined>): string {
  const parts = Object.entries(params)
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}
