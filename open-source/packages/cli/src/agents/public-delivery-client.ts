// @arch open-source/docs/cli-runtime.md

type FetchLike = typeof fetch

export type PublicAgentClaim = {
  /** Canonical RoomMessage id; also identifies the internal delivery job. */
  messageId: string
  /** Canonical Room id shared by every visitor entry point. */
  conversationId: string
  agentIdentityId: string
  runtimeAdapter: string
  executableFingerprint: string
  bindingId: string
  bindingEpoch: number
  sequence: string
  text: string
  attachments?: Array<{ attachmentId: string; name: string; mimeType: string;
    mediaKind: 'image' | 'video' | 'file'; byteSize: string; sha256: string }>
  leaseToken: string
  leaseExpiresAt: string
}

export class PublicAgentDeliveryError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export class HttpPublicAgentDeliveryClient {
  private readonly baseUrl: string

  constructor(serverUrl: string, private readonly fetchImpl: FetchLike = fetch) {
    this.baseUrl = serverUrl.replace(/\/+$/, '')
  }

  private async post(machineToken: string, path: string, body?: object): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/agent-direct-delivery/${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${machineToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new PublicAgentDeliveryError('public_agent_delivery_unavailable')
    }
    if (!response.ok) {
      let code = `public_agent_delivery_http_${response.status}`
      try {
        const error = (await response.json()) as { error?: unknown }
        if (typeof error.error === 'string' && /^[a-z0-9_-]{1,100}$/.test(error.error)) {
          code = error.error
        }
      } catch {}
      throw new PublicAgentDeliveryError(code)
    }
    try { return await response.json() }
    catch { throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response') }
  }

  async claim(machineToken: string): Promise<PublicAgentClaim | null> {
    const body = await this.post(machineToken, 'claim', { supportsAttachments: true })
    if (!body || typeof body !== 'object' || !('claim' in body)) {
      throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response')
    }
    const value = body.claim
    if (value === null) return null
    if (!validClaim(value)) throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response')
    return value
  }

  async attachment(input: { machineToken: string; claim: PublicAgentClaim;
    attachmentId: string }): Promise<{ downloadUrl: string; name: string;
      mimeType: string; byteSize: string; sha256: string }> {
    const value = await this.post(input.machineToken, 'attachment', {
      messageId: input.claim.messageId, conversationId: input.claim.conversationId,
      bindingEpoch: input.claim.bindingEpoch, leaseToken: input.claim.leaseToken,
      attachmentId: input.attachmentId,
    })
    if (!value || typeof value !== 'object') throw new PublicAgentDeliveryError('public_agent_attachment_invalid')
    const data = value as Record<string, unknown>
    if (typeof data.downloadUrl !== 'string' || !data.downloadUrl.startsWith('https://')
      || typeof data.name !== 'string' || typeof data.mimeType !== 'string'
      || typeof data.byteSize !== 'string' || !/^\d+$/.test(data.byteSize)
      || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) {
      throw new PublicAgentDeliveryError('public_agent_attachment_invalid')
    }
    return data as { downloadUrl: string; name: string; mimeType: string;
      byteSize: string; sha256: string }
  }

  async checkLease(input: { machineToken: string; claim: PublicAgentClaim }): Promise<void> {
    const body = await this.post(input.machineToken, 'check-lease', {
      messageId: input.claim.messageId,
      conversationId: input.claim.conversationId,
      bindingEpoch: input.claim.bindingEpoch,
      leaseToken: input.claim.leaseToken,
    })
    if (!body || typeof body !== 'object' || !('valid' in body)
      || body.valid !== true || !('leaseExpiresAt' in body)
      || typeof body.leaseExpiresAt !== 'string'
      || !Number.isFinite(Date.parse(body.leaseExpiresAt))) {
      throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response')
    }
  }

  async complete(input: {
    machineToken: string; claim: PublicAgentClaim; replyText: string;
    pauseConversation?: boolean
  }): Promise<{ replyMessageId: string; sequence: string; idempotent: boolean }> {
    const request = {
      messageId: input.claim.messageId,
      conversationId: input.claim.conversationId,
      bindingEpoch: input.claim.bindingEpoch,
      leaseToken: input.claim.leaseToken,
      replyText: input.replyText,
      ...(input.pauseConversation ? { pauseConversation: true } : {}),
    }
    // A lost HTTP response can follow a committed reply. Repeat the same
    // exact job/lease request once; the Server returns its existing reply.
    let body: unknown
    try { body = await this.post(input.machineToken, 'complete', request) }
    catch (error) {
      if (!(error instanceof PublicAgentDeliveryError)
        || error.code !== 'public_agent_delivery_unavailable') throw error
      body = await this.post(input.machineToken, 'complete', request)
    }
    if (!body || typeof body !== 'object' || !('replyMessageId' in body)
      || typeof body.replyMessageId !== 'string'
      || !('sequence' in body) || typeof body.sequence !== 'string'
      || !('idempotent' in body) || typeof body.idempotent !== 'boolean') {
      throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response')
    }
    return { replyMessageId: body.replyMessageId, sequence: body.sequence,
      idempotent: body.idempotent }
  }

  async fail(input: { machineToken: string; claim: PublicAgentClaim;
    failureCode: 'runtime_unavailable' | 'execution_failed' | 'timeout' | 'empty_reply'
      | 'provider_limit' | 'unauthorized_tool_attempt' }): Promise<void> {
    const body = await this.post(input.machineToken, 'fail', {
      messageId: input.claim.messageId,
      conversationId: input.claim.conversationId,
      bindingEpoch: input.claim.bindingEpoch,
      leaseToken: input.claim.leaseToken,
      failureCode: input.failureCode,
    })
    if (!body || typeof body !== 'object' || !('failed' in body) || body.failed !== true) {
      throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response')
    }
  }

  async bindSession(input: {
    machineToken: string; claim: PublicAgentClaim; nianSessionId: string
  }): Promise<{ bindingId: string; bindingEpoch: number; nianSessionId: string }> {
    const body = await this.post(input.machineToken, 'bind-session', {
      messageId: input.claim.messageId,
      conversationId: input.claim.conversationId,
      bindingEpoch: input.claim.bindingEpoch,
      leaseToken: input.claim.leaseToken,
      nianSessionId: input.nianSessionId,
    })
    if (!body || typeof body !== 'object' || !('bindingId' in body)
      || body.bindingId !== input.claim.bindingId
      || !('bindingEpoch' in body) || body.bindingEpoch !== input.claim.bindingEpoch
      || !('nianSessionId' in body) || body.nianSessionId !== input.nianSessionId) {
      throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response')
    }
    return { bindingId: input.claim.bindingId,
      bindingEpoch: input.claim.bindingEpoch, nianSessionId: input.nianSessionId }
  }

  async prepareSession(input: {
    machineToken: string; claim: PublicAgentClaim; workDir: string
  }): Promise<{ nianSessionId: string; nativeSessionId: string | null;
    bindingId: string; bindingEpoch: number; workDir: string }> {
    const body = await this.post(input.machineToken, 'prepare-session', {
      messageId: input.claim.messageId,
      conversationId: input.claim.conversationId,
      bindingEpoch: input.claim.bindingEpoch,
      leaseToken: input.claim.leaseToken,
      workDir: input.workDir,
    })
    if (!body || typeof body !== 'object' || !('nianSessionId' in body)
      || typeof body.nianSessionId !== 'string'
      || !/^[A-Za-z0-9_-]{1,191}$/.test(body.nianSessionId)
      || !('bindingId' in body) || body.bindingId !== input.claim.bindingId
      || !('bindingEpoch' in body) || body.bindingEpoch !== input.claim.bindingEpoch
      || !('nativeSessionId' in body)
      || (body.nativeSessionId !== null && (typeof body.nativeSessionId !== 'string'
        || !body.nativeSessionId || body.nativeSessionId.length > 512))
      || !('workDir' in body) || body.workDir !== input.workDir) {
      throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response')
    }
    return { nianSessionId: body.nianSessionId, nativeSessionId: body.nativeSessionId,
      bindingId: input.claim.bindingId,
      bindingEpoch: input.claim.bindingEpoch, workDir: input.workDir }
  }

  async saveNativeSession(input: { machineToken: string; claim: PublicAgentClaim;
    nianSessionId: string; nativeSessionId: string }): Promise<void> {
    const body = await this.post(input.machineToken, 'native-session', {
      messageId: input.claim.messageId,
      conversationId: input.claim.conversationId,
      bindingEpoch: input.claim.bindingEpoch,
      leaseToken: input.claim.leaseToken,
      nianSessionId: input.nianSessionId,
      nativeSessionId: input.nativeSessionId,
    })
    if (!body || typeof body !== 'object'
      || !('nianSessionId' in body) || body.nianSessionId !== input.nianSessionId
      || !('nativeSessionId' in body) || body.nativeSessionId !== input.nativeSessionId) {
      throw new PublicAgentDeliveryError('public_agent_delivery_invalid_response')
    }
  }
}

function validClaim(value: unknown): value is PublicAgentClaim {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return ['messageId', 'conversationId', 'agentIdentityId', 'bindingId'].every((key) =>
    typeof item[key] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(item[key]))
    && typeof item.runtimeAdapter === 'string'
    && item.runtimeAdapter.length > 0 && item.runtimeAdapter.length <= 64
    && typeof item.executableFingerprint === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(item.executableFingerprint)
    && typeof item.text === 'string'
    && item.text.length <= 20_000
    && (item.attachments === undefined || (Array.isArray(item.attachments)
      && item.attachments.length <= 5
      && item.attachments.every((file: unknown) => {
        if (!file || typeof file !== 'object') return false
        const f = file as Record<string, unknown>
        return typeof f.attachmentId === 'string' && /^datt_[a-f0-9-]{36}$/.test(f.attachmentId)
          && typeof f.name === 'string' && f.name.length <= 255
          && typeof f.mimeType === 'string' && f.mimeType.length <= 191
          && ['image', 'video', 'file'].includes(String(f.mediaKind))
          && typeof f.byteSize === 'string' && /^\d+$/.test(f.byteSize)
          && typeof f.sha256 === 'string' && /^[a-f0-9]{64}$/.test(f.sha256)
      })))
    && (item.text.trim().length > 0 || (Array.isArray(item.attachments) && item.attachments.length > 0))
    && typeof item.sequence === 'string'
    && typeof item.leaseExpiresAt === 'string'
    && Number.isSafeInteger(item.bindingEpoch) && Number(item.bindingEpoch) >= 1
    && typeof item.leaseToken === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(item.leaseToken)
    && /^\d{1,20}$/.test(item.sequence as string)
    && Number.isFinite(Date.parse(item.leaseExpiresAt as string))
}
