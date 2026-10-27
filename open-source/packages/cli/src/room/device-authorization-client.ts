// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/device-authorization-client.test.ts

export type DeviceAuthorizationStatus = 'waiting_user' | 'approved' | 'denied' | 'expired' | 'claimed'

export interface DeviceAuthorizationClient {
  create(input: {
    deviceSecretHash: string
    daemonInstallationId: string
    machineName: string
    machineOs: string
    agentList: string[]
    actionType: string
    actionSummary: string
    actionPayloadHash: string
    returnTo: string
  }): Promise<{ loginIntentId: string; publicLoginUrl: string; expiresAt: string }>
  getStatus(input: { loginIntentId: string; deviceSecret: string }): Promise<{
    status: DeviceAuthorizationStatus
    actionPayloadHash: string
  }>
  claim(input: { loginIntentId: string; deviceSecret: string }): Promise<{
    status: 'claimed'
    actionPayloadHash: string
    machineId?: string
    machineToken?: string
    accountNamespaceId?: string
  }>
  cancel(input: { loginIntentId: string; deviceSecret: string }): Promise<{ status: string }>
}

type FetchLike = typeof fetch

export class DeviceAuthorizationHttpError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'DeviceAuthorizationHttpError'
  }
}

export class HttpDeviceAuthorizationClient implements DeviceAuthorizationClient {
  private readonly baseUrl: string

  constructor(serverUrl: string, private readonly fetchImpl: FetchLike = fetch) {
    this.baseUrl = serverUrl.replace(/\/+$/, '')
  }

  async create(input: {
    deviceSecretHash: string
    daemonInstallationId: string
    machineName: string
    machineOs: string
    agentList: string[]
    actionType: string
    actionSummary: string
    actionPayloadHash: string
    returnTo: string
  }): Promise<{ loginIntentId: string; publicLoginUrl: string; expiresAt: string }> {
    const response = await this.request('/auth/device-authorizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const value = response as Partial<{ loginIntentId: string; publicLoginUrl: string; expiresAt: string }>
    if (!value.loginIntentId || !value.publicLoginUrl || !value.expiresAt) {
      throw new DeviceAuthorizationHttpError('invalid_create_response', 'Invalid device authorization response.')
    }
    return value as { loginIntentId: string; publicLoginUrl: string; expiresAt: string }
  }

  async getStatus(input: { loginIntentId: string; deviceSecret: string }): Promise<{
    status: DeviceAuthorizationStatus
    actionPayloadHash: string
  }> {
    const response = await this.request(
      `/auth/device-authorizations/${encodeURIComponent(input.loginIntentId)}/status`,
      { headers: secretHeader(input.deviceSecret) },
    )
    const value = response as Partial<{ status: DeviceAuthorizationStatus; actionPayloadHash: string }>
    if (
      !['waiting_user', 'approved', 'denied', 'expired', 'claimed'].includes(value.status ?? '') ||
      typeof value.actionPayloadHash !== 'string'
    ) {
      throw new DeviceAuthorizationHttpError('invalid_status_response', 'Invalid device authorization status.')
    }
    return value as { status: DeviceAuthorizationStatus; actionPayloadHash: string }
  }

  async claim(input: { loginIntentId: string; deviceSecret: string }): Promise<{
    status: 'claimed'
    actionPayloadHash: string
    machineId?: string
    machineToken?: string
    accountNamespaceId?: string
  }> {
    const response = await this.request(
      `/auth/device-authorizations/${encodeURIComponent(input.loginIntentId)}/claim`,
      { method: 'POST', headers: secretHeader(input.deviceSecret) },
    )
    const value = response as Partial<{
      status: 'claimed'
      actionPayloadHash: string
      machineId: string
      machineToken: string
      accountNamespaceId: string
    }>
    if (value.status !== 'claimed' || typeof value.actionPayloadHash !== 'string') {
      throw new DeviceAuthorizationHttpError('invalid_claim_response', 'Invalid device authorization claim.')
    }
    return value as {
      status: 'claimed'
      actionPayloadHash: string
      machineId?: string
      machineToken?: string
      accountNamespaceId?: string
    }
  }

  async cancel(input: { loginIntentId: string; deviceSecret: string }): Promise<{ status: string }> {
    const response = await this.request(
      `/auth/device-authorizations/${encodeURIComponent(input.loginIntentId)}/cancel`,
      { method: 'POST', headers: secretHeader(input.deviceSecret) },
    )
    const value = response as Partial<{ status: string }>
    if (typeof value.status !== 'string') {
      throw new DeviceAuthorizationHttpError('invalid_cancel_response', 'Invalid device authorization cancellation.')
    }
    return { status: value.status }
  }

  private async request(pathname: string, init: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        ...init,
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new DeviceAuthorizationHttpError('authorization_server_unavailable', 'Shennian authorization server is unavailable.')
    }
    if (!response.ok) {
      let code = `authorization_http_${response.status}`
      try {
        const body = await response.json() as { error?: unknown }
        if (typeof body.error === 'string' && /^[a-z0-9_-]{1,80}$/.test(body.error)) code = body.error
      } catch {}
      throw new DeviceAuthorizationHttpError(code, 'Shennian device authorization request failed.')
    }
    try {
      return await response.json()
    } catch {
      throw new DeviceAuthorizationHttpError('invalid_authorization_response', 'Invalid Shennian authorization response.')
    }
  }
}

function secretHeader(deviceSecret: string): Record<string, string> {
  return { 'x-shennian-device-secret': deviceSecret }
}
