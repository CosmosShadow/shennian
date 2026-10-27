// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/pair-browser.test.ts

import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { HttpDeviceAuthorizationClient } from '../room/device-authorization-client.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { hashActionPayload, hashPendingDeviceSecret } from './pair-authorization.js'

const POLL_INTERVAL_MS = 3_000

export type BrowserPairEvent =
  | { type: 'pair.browser.created'; intentId: string; url: string; expiresAt: string }
  | { type: 'pair.waiting' }
  | { type: 'pair.claimed' }

export class BrowserPairError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BrowserPairError'
  }
}

export type BrowserPairResult = {
  machineId: string
  machineToken: string
  accountNamespaceId: string
  machineName: string
  publicLoginUrl: string
}

/**
 * A created authorization request. The device secret never leaves this machine;
 * callers that wait across processes (setup) persist it only in the 0600 state file.
 */
export type BrowserPairIntent = {
  serverUrl: string
  intentId: string
  url: string
  expiresAt: string
  deviceSecret: string
  actionPayloadHash: string
  machineName: string
}

export async function createBrowserPairIntent(input: {
  serverUrl: string
  machineName: string
  machineOs: string
  agentList: string[]
}): Promise<BrowserPairIntent> {
  const client = new HttpDeviceAuthorizationClient(input.serverUrl)
  const deviceSecret = crypto.randomBytes(32).toString('base64url')
  const daemonInstallationId = getDaemonInstallationId()
  const actionPayload = {
    action: 'pair_machine',
    agentList: [...input.agentList].sort(),
    daemonInstallationId,
    machineName: input.machineName,
    machineOs: input.machineOs,
  }
  const actionPayloadHash = hashActionPayload(actionPayload)
  const created = await client.create({
    deviceSecretHash: hashPendingDeviceSecret(deviceSecret),
    daemonInstallationId,
    machineName: input.machineName,
    machineOs: input.machineOs,
    agentList: input.agentList,
    actionType: 'machine.pair',
    actionSummary: 'Pair this machine with your Shennian account',
    actionPayloadHash,
    returnTo: '/spaces',
  })
  return {
    serverUrl: input.serverUrl,
    intentId: created.loginIntentId,
    url: normalizePairAuthorizationUrl(created.publicLoginUrl, input.serverUrl),
    expiresAt: created.expiresAt,
    deviceSecret,
    actionPayloadHash,
    machineName: input.machineName,
  }
}

/**
 * Polls one intent until it is approved and claimed. Returns null when `deadline`
 * passes before approval (the intent itself may still be valid); throws on a
 * terminal state or when the intent expires.
 */
export async function waitForBrowserPairIntent(intent: BrowserPairIntent, input: {
  emit?: (event: BrowserPairEvent) => void
  signal?: AbortSignal
  pollIntervalMs?: number
  deadline?: number
} = {}): Promise<BrowserPairResult | null> {
  const client = new HttpDeviceAuthorizationClient(intent.serverUrl)
  const { deviceSecret, actionPayloadHash } = intent
  const loginIntentId = intent.intentId
  const expiresAt = new Date(intent.expiresAt).getTime()
  const deadline = Math.min(input.deadline ?? expiresAt, expiresAt)
  const interval = input.pollIntervalMs ?? POLL_INTERVAL_MS
  let waitingEmitted = false

  while (true) {
    if (input.signal?.aborted) {
      await client.cancel({ loginIntentId, deviceSecret }).catch(() => undefined)
      throw new BrowserPairError('PAIR_CANCELLED', 'Pairing was cancelled')
    }

    let status: Awaited<ReturnType<HttpDeviceAuthorizationClient['getStatus']>> | null = null
    try {
      status = await client.getStatus({ loginIntentId, deviceSecret })
    } catch {
      status = null
    }
    if (status) {
      if (status.actionPayloadHash !== actionPayloadHash) {
        throw new BrowserPairError(
          'PAIR_PAYLOAD_MISMATCH',
          'Authorization request changed unexpectedly',
        )
      }
      if (status.status === 'denied') {
        throw new BrowserPairError('PAIR_DENIED', 'Pairing request was denied')
      }
      if (status.status === 'expired') {
        throw new BrowserPairError('PAIR_EXPIRED', 'Pairing request expired')
      }
      if (status.status === 'claimed') {
        throw new BrowserPairError('PAIR_ALREADY_CLAIMED', 'Pairing credentials were already claimed')
      }
      if (status.status === 'approved') {
        const claimed = await client.claim({ loginIntentId, deviceSecret })
        if (
          claimed.actionPayloadHash !== actionPayloadHash ||
          !claimed.machineId ||
          !claimed.machineToken ||
          !claimed.accountNamespaceId
        ) {
          throw new BrowserPairError(
            'PAIR_INVALID_CLAIM',
            'Authorization did not return machine credentials',
          )
        }
        input.emit?.({ type: 'pair.claimed' })
        return {
          machineId: claimed.machineId,
          machineToken: claimed.machineToken,
          accountNamespaceId: claimed.accountNamespaceId,
          machineName: intent.machineName,
          publicLoginUrl: intent.url,
        }
      }
      if (!waitingEmitted) {
        waitingEmitted = true
        input.emit?.({ type: 'pair.waiting' })
      }
    }
    if (Date.now() >= expiresAt) {
      throw new BrowserPairError('PAIR_TIMEOUT', 'Timed out waiting for browser authorization')
    }
    if (Date.now() >= deadline) return null
    await wait(Math.min(interval, Math.max(0, deadline - Date.now())), input.signal)
  }
}

export async function runBrowserPairFlow(input: {
  serverUrl: string
  machineName: string
  machineOs: string
  agentList: string[]
  emit?: (event: BrowserPairEvent) => void
  openUrl?: (url: string) => Promise<boolean>
  signal?: AbortSignal
  pollIntervalMs?: number
}): Promise<BrowserPairResult> {
  const intent = await createBrowserPairIntent(input)
  input.emit?.({
    type: 'pair.browser.created',
    intentId: intent.intentId,
    url: intent.url,
    expiresAt: intent.expiresAt,
  })
  await (input.openUrl ?? openExternalUrl)(intent.url).catch(() => false)
  const result = await waitForBrowserPairIntent(intent, {
    emit: input.emit,
    signal: input.signal,
    pollIntervalMs: input.pollIntervalMs,
  })
  if (!result) throw new BrowserPairError('PAIR_TIMEOUT', 'Timed out waiting for browser authorization')
  return result
}

export function resolvePairMode(input: {
  browser?: boolean
  token?: boolean
  json?: boolean
  stdinIsTty?: boolean
  stdoutIsTty?: boolean
}): 'browser' | 'token' | 'prompt' {
  if (input.browser && input.token) {
    throw new BrowserPairError('PAIR_MODE_CONFLICT', 'Choose either --browser or --token, not both')
  }
  if (input.browser) return 'browser'
  if (input.token) return 'token'
  // AI hosts and scripts run without a TTY. A link works for them: the person opens it
  // on any device and signs in with their phone number, without installing the App first.
  if (input.json || !input.stdinIsTty || !input.stdoutIsTty) return 'browser'
  return 'prompt'
}

export function parsePairModeChoice(value: string): 'browser' | 'token' {
  return value.trim() === '2' ? 'token' : 'browser'
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return false
  const { command, args } = browserOpenCommand(process.platform, url)

  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

export function browserOpenCommand(
  platform: NodeJS.Platform,
  url: string,
): {
  command: string
  args: string[]
} {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') {
    return { command: 'explorer.exe', args: [url] }
  }
  return { command: 'xdg-open', args: [url] }
}

export function normalizePairAuthorizationUrl(value: string, serverUrl: string): string {
  let candidate: URL
  let server: URL
  try {
    candidate = new URL(value)
    server = new URL(serverUrl)
  } catch {
    throw new BrowserPairError(
      'PAIR_INVALID_AUTHORIZATION_URL',
      'Server returned an invalid authorization URL',
    )
  }
  if (
    !['http:', 'https:'].includes(candidate.protocol) ||
    candidate.hostname !== server.hostname ||
    candidate.username ||
    candidate.password ||
    candidate.search ||
    candidate.hash ||
    !/^\/authorize\/[A-Za-z0-9_-]{8,128}$/.test(candidate.pathname)
  ) {
    throw new BrowserPairError(
      'PAIR_INVALID_AUTHORIZATION_URL',
      'Server returned an unsafe authorization URL',
    )
  }
  return candidate.toString()
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
