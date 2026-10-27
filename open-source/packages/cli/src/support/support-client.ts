// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/support-command.test.ts

import { loadConfig } from '../config/index.js'
import { SERVERS } from '../region.js'

export class SupportClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextAction: Record<string, string> | null = null,
  ) {
    super(message)
  }
}

export class SupportClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  status() {
    return this.request('GET', '/api/support-cli/status')
  }

  ask(text: string) {
    return this.request('POST', '/api/support-cli/ask', { text })
  }

  read(input: { before?: string; after?: string; limit: number }) {
    const query = new URLSearchParams({ limit: String(input.limit) })
    if (input.before) query.set('before', input.before)
    if (input.after) query.set('after', input.after)
    return this.request('GET', `/api/support-cli/read?${query}`)
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const config = loadConfig()
    if (!config.machineToken) {
      throw new SupportClientError(
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
        headers: {
          authorization: `Bearer ${config.machineToken}`,
          ...(body == null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body == null ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new SupportClientError('server_unavailable', 'Shennian service is unavailable.')
    }
    const value = await readJson(response)
    if (!response.ok) {
      const record = isRecord(value) ? value : {}
      const code = typeof record.error === 'string' ? record.error : `http_${response.status}`
      const message =
        typeof record.message === 'string' ? record.message : 'Support request failed.'
      const nextAction = isStringRecord(record.nextAction) ? record.nextAction : null
      throw new SupportClientError(code, message, nextAction)
    }
    if (!isRecord(value)) {
      throw new SupportClientError(
        'invalid_server_response',
        'Shennian returned an invalid support response.',
      )
    }
    return value
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
