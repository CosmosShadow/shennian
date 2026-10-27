import chalk from 'chalk'
import { assertSingleServerBinding } from '../config/server-binding.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import os from 'node:os'
import readline from 'node:readline'
import type { Command } from 'commander'
import { loadConfig, saveConfig } from '../config/index.js'
import { detectAgents } from '../agents/detect.js'
import {
  clearRemoteAccessDisabled,
  getDaemonStatus,
  startDaemonProcess,
  installService,
  saveEnvSnapshot,
} from './daemon.js'
import { waitForDaemonReadyStatus } from './daemon-start-wait.js'
import { detectAndChooseServer } from '../region.js'
import { buildPairQrPayload, PAIR_QR_RENDER_OPTIONS } from './pair-qr.js'
import {
  BrowserPairError,
  parsePairModeChoice,
  resolvePairMode,
  runBrowserPairFlow,
  type BrowserPairEvent,
} from './pair-browser.js'
import { markAllSessionIndexesForRepublish } from '../session/store.js'

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

type PairJsonEvent =
  | { type: 'pair.created'; code: string; machineId: string; expiresAt: string }
  | BrowserPairEvent
  | { type: 'pair.waiting' }
  | { type: 'pair.claimed' }
  | { type: 'pair.saved'; machineId: string }
  | { type: 'daemon.starting' }
  | { type: 'done'; status: 'paired'; machineId?: string }
  | { type: 'done'; status: 'already-paired'; machineId?: string }
  | { type: 'error'; code: string; message: string }

function emitPairJson(event: PairJsonEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function failPairJson(code: string, message: string): never {
  emitPairJson({ type: 'error', code, message })
  process.exit(1)
}

function renderTokenBox(token: string): void {
  const line = '─'.repeat(token.length + 4)
  console.log(chalk.cyan(`┌${line}┐`))
  console.log(chalk.cyan('│  ') + chalk.bold.yellow(token) + chalk.cyan('  │'))
  console.log(chalk.cyan(`└${line}┘`))
}

async function renderQR(url: string): Promise<void> {
  const qrcode = (await import('qrcode-terminal')).default as {
    generate: (text: string, opts: { small: boolean }, cb: (qr: string) => void) => void
  }
  return new Promise((resolve) => {
    qrcode.generate(url, PAIR_QR_RENDER_OPTIONS, (qr) => {
      console.log(qr)
      resolve()
    })
  })
}

async function pollStatus(
  serverUrl: string,
  pairToken: string,
  opts: { json?: boolean } = {},
): Promise<{
  machineToken: string
  machineId: string
  machineName: string
  accountNamespaceId: string
} | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  if (opts.json) emitPairJson({ type: 'pair.waiting' })
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    let res: Response
    try {
      res = await fetch(
        `${serverUrl}/api/machines/pair/status?token=${encodeURIComponent(pairToken)}`,
      )
    } catch {
      continue
    }
    if (res.status === 410) {
      if (opts.json) failPairJson('PAIR_EXPIRED', 'Pairing code expired')
      else {
        console.error(chalk.red('\n✗ Pairing code expired. Please re-run: shennian pair'))
        process.exit(1)
      }
    }
    if (!res.ok) continue
    const data = (await res.json()) as {
      status: string
      machineToken?: string
      machineId?: string
      machineName?: string
      accountNamespaceId?: string
    }
    if (
      data.status === 'claimed' && data.machineToken && data.machineId
      && data.accountNamespaceId
    ) {
      if (opts.json) emitPairJson({ type: 'pair.claimed' })
      return {
        machineToken: data.machineToken,
        machineId: data.machineId,
        machineName: data.machineName ?? '',
        accountNamespaceId: data.accountNamespaceId,
      }
    }
  }
  return null
}

function askConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close()
      resolve(ans.trim().toLowerCase() === 'y')
    })
  })
}

function askPairMode(): Promise<'browser' | 'token'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log(chalk.white('Choose how to pair this machine:'))
  console.log(chalk.cyan('  1. Browser authorization (recommended)'))
  console.log(chalk.gray('  2. QR code / pairing token (servers and remote terminals)'))
  return new Promise((resolve) => {
    rl.question('Selection (1/2) [1]: ', (answer) => {
      rl.close()
      resolve(parsePairModeChoice(answer))
    })
  })
}

export async function runPairFlow(opts: {
  serverUrl: string
  machineName: string
  force?: boolean
  json?: boolean
  mode?: 'browser' | 'token'
  openUrl?: (url: string) => Promise<boolean>
}): Promise<void> {
  const { machineName, force, json } = opts
  const serverUrl = assertSingleServerBinding(opts.serverUrl, loadConfig())!
  const config = loadConfig()

  if (config.machineToken && config.machineId && !force) {
    if (json) emitPairJson({ type: 'done', status: 'already-paired', machineId: config.machineId })
    else {
      console.log(chalk.green(`✓ Already paired (machine ID: ${config.machineId})`))
      console.log(chalk.gray('  Run "shennian pair" to re-pair to another account'))
    }
    return
  }

  const detectedAgents = await detectAgents()
  const agentList = detectedAgents.map((a) => a.type)
  const platform = os.platform()
  const osName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'

  if (!json) {
    console.log(chalk.bold('\nShennian CLI — Pairing\n'))
    console.log(
      chalk.gray(
        `  Machine: ${machineName}  |  OS: ${osName}  |  Agents: ${agentList.join(', ') || 'none'}`,
      ),
    )
    console.log()
  }

  let pairMode = opts.mode ?? resolvePairMode({
    json,
    stdinIsTty: Boolean(process.stdin.isTTY),
    stdoutIsTty: Boolean(process.stdout.isTTY),
  })
  if (pairMode === 'prompt') pairMode = await askPairMode()

  if (pairMode === 'browser') {
    const abortController = new AbortController()
    const cancelOnInterrupt = () => abortController.abort()
    process.once('SIGINT', cancelOnInterrupt)
    try {
      const result = await runBrowserPairFlow({
        serverUrl,
        machineName,
        machineOs: osName,
        agentList,
        signal: abortController.signal,
        openUrl: opts.openUrl,
        emit: (event) => {
          if (json) emitPairJson(event)
          else if (event.type === 'pair.browser.created') {
            console.log(chalk.white('Approve this machine in your browser:'))
            console.log(chalk.cyan.underline(event.url))
            console.log(chalk.gray('\nIf the browser did not open, copy this URL to any signed-in device.'))
            console.log(chalk.gray('Waiting for authorization... (Ctrl+C to cancel)'))
          }
        },
      })
      saveConfig({
        ...config,
        machineToken: result.machineToken,
        machineId: result.machineId,
        accountNamespaceId: result.accountNamespaceId,
        serverUrl,
      })
      // Same ownership-transfer rebuild as the token flow below.
      if (opts.force) markAllSessionIndexesForRepublish()
      if (json) emitPairJson({ type: 'pair.saved', machineId: result.machineId })
      else console.log(chalk.green(`\n✓ Paired successfully! Machine "${result.machineName}" is now linked.`))
      return
    } catch (error) {
      const code = error instanceof BrowserPairError
        ? error.code
        : typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'PAIR_BROWSER_FAILED'
      const message = error instanceof Error ? error.message : 'Browser pairing failed'
      if (json) failPairJson(code, message)
      console.error(chalk.red(`\n✗ ${message}`))
      process.exit(1)
    } finally {
      process.removeListener('SIGINT', cancelOnInterrupt)
    }
  }

  let res: Response
  try {
    res = await fetch(`${serverUrl}/api/machines/pair/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: machineName,
        os: osName,
        agentList,
        daemonInstallationId: getDaemonInstallationId(),
      }),
    })
  } catch {
    const message = `Network error: cannot connect to ${serverUrl}`
    if (json) failPairJson('NETWORK_ERROR', message)
    console.error(chalk.red(`✗ ${message}`))
    process.exit(1)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message = `Failed to create machine: ${(body as { error?: string }).error ?? res.statusText}`
    if (json) failPairJson('PAIR_CREATE_FAILED', message)
    console.error(chalk.red(`✗ ${message}`))
    process.exit(1)
  }

  const data = (await res.json()) as { pairToken: string; machineId: string }

  const pairUrl = buildPairQrPayload(data.pairToken)

  if (json) {
    emitPairJson({
      type: 'pair.created',
      code: data.pairToken,
      machineId: data.machineId,
      expiresAt: new Date(Date.now() + POLL_TIMEOUT_MS).toISOString(),
    })
  } else {
    console.log(chalk.white('Scan QR code or enter the pairing code in the Shennian app:'))
    console.log()
    await renderQR(pairUrl)
    renderTokenBox(data.pairToken)
    console.log()
    console.log(chalk.gray('Waiting for pairing... (Ctrl+C to cancel)'))
  }

  const result = await pollStatus(serverUrl, data.pairToken, { json })

  if (!result) {
    if (json) failPairJson('PAIR_TIMEOUT', 'Timed out waiting for pairing')
    console.error(chalk.red('\n✗ Timed out. Pairing code expired, please try again.'))
    process.exit(1)
  }

  saveConfig({
    ...config,
    machineToken: result.machineToken,
    machineId: result.machineId,
    accountNamespaceId: result.accountNamespaceId,
    serverUrl,
  })
  // A successful forced pairing may transfer this installation to another
  // owner. Server projections are intentionally dropped during that atomic
  // transfer, so rebuild them from the unchanged machine-local canonical root.
  // This is keyed to the pairing event, not to an account storage namespace.
  if (opts.force) markAllSessionIndexesForRepublish()
  if (json) emitPairJson({ type: 'pair.saved', machineId: result.machineId })

  if (!json) {
    console.log(
      chalk.green(`\n✓ Paired successfully! Machine "${result.machineName}" is now linked.`),
    )
  }
}

export async function registerDesktopMachine(opts: {
  serverUrl: string
  authToken: string
  machineName: string
}): Promise<{ machineId: string; machineName: string }> {
  const config = loadConfig()
  const detectedAgents = await detectAgents({
    serverUrl: opts.serverUrl,
    authToken: opts.authToken,
  })
  const agentList = detectedAgents.map((a) => a.type)
  const platform = os.platform()
  const osName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'

  const res = await fetch(`${opts.serverUrl}/api/machines/desktop/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.authToken}`,
    },
    body: JSON.stringify({
      machineId: config.machineId,
      name: opts.machineName,
      os: osName,
      agentList,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message = (body as { error?: string }).error ?? res.statusText
    throw new Error(`Failed to register desktop machine: ${message}`)
  }

  const data = (await res.json()) as {
    machine: { id: string; name: string }
    machineToken: string
    accountNamespaceId: string
  }
  if (!data.machine?.id || !data.machineToken || !data.accountNamespaceId) {
    throw new Error('Failed to register desktop machine: missing machine token')
  }

  config.machineId = data.machine.id
  config.machineToken = data.machineToken
  config.accountNamespaceId = data.accountNamespaceId
  config.serverUrl = opts.serverUrl
  saveConfig(config)

  return { machineId: data.machine.id, machineName: data.machine.name }
}

async function resolveDesktopRegisterServerUrl(api?: string): Promise<string> {
  const explicit = api?.trim()
  if (explicit) return explicit

  const envUrl = process.env.SHENNIAN_DESKTOP_SERVER_URL?.trim()
  if (envUrl) return envUrl

  const configUrl = loadConfig().serverUrl?.trim()
  if (configUrl) return configUrl

  return detectAndChooseServer()
}

export async function runSmartStart(
  serverUrl: string | undefined,
  machineName: string,
): Promise<void> {
  const config = loadConfig()

  if (!config.machineToken || !config.machineId) {
    const resolvedUrl = serverUrl ?? (await detectAndChooseServer())
    await runPairFlow({ serverUrl: resolvedUrl, machineName, force: false })
  } else {
    console.log(chalk.green(`✓ Already paired (machine ID: ${config.machineId})`))
  }

  saveEnvSnapshot()
  clearRemoteAccessDisabled()

  console.log(chalk.gray('\nStarting background service...'))
  const startedByService = installService()
  if (!startedByService) {
    startDaemonProcess()
  }
}

export function registerPairCommand(program: Command): void {
  program
    .command('desktop-register', { hidden: true })
    .description('Register this machine to the authenticated account')
    .option('--api <url>', 'Server URL')
    .option('--name <name>', 'Machine name', os.hostname())
    .action(async (opts: { api?: string; name: string }) => {
      try {
        const token = process.env.SHENNIAN_DESKTOP_AUTH_TOKEN
        if (!token) throw new Error('Missing desktop auth token')
        const serverUrl = await resolveDesktopRegisterServerUrl(opts.api)
        const result = await registerDesktopMachine({
          serverUrl,
          authToken: token,
          machineName: opts.name,
        })
        console.log(JSON.stringify({ ok: true, ...result }))
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  program
    .command('pair')
    .description('Pair this machine to a Shennian account (re-pair if already paired)')
    .option('--api <url>', 'Server URL override')
    .option('--server <url>', 'Server URL override')
    .option('--name <name>', 'Machine name', os.hostname())
    .option('--json', 'Emit machine-readable JSONL events')
    .option('--browser', 'Pair by approving a browser authorization request')
    .option('--token', 'Pair with the existing QR code / token flow')
    .option('--force', 'Force re-pair even when a machine token exists')
    .action(async (opts: {
      api?: string
      server?: string
      name: string
      json?: boolean
      browser?: boolean
      token?: boolean
      force?: boolean
    }) => {
      const config = loadConfig()

      let mode: 'browser' | 'token' | 'prompt'
      try {
        mode = resolvePairMode({
          browser: opts.browser,
          token: opts.token,
          json: opts.json,
          stdinIsTty: Boolean(process.stdin.isTTY),
          stdoutIsTty: Boolean(process.stdout.isTTY),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid pairing mode'
        if (opts.json) failPairJson('PAIR_MODE_CONFLICT', message)
        console.error(chalk.red(`✗ ${message}`))
        process.exit(1)
      }
      if (mode === 'prompt') mode = await askPairMode()

      if (config.machineToken && config.machineId && !opts.force) {
        if (opts.json) {
          emitPairJson({ type: 'done', status: 'already-paired', machineId: config.machineId })
          return
        }
        console.log(chalk.yellow(`Currently paired (machine ID: ${config.machineId})`))
        const yes = await askConfirm('Re-pairing will unlink the current account. Continue? (y/N) ')
        if (!yes) {
          console.log(chalk.gray('Cancelled'))
          return
        }
      }

      const serverUrl = assertSingleServerBinding(opts.server ?? opts.api ?? config.serverUrl ?? (await detectAndChooseServer()), config)!
      const forcePair = Boolean(opts.force || (config.machineToken && config.machineId))
      await runPairFlow({
        serverUrl,
        machineName: opts.name,
        force: forcePair,
        json: Boolean(opts.json),
        mode,
      })

      saveEnvSnapshot()
      clearRemoteAccessDisabled()
      if (opts.json) emitPairJson({ type: 'daemon.starting' })
      else console.log(chalk.gray('\nStarting background service...'))
      const startedByService = installService({ quiet: Boolean(opts.json) })
      if (!startedByService) {
        startDaemonProcess({ quiet: Boolean(opts.json) })
      }
      if (opts.json) {
        waitForDaemonReadyStatus(() => getDaemonStatus({ cleanupStale: true }))
        emitPairJson({ type: 'done', status: 'paired', machineId: loadConfig().machineId })
      }
    })
}
