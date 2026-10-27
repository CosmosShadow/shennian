// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/adapter-command.test.ts

import { loadConfig } from '../config/index.js'
import { SERVERS } from '../region.js'

export type AdapterSubmissionPayload = {
  filename: 'adapter.mjs'
  content: string
  sha256: string
  targetAgent: string
  adapterName: string
  adapterVersion: string
  checkedAt: string
  models: string[]
  defaultModel: string
  clientVersion: string
  platform: NodeJS.Platform
}

export class AdapterSubmissionClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export interface AdapterSubmissionClient {
  submit(payload: AdapterSubmissionPayload): Promise<Record<string, unknown>>
}

export class HttpAdapterSubmissionClient implements AdapterSubmissionClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async submit(payload: AdapterSubmissionPayload): Promise<Record<string, unknown>> {
    const config = loadConfig()
    if (!config.machineToken) {
      throw new AdapterSubmissionClientError('not_paired', 'Shennian CLI is not paired.')
    }
    const baseUrl = (config.serverUrl ?? SERVERS.cn.url).replace(/\/+$/, '')
    let response: Response
    try {
      response = await this.fetchImpl(baseUrl + '/api/adapter-submissions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + config.machineToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new AdapterSubmissionClientError(
        'server_unavailable',
        'Shennian service is unavailable.',
      )
    }
    const value = await readJson(response)
    if (!response.ok) {
      const record = isRecord(value) ? value : {}
      throw new AdapterSubmissionClientError(
        typeof record.error === 'string' ? record.error : 'http_' + response.status,
        typeof record.message === 'string'
          ? record.message
          : 'Adapter submission was rejected.',
      )
    }
    if (!isRecord(value)) {
      throw new AdapterSubmissionClientError(
        'invalid_server_response',
        'Shennian returned an invalid Adapter submission response.',
      )
    }
    return value
  }
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
