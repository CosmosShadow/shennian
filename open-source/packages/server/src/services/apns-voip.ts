// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-incoming-call.test.ts

import { readFileSync } from 'node:fs'
import http2 from 'node:http2'
import { systemPushEnabled } from './instance-settings.js'
import jwt from 'jsonwebtoken'

export type ApnsVoipPayload = {
  aps: {
    alert?: string | { title?: string; body?: string }
    sound?: string
    'content-available'?: 1
  }
  call_id: string
  caller_name: string
  reason?: string
  initial_prompt?: string
  project_hint?: string
  timestamp: number
}

export type ApnsVoipTransportRequest = {
  host: string
  path: string
  headers: Record<string, string>
  body: string
}

export type ApnsVoipTransportResponse = {
  statusCode: number
  body: string
}

export type ApnsVoipTransport = (
  request: ApnsVoipTransportRequest,
) => Promise<ApnsVoipTransportResponse>

const APNS_DEVELOPMENT_HOST = 'https://api.sandbox.push.apple.com'
const APNS_PRODUCTION_HOST = 'https://api.push.apple.com'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readPrivateKey(): string {
  const inline = process.env.APNS_PRIVATE_KEY?.trim()
  if (inline) return inline.replace(/\\n/g, '\n')
  const path = process.env.APNS_PRIVATE_KEY_PATH?.trim()
  if (path) return readFileSync(path, 'utf8')
  throw new Error('APNS_PRIVATE_KEY or APNS_PRIVATE_KEY_PATH is required')
}

export function isApnsVoipConfigured(): boolean {
  if (!systemPushEnabled()) return false
  return Boolean(
    process.env.APNS_KEY_ID?.trim() &&
      process.env.APNS_TEAM_ID?.trim() &&
      (process.env.APNS_PRIVATE_KEY?.trim() || process.env.APNS_PRIVATE_KEY_PATH?.trim()),
  )
}

export function buildApnsVoipJwt(nowSeconds = Math.floor(Date.now() / 1000)): string {
  return jwt.sign(
    {
      iss: requiredEnv('APNS_TEAM_ID'),
      iat: nowSeconds,
    },
    readPrivateKey(),
    {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: requiredEnv('APNS_KEY_ID'),
      },
    },
  )
}

export function buildApnsVoipRequest(input: {
  token: string
  payload: ApnsVoipPayload
  nowSeconds?: number
}): ApnsVoipTransportRequest {
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || 'net.shengnian.app'
  const production =
    (process.env.APNS_ENV ?? 'production').trim().toLowerCase() !== 'development'
  return {
    host: production ? APNS_PRODUCTION_HOST : APNS_DEVELOPMENT_HOST,
    path: `/3/device/${input.token}`,
    body: JSON.stringify(input.payload),
    headers: {
      authorization: `bearer ${buildApnsVoipJwt(input.nowSeconds)}`,
      'apns-topic': `${bundleId}.voip`,
      'apns-push-type': 'voip',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 60),
      'content-type': 'application/json',
    },
  }
}

async function defaultApnsVoipTransport(
  request: ApnsVoipTransportRequest,
): Promise<ApnsVoipTransportResponse> {
  return await new Promise((resolve, reject) => {
    const client = http2.connect(request.host)
    const chunks: Buffer[] = []

    client.on('error', (error) => {
      client.close()
      reject(error)
    })

    const stream = client.request({
      ':method': 'POST',
      ':path': request.path,
      ...request.headers,
    })

    stream.on('response', (headers) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      stream.on('end', () => {
        client.close()
        resolve({
          statusCode: Number(headers[':status'] ?? 0),
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    stream.on('error', (error) => {
      client.close()
      reject(error)
    })
    stream.end(request.body)
  })
}

export async function sendApnsVoipPush(input: {
  token: string
  payload: ApnsVoipPayload
  transport?: ApnsVoipTransport
  nowSeconds?: number
}): Promise<void> {
  if (!systemPushEnabled()) throw new Error('push_disabled')
  const transport = input.transport ?? defaultApnsVoipTransport
  const response = await transport(
    buildApnsVoipRequest({
      token: input.token,
      payload: input.payload,
      nowSeconds: input.nowSeconds,
    }),
  )
  if (response.statusCode === 200) return
  throw new Error(`APNs VoIP push failed: ${response.statusCode} ${response.body}`)
}
