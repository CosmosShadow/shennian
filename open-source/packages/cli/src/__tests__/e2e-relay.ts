/**
 * @arch open-source/docs/cli-runtime.md
 * @covers src/relay/client.ts
 * @covers src/session/manager.ts
 *
 * Full-chain E2E test: Web client → Server relay → Daemon → Agent → Response.
 *
 * Usage:
 *   USER_TOKEN=<jwt> npx tsx src/__tests__/e2e-relay.ts
 *
 * This script:
 * 1. Creates a session via REST API
 * 2. Connects as a WebSocket client to the relay
 * 3. Sends a chat.send request
 * 4. Waits for agent response events
 * 5. Validates the response contains expected text
 */

import WebSocket from 'ws'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type {
  EventFrame,
  Frame,
  ReqFrame,
  ResFrame,
  SessionBodyDeltaEvent,
  SessionHistorySnapshot,
} from '@shennian/wire'
import {
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_RELEASE_GATE,
  SESSION_SYNC_REQUIRED_CAPABILITIES,
} from '@shennian/wire'
import { evaluateRelayResult } from './e2e-relay-result.js'

const SERVER = process.env.SERVER_URL ?? 'https://shennian.net'
const USER_TOKEN = process.env.USER_TOKEN
const MACHINE_ID = process.env.MACHINE_ID
const AGENT_TYPES = (process.env.AGENT_TYPE ?? 'claude').split(',').map(s => s.trim()).filter(Boolean)
const ACP_RELAY_FIXTURE = process.env.SHENNIAN_E2E_ACP_FIXTURE === '1'
const PROMPT = '严格返回一个hello，只有hello，不要解释'
const TIMEOUT_MS = 90_000
const FINAL_SETTLE_MS = 5_000
const WS_BASE = SERVER.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
const API_BASE =
  SERVER.endsWith('/api') || SERVER.startsWith('http://localhost') || SERVER.startsWith('http://127.0.0.1')
    ? SERVER
    : `${SERVER}/api`
const require = createRequire(import.meta.url)
const TSX_CLI = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs')
const CLI_ENTRY = new URL('../index.ts', import.meta.url)
const mobileLoginCode = require(
  fileURLToPath(new URL('../../../../tests/e2e/helpers/mobile-login-code.cjs', import.meta.url)),
) as {
  MOBILE_TEST_USER_PHONE: string
  fetchMobileLoginCode(input: { serverUrl: string }): Promise<string>
}

let idCounter = 0
let authToken = USER_TOKEN ?? ''
let ownsAuthDevice = false
let managedDaemon: { homeDir: string; child: ChildProcess; machineId: string } | null = null
const createdSessionIds = new Set<string>()
let selectedPersonalIdentity: {
  protocolVersion: typeof SESSION_SYNC_PROTOCOL_VERSION
  dataEpoch: typeof SESSION_SYNC_DATA_EPOCH
  daemonInstallationId: string
} | null = null
function nextId(): string {
  return `test_${Date.now()}_${++idCounter}`
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(selectedPersonalIdentity ? {
        'x-shennian-sync-protocol-version': String(selectedPersonalIdentity.protocolVersion),
        'x-shennian-data-epoch': String(selectedPersonalIdentity.dataEpoch),
      } : {}),
      ...opts.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function ensureUserToken(): Promise<string> {
  if (authToken) return authToken

  const code = await mobileLoginCode.fetchMobileLoginCode({ serverUrl: SERVER })

  const verifyRes = await fetch(`${API_BASE}/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: `+86${mobileLoginCode.MOBILE_TEST_USER_PHONE}`,
      code,
      // The production relay is native-control-plane only. Exercise the same
      // session-sync gate as the released iOS client instead of creating a
      // retired full-control Web device that must be rejected.
      platform: 'ios',
      deviceName: `Relay E2E ${Date.now()}`,
      installationId: `relay-e2e-${process.pid}-${Date.now()}`,
    }),
  })
  if (!verifyRes.ok) {
    const text = await verifyRes.text()
    throw new Error(`verify-code failed with status ${verifyRes.status}: ${text}`)
  }

  const payload = await verifyRes.json() as { token?: string }
  if (!payload.token) {
    throw new Error('verify-code succeeded without token')
  }

  authToken = payload.token
  ownsAuthDevice = true
  console.log('  Auth: acquired the main test account token through the loopback-only login gate')
  return authToken
}

async function cleanupAuthDevice(): Promise<void> {
  if (!ownsAuthDevice || !authToken) return
  ownsAuthDevice = false
  const response = await fetch(`${API_BASE}/auth/devices/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  }).catch(() => null)
  if (!response?.ok) console.warn(`  Auth device cleanup returned ${response?.status ?? 'unavailable'}`)
}

async function apiWithToken<T>(path: string, token: string, opts: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...opts.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function bootstrapRelayMachine(token: string): Promise<string> {
  const daemonInstallationId = `relay-e2e-${process.pid}-${Date.now()}`
  const created = await apiWithToken<{ pairToken: string; machineId: string }>(
    '/machines/pair/create',
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        name: `Relay E2E ${Date.now()}`,
        os: process.platform,
        agentList: ACP_RELAY_FIXTURE ? ['acp:relay-fixture'] : ['claude', 'codex', 'cursor', 'pi'],
        daemonInstallationId,
      }),
    },
  )

  await apiWithToken('/machines/pair/claim', token, {
    method: 'POST',
    body: JSON.stringify({ pairToken: created.pairToken }),
  })

  const status = await apiWithToken<{
    status: string
    machineToken?: string
    machineId?: string
  }>(`/machines/pair/status?token=${encodeURIComponent(created.pairToken)}`, token)

  if (status.status !== 'claimed' || !status.machineToken || !status.machineId) {
    throw new Error(`pair/status did not return a claimed machine: ${JSON.stringify(status)}`)
  }

  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-relay-e2e-'))
  fs.writeFileSync(
    path.join(homeDir, 'config.json'),
    JSON.stringify(
      {
        machineId: status.machineId,
        machineToken: status.machineToken,
        serverUrl: SERVER,
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(
    path.join(homeDir, 'installation.json'),
    JSON.stringify({
      schemaVersion: 1,
      daemonInstallationId,
      createdAt: new Date().toISOString(),
    }, null, 2),
  )
  if (ACP_RELAY_FIXTURE) {
    const manifestDirectory = path.join(homeDir, 'acp-agents.d')
    fs.mkdirSync(manifestDirectory, { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(manifestDirectory, 'relay-fixture.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'relay-fixture',
      name: 'Relay Fixture',
      protocol: 'acp',
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/acp-test-agent.mjs', import.meta.url)), 'relay-hello'],
      enabled: true,
    }), { mode: 0o600 })
  }
  selectedPersonalIdentity = {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId,
  }

  const child = spawn(
    process.execPath,
    [TSX_CLI, fileURLToPath(CLI_ENTRY), 'run-service', '--api', SERVER],
    {
      cwd: path.resolve(fileURLToPath(new URL('../../../../', import.meta.url))),
      env: {
        ...process.env,
        SHENNIAN_HOME: homeDir,
        SHENNIAN_E2E_ISOLATED_DAEMON: '1',
        SHENNIAN_NATIVE_FUSION_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.log(`  daemon: ${text}`)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.log(`  daemon(err): ${text}`)
  })

  managedDaemon = { homeDir, child, machineId: status.machineId }

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const data = await apiWithToken<{ machines: { id: string; online: boolean; agentList?: string[] }[] }>('/machines', token)
    const machine = data.machines.find((item) => item.id === status.machineId)
    if (machine?.online && (!ACP_RELAY_FIXTURE || machine.agentList?.includes('acp:relay-fixture'))) {
      console.log('  Bootstrapped isolated relay machine')
      return status.machineId
    }
    if (child.exitCode !== null) {
      throw new Error(`Isolated daemon exited early with code ${child.exitCode}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  throw new Error(`Timed out waiting for isolated relay machine ${status.machineId} to come online`)
}

async function cleanupManagedDaemon(): Promise<void> {
  const current = managedDaemon
  if (!current) return
  managedDaemon = null

  current.child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      current.child.kill('SIGKILL')
      resolve()
    }, 5000)
    current.child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })

  fs.rmSync(current.homeDir, { recursive: true, force: true })
}

async function getMachineId(): Promise<string> {
  if (process.env.SHENNIAN_E2E_BOOTSTRAP_DAEMON === '1') {
    return bootstrapRelayMachine(authToken)
  }
  const data = await api<{
    machines: Array<{
      id: string
      online: boolean
      cliVersion?: string
      daemonInstallationId?: string
      sessionSyncDataEpoch?: number
      sessionSyncCapabilities?: string[]
    }>
  }>('/machines')
  const eligibleMachines = data.machines.filter(
    (item) =>
      item.online &&
      Boolean(item.daemonInstallationId) &&
      item.sessionSyncDataEpoch === SESSION_SYNC_DATA_EPOCH &&
      SESSION_SYNC_REQUIRED_CAPABILITIES.every((capability) =>
        item.sessionSyncCapabilities?.includes(capability),
      ),
  )
  if (!MACHINE_ID && eligibleMachines.length !== 1) {
    throw new Error(
      `Relay E2E requires one unambiguous online machine; found ${eligibleMachines.length}. ` +
        'Set MACHINE_ID to an explicitly isolated target.',
    )
  }
  const machine = MACHINE_ID
    ? data.machines.find((item) => item.id === MACHINE_ID)
    : eligibleMachines[0]
  if (!machine) throw new Error('No machines found for this user')
  if (!machine.daemonInstallationId || machine.sessionSyncDataEpoch !== SESSION_SYNC_DATA_EPOCH) {
    throw new Error('Selected machine does not expose the current personal sync identity')
  }
  selectedPersonalIdentity = {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: machine.daemonInstallationId,
  }
  console.log(
    `  Machine selected (online: ${machine.online}, cli: ${machine.cliVersion ?? 'unknown'}, ` +
      `current-sync: ${machine.sessionSyncDataEpoch === SESSION_SYNC_DATA_EPOCH}, ` +
      `capabilities: ${machine.sessionSyncCapabilities?.length ?? 0})`,
  )
  return machine.id
}

async function createSession(machineId: string, agentType: string): Promise<string> {
  const data = await api<{ session: { id: string } }>('/sessions', {
    method: 'POST',
    body: JSON.stringify({ machineId, agentType, workDir: '/tmp' }),
  })
  createdSessionIds.add(data.session.id)
  console.log('  Session created')
  return data.session.id
}

async function cleanupCreatedSessions(): Promise<void> {
  for (const sessionId of createdSessionIds) {
    try {
      await api(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ nativeCleanupPolicy: 'none' }),
      })
    } catch (error) {
      const status = error instanceof Error ? error.message.match(/^API (\d+):/)?.[1] : null
      console.warn(`  Session fixture cleanup returned ${status ?? 'unavailable'}`)
    }
  }
  createdSessionIds.clear()
}

function connectRelay(machineId: string): Promise<{
  ws: WebSocket
  send: (frame: Omit<ReqFrame, 'id'>) => Promise<ResFrame>
  events: EventFrame[]
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    if (!selectedPersonalIdentity) {
      reject(new Error('Personal sync identity must be selected before connecting to relay'))
      return
    }
    const params = new URLSearchParams({
      token: authToken,
      syncProtocol: String(SESSION_SYNC_PROTOCOL_VERSION),
      dataEpoch: String(selectedPersonalIdentity.dataEpoch),
      daemonInstallationId: selectedPersonalIdentity.daemonInstallationId,
      syncCapabilities: SESSION_SYNC_REQUIRED_CAPABILITIES.join(','),
      appBuild: String(SESSION_SYNC_RELEASE_GATE.minAppBuild.ios),
    })
    const url = `${WS_BASE}/relay/${machineId}?${params.toString()}`
    const ws = new WebSocket(url)
    const events: EventFrame[] = []
    const pending = new Map<string, { resolve: (r: ResFrame) => void; reject: (e: Error) => void }>()

    ws.on('open', () => {
      console.log('  ✅ WebSocket connected')
      resolve({
        ws,
        events,
        send: (frame) => {
          return new Promise((res, rej) => {
            const id = nextId()
            const req = { ...frame, id } as ReqFrame
            pending.set(id, { resolve: res, reject: rej })
            setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id)
                rej(new Error(`Request ${id} timed out`))
              }
            }, 30_000)
            ws.send(JSON.stringify(req))
          })
        },
        close: () => ws.close(),
      })
    })

    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Frame
      if (frame.type === 'res') {
        const p = pending.get(frame.id)
        if (p) {
          pending.delete(frame.id)
          p.resolve(frame)
        }
      } else if (frame.type === 'event' && frame.event !== 'tick') {
        events.push(frame)
      }
    })

    ws.on('error', (err) => reject(err))
    ws.on('close', (code, reason) => {
      console.log(`  WebSocket closed: ${code} ${reason}`)
    })
  })
}

async function runForAgent(machineId: string, agentType: string, relay: Awaited<ReturnType<typeof connectRelay>>): Promise<boolean> {
  const { send, events } = relay
  if (!selectedPersonalIdentity) throw new Error('Personal sync identity was not initialized')

  console.log(`\n── Testing agent: ${agentType} ──`)

  // Create session
  console.log('  Creating session...')
  const sessionId = await createSession(machineId, agentType)

  // Send message
  console.log(`  Sending exact-response probe (${Buffer.byteLength(PROMPT, 'utf8')} prompt bytes)`)
  const clientMessageId = `relay-e2e-user-${nextId()}`
  const res = await send({
    type: 'req',
    method: 'chat.send',
    params: {
      ...selectedPersonalIdentity,
      sessionId,
      text: PROMPT,
      agentType,
      workDir: '/tmp',
      clientMessageId,
    },
  })
  console.log(`  ACK: ok=${res.ok}${res.error ? ` error=${res.error}` : ''}`)
  if (!res.ok) {
    console.error(`  ❌ chat.send failed for ${agentType}`)
    return false
  }

  // Personal-session bodies are no longer broadcast as raw agent events.
  // Subscribe after durable send so the snapshot contains the user boundary
  // and later canonical mutations deliver the agent response.
  const subscriptionId = `relay-e2e-${nextId()}`
  const historyRes = await send({
    type: 'req',
    method: 'session.history.open',
    params: {
      ...selectedPersonalIdentity,
      sessionId, subscriptionId, cachedBodyRevision: 0, limit: 100,
    },
  })
  if (!historyRes.ok) {
    console.error(`  ❌ session.history.open failed for ${agentType}: ${historyRes.error ?? 'unknown'}`)
    return false
  }

  // Wait for agent response
  console.log('  Waiting for agent response...')
  const startWait = Date.now()
  const extractMessageText = (rawPayload: unknown): string => {
    if (typeof rawPayload !== 'string') return ''
    try {
      const parsed = JSON.parse(rawPayload) as { type?: string; content?: string; thinking?: string }
      if (parsed.type === 'text') return `${parsed.thinking ?? ''}${parsed.content ?? ''}`
      if (parsed.type === 'error') return parsed.content ?? ''
      return rawPayload
    } catch {
      return rawPayload
    }
  }
  const snapshot = historyRes.payload as SessionHistorySnapshot
  let collectedText = snapshot.messages
    .filter((entry) => entry.message.role === 'agent')
    .map((entry) => extractMessageText(entry.message.payload))
    .join('')
  let gotFinal = false
  let finalAt = 0
  let gotError = ''
  let sawSessionActivity = false
  const diagnostics = {
    snapshotAgentMessages: snapshot.messages.filter((entry) => entry.message.role === 'agent').length,
    bodyDeltaEvents: 0,
    bodyDeltaMutations: 0,
    agentMutations: 0,
    agentTextBytes: 0,
    activityNonNull: 0,
    activityNull: 0,
    rawAgentEvents: 0,
    eventCounts: {} as Record<string, number>,
  }

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      for (const evt of events) {
        const payload = evt.payload as Record<string, unknown> | undefined
        if (!payload) continue
        const state = typeof payload.state === 'string' ? `:${payload.state}` : ''
        const eventKey = `${evt.event}${state}`
        diagnostics.eventCounts[eventKey] = (diagnostics.eventCounts[eventKey] ?? 0) + 1

        if (evt.event === 'session.body.delta') {
          const delta = payload as unknown as SessionBodyDeltaEvent
          if (delta.sessionId !== sessionId || delta.subscriptionId !== subscriptionId) continue
          diagnostics.bodyDeltaEvents += 1
          diagnostics.bodyDeltaMutations += delta.mutations.length
          for (const mutation of delta.mutations) {
            if (mutation.message?.role !== 'agent') continue
            diagnostics.agentMutations += 1
            const text = extractMessageText(mutation.message?.payload)
            diagnostics.agentTextBytes += Buffer.byteLength(text, 'utf8')
            if (text) collectedText += text
          }
          continue
        }

        if (evt.event === 'session.body.error') {
          if (payload.sessionId !== sessionId || payload.subscriptionId !== subscriptionId) continue
          gotError = `history_${String(payload.code ?? 'unknown')}`
          continue
        }

        if (evt.event === 'session.message' && payload.sessionId === sessionId) {
          const message = payload.message as Record<string, unknown> | undefined
          if (message?.role !== 'agent') continue
          const text = extractMessageText(message?.payload)
          if (text) collectedText += text
          continue
        }

        if (evt.event === 'session.activity' && payload.sessionId === sessionId) {
          const activity = payload.activity as Record<string, unknown> | null | undefined
          if (activity) {
            diagnostics.activityNonNull += 1
            sawSessionActivity = true
          } else if (sawSessionActivity) {
            diagnostics.activityNull += 1
            gotFinal = true
            if (!finalAt) finalAt = Date.now()
          }
          continue
        }

        // Backward compatibility for older relay servers that still forward raw agent events.
        // The account relay also carries activity from other concurrently running
        // sessions; never let an unrelated final state end this test early.
        if (payload.sessionId !== sessionId) continue
        diagnostics.rawAgentEvents += 1
        if (payload.state === 'delta' && typeof payload.text === 'string') {
          collectedText += payload.text
          continue
        }
        if (payload.state === 'final') {
          gotFinal = true
          if (!finalAt) finalAt = Date.now()
          continue
        }
        if (payload.state === 'error') {
          gotError = String(payload.message ?? 'unknown error')
          console.log(`  ⚠ Agent error: ${gotError}`)
        }
      }
      events.length = 0

      const elapsed = Date.now() - startWait
      if (gotError || (gotFinal && Date.now() - finalAt >= FINAL_SETTLE_MS) || elapsed > TIMEOUT_MS) {
        clearInterval(check)
        resolve()
      }
    }, 500)
  })

  console.log(`  Collected agent text bytes: ${Buffer.byteLength(collectedText, 'utf8')}`)
  console.log(`  Stream metadata: ${JSON.stringify(diagnostics)}`)
  console.log(`  Got final: ${gotFinal} | Duration: ${((Date.now() - startWait) / 1000).toFixed(1)}s`)

  const result = evaluateRelayResult({
    collectedText,
    prompt: PROMPT,
    gotFinal,
    gotError,
    timedOut: Date.now() - startWait >= TIMEOUT_MS,
  })
  if (result.passed) {
    console.log(`  ✅ PASS — ${agentType}`)
    return true
  }
  console.log(`  ❌ FAIL — ${agentType}: ${result.reason}`)
  return false
}

async function main() {
  console.log('\n🔗 Full-chain E2E Relay Test\n')
  console.log(`  Agents to test: ${AGENT_TYPES.join(', ')}`)
  try {
    await ensureUserToken()

    console.log('\n1️⃣  Finding machine...')
    const machineId = await getMachineId()

    console.log('2️⃣  Connecting to relay...')
    const relay = await connectRelay(machineId)

    const results: Record<string, boolean> = {}
    for (const agentType of AGENT_TYPES) {
      results[agentType] = await runForAgent(machineId, agentType, relay)
    }

    relay.close()

    console.log('\n' + '═'.repeat(50))
    console.log('Results:')
    let allPassed = true
    for (const [agent, passed] of Object.entries(results)) {
      console.log(`  ${passed ? '✅' : '❌'} ${agent}`)
      if (!passed) allPassed = false
    }

    if (allPassed) {
      console.log('\n✅ ALL PASSED\n')
      process.exit(0)
    } else {
      console.log('\n❌ SOME TESTS FAILED\n')
      process.exit(1)
    }
  } finally {
    await cleanupCreatedSessions()
    await cleanupManagedDaemon()
    await cleanupAuthDevice()
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
