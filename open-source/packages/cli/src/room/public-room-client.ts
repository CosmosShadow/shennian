// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/public-room-client.test.ts

import { loadConfig } from '../config/index.js'
import { SERVERS } from '../region.js'

export class PublicRoomClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextAction: Record<string, string> | null = null,
  ) {
    super(message)
  }
}

export class PublicRoomClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  create(name: string, operationId: string) {
    return this.request(
      'POST',
      '/api/room-cli/create',
      { name, operationId },
      { retryNetworkOnce: true },
    )
  }

  list() {
    return this.request('GET', '/api/room-cli/rooms')
  }

  listContacts(query?: string) {
    const suffix = query ? `?q=${encodeURIComponent(query)}` : ''
    return this.request('GET', `/api/room-cli/contacts${suffix}`)
  }

  get(roomId: string) {
    return this.request('GET', `/api/room-cli/${encodeURIComponent(roomId)}`)
  }

  update(roomId: string, input: {
    version: string
    name?: string
    visibility?: 'private' | 'public_read'
    joinPolicy?: 'open' | 'approval' | 'closed'
  }) {
    return this.request('POST', `/api/room-cli/${encodeURIComponent(roomId)}/update`, input)
  }

  deleteRecord(roomId: string, version: string) {
    return this.request('POST', `/api/room-cli/${encodeURIComponent(roomId)}/delete`, { version })
  }

  getInvite(roomId: string) {
    return this.request('GET', `/api/room-cli/${encodeURIComponent(roomId)}/invite`)
  }

  resetInvite(roomId: string, version: number) {
    return this.request('POST', `/api/room-cli/${encodeURIComponent(roomId)}/invite/reset`, { version })
  }

  listMembers(roomId: string) {
    return this.request('GET', `/api/room-cli/${encodeURIComponent(roomId)}/members`)
  }

  removeMember(roomId: string, memberRef: string, version: number) {
    return this.request('POST', `/api/room-cli/${encodeURIComponent(roomId)}/members/remove`, { memberRef, version })
  }

  join(roomId: string, inviteToken: string, message?: string) {
    return this.request('POST', '/api/room-cli/join', {
      roomId,
      inviteToken,
      ...(message ? { message } : {}),
    })
  }

  open(roomId: string) {
    return this.request('POST', `/api/room-cli/${encodeURIComponent(roomId)}/open`, {})
  }

  status(roomId: string) {
    return this.request('GET', `/api/room-cli/${encodeURIComponent(roomId)}/status`)
  }

  read(roomId: string, input: { before?: string; after?: string; limit: number }) {
    const query = new URLSearchParams({ limit: String(input.limit) })
    if (input.before) query.set('before', input.before)
    if (input.after) query.set('after', input.after)
    return this.request('GET', `/api/room-cli/${encodeURIComponent(roomId)}/messages?${query}`)
  }

  send(roomId: string, input: { clientMessageId: string; text?: string; attachmentIds?: string[] }) {
    return this.request(
      'POST',
      `/api/room-cli/${encodeURIComponent(roomId)}/messages`,
      input,
      { retryNetworkOnce: true },
    )
  }

  initializeAttachment(roomId: string, input: {
    clientUploadId: string
    name: string
    mediaKind: 'image' | 'audio' | 'file'
    mimeType: string
    byteSize: number
    sha256: string
  }) {
    return this.request('POST', `/api/room-cli/${encodeURIComponent(roomId)}/attachments/init`, input)
  }

  completeAttachment(roomId: string, attachmentId: string) {
    return this.request(
      'POST',
      `/api/room-cli/${encodeURIComponent(roomId)}/attachments/${encodeURIComponent(attachmentId)}/complete`,
      {},
    )
  }

  getAttachmentDownload(roomId: string, attachmentId: string) {
    return this.request(
      'GET',
      `/api/room-cli/${encodeURIComponent(roomId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
    )
  }

  leave(roomId: string) {
    return this.request('POST', `/api/room-cli/${encodeURIComponent(roomId)}/leave`, {})
  }

  async upload(url: string, headers: Record<string, string>, data: Buffer): Promise<void> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'PUT',
        headers,
        body: data as unknown as BodyInit,
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      })
    } catch {
      throw new PublicRoomClientError('attachment_upload_failed', 'Attachment upload failed.')
    }
    if (!response.ok) {
      throw new PublicRoomClientError('attachment_upload_failed', 'Attachment upload failed.')
    }
  }

  async download(url: string): Promise<Response> {
    try {
      const response = await this.fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok || !response.body) {
        throw new PublicRoomClientError('attachment_download_failed', 'Attachment download failed.')
      }
      return response
    } catch (error) {
      if (error instanceof PublicRoomClientError) throw error
      throw new PublicRoomClientError('attachment_download_failed', 'Attachment download failed.')
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: { retryNetworkOnce?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const config = loadConfig()
    if (!config.machineToken) {
      throw new PublicRoomClientError(
        'not_paired',
        'Shennian CLI is not paired.',
        { type: 'run_command', command: 'shennian pair --browser' },
      )
    }
    const baseUrl = (config.serverUrl ?? SERVERS.cn.url).replace(/\/+$/, '')
    const execute = () => this.fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.machineToken}`,
        ...(body == null ? {} : { 'content-type': 'application/json' }),
      },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    })
    let response: Response
    try {
      response = await execute()
    } catch {
      if (!options.retryNetworkOnce) {
        throw new PublicRoomClientError('server_unavailable', 'Shennian service is unavailable.')
      }
      try {
        response = await execute()
      } catch {
        throw new PublicRoomClientError('server_unavailable', 'Shennian service is unavailable.')
      }
    }
    const value = await readJson(response)
    if (!response.ok) {
      const record = isRecord(value) ? value : {}
      const code = typeof record.error === 'string' ? record.error : `http_${response.status}`
      const message = typeof record.message === 'string' ? record.message : 'Room request failed.'
      const nextAction = isStringRecord(record.nextAction) ? record.nextAction : null
      throw new PublicRoomClientError(code, message, nextAction)
    }
    if (!isRecord(value)) {
      throw new PublicRoomClientError('invalid_server_response', 'Shennian returned an invalid Room response.')
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
