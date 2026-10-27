// @arch open-source/docs/cli-runtime.md
// @covers src/agents/codex-managed-permissions.ts

import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { nativeTestWorkspaceRoot } from '../src/native-fusion/test-workspace.js'
import readline from 'node:readline'
import type { ManagedAgentEnforcement, ManagedAgentFileAccess } from '@shennian/wire'
import {
  CODEX_MANAGED_PERMISSION_PROFILE_ID,
  compileCodexManagedPermissions,
} from '../src/agents/codex-managed-permissions.js'

type ResultStatus = 'pass' | 'fail' | 'unavailable'

type CheckResult = {
  profile: string
  check: string
  status: ResultStatus
  diagnostic?: string
}

type Command = {
  executable: string
  prefixArgs: string[]
}

const fixturePrefix = 'shennian-codex-security-e2e-'
const secretEnvironmentKey = 'SHENNIAN_E2E_SECRET_SENTINEL'
const keepFixture = process.argv.includes('--keep')
const setupWindowsSandbox = process.argv.includes('--setup-windows-sandbox')
const outputPath = process.argv.find((entry) => entry.startsWith('--output='))?.slice('--output='.length)
const windowsSandboxOverride = process.argv.find((entry) => (
  entry.startsWith('--windows-sandbox=')
))?.split('=', 2)[1]
const selectedProfile = process.argv.find((entry) => (
  entry.startsWith('--profile=')
))?.split('=', 2)[1] as ManagedAgentFileAccess | undefined

if (selectedProfile && !['workspace-read', 'workspace-write', 'host-full'].includes(selectedProfile)) {
  throw new Error('invalid_profile_selection')
}

function enforcement(fileAccess: ManagedAgentFileAccess): ManagedAgentEnforcement {
  return {
    level: 'hard',
    runtimeVersion: 'real-e2e',
    platform: process.platform,
    unsupportedCapabilities: [],
    effectivePolicy: {
      version: 1,
      fileAccess,
      externalCapabilities: {
        commandNetwork: false,
        webSearch: false,
        browser: false,
        computerUse: false,
        mcp: false,
      },
    },
  }
}

function resolveCodexCommand(): Command {
  if (process.platform !== 'win32') {
    return { executable: 'codex', prefixArgs: [] }
  }

  const where = spawnSync('where.exe', ['codex'], { encoding: 'utf8' })
  const candidates = (where.stdout ?? '')
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const executable = candidates.find((entry) => entry.toLowerCase().endsWith('.exe'))
  if (executable) return { executable, prefixArgs: [] }

  for (const wrapper of candidates.filter((entry) => /\.cmd$/iu.test(entry))) {
    const entrypoint = path.join(
      path.dirname(wrapper),
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    )
    if (fs.existsSync(entrypoint)) {
      return { executable: process.execPath, prefixArgs: [entrypoint] }
    }
  }
  throw new Error('codex_executable_not_found')
}

async function runWindowsSandboxSetup(codex: Command): Promise<void> {
  if (process.platform !== 'win32') throw new Error('windows_sandbox_setup_requires_windows')
  const child = spawn(codex.executable, [...codex.prefixArgs, 'app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = readline.createInterface({ input: child.stdout })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('windows_sandbox_setup_timed_out'))
    }, 180_000)

    const finish = (error?: Error) => {
      clearTimeout(timeout)
      lines.close()
      child.kill()
      if (error) reject(error)
      else resolve()
    }

    lines.on('line', (line) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(line) as Record<string, unknown>
      } catch {
        return
      }
      if (message.id === 1) {
        child.stdin.write(`${JSON.stringify({
          id: 2,
          method: 'windowsSandbox/setupStart',
          params: { mode: 'elevated' },
        })}\n`)
        return
      }
      if (message.method !== 'windowsSandbox/setupCompleted') return
      const params = message.params as { success?: boolean; error?: unknown } | undefined
      if (params?.success) {
        process.stdout.write(`${JSON.stringify({ windowsSandboxSetup: 'success' })}\n`)
        finish()
      } else {
        finish(new Error(`windows_sandbox_setup_failed: ${String(params?.error ?? stderr).slice(0, 300)}`))
      }
    })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (code !== null) finish(new Error(`windows_sandbox_setup_exited_${code}`))
    })
    child.stdin.write(`${JSON.stringify({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'shennian-security-e2e', title: 'Shennian Security E2E', version: '1' },
        capabilities: { experimentalApi: true },
      },
    })}\n`)
  })
}

function safeBaseDirectory(): string {
  const root = nativeTestWorkspaceRoot()
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  return root
}

function writeProbeRunner(filePath: string): void {
  fs.writeFileSync(filePath, `
import fs from 'node:fs'
import net from 'node:net'
import { spawnSync } from 'node:child_process'

const [action, ...args] = process.argv.slice(2)
const done = (ok, unavailable = false) => process.exit(ok ? 0 : unavailable ? 77 : 42)

try {
  if (action === 'read') {
    fs.readFileSync(args[0])
    done(true)
  }
  if (action === 'write') {
    fs.writeFileSync(args[0], 'probe')
    done(true)
  }
  if (action === 'write-lifecycle') {
    fs.writeFileSync(args[0], 'first')
    fs.appendFileSync(args[0], 'second')
    fs.renameSync(args[0], args[1])
    fs.unlinkSync(args[1])
    done(true)
  }
  if (action === 'rename') {
    fs.renameSync(args[0], args[1])
    done(true)
  }
  if (action === 'link') {
    fs.linkSync(args[0], args[1])
    done(true)
  }
  if (action === 'env-absent') {
    done(process.env[args[0]] === undefined)
  }
  if (action === 'node-child-read') {
    const child = spawnSync(process.execPath, [
      '-e',
      "require('node:fs').readFileSync(process.argv[1])",
      args[0],
    ], { stdio: 'ignore' })
    done(child.status === 0)
  }
  if (action === 'shell-read') {
    const child = process.platform === 'win32'
      ? spawnSync('powershell.exe', [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
          'Get-Content -LiteralPath $args[0] | Out-Null', args[0],
        ], { stdio: 'ignore' })
      : spawnSync('/bin/sh', ['-c', 'test -r "$1" && { head -c 1 "$1" >/dev/null; }', 'sh', args[0]], {
          stdio: 'ignore',
        })
    done(child.status === 0)
  }
  if (action === 'python-read') {
    const candidates = process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']
    let launched = false
    for (const command of candidates) {
      const child = spawnSync(command, [
        '-c', 'import pathlib,sys; pathlib.Path(sys.argv[1]).read_bytes()', args[0],
      ], { stdio: 'ignore' })
      if (child.error && child.error.code === 'ENOENT') continue
      launched = true
      done(child.status === 0)
    }
    done(false, !launched)
  }
  if (action === 'tcp') {
    const socket = net.createConnection({ host: args[0], port: Number(args[1]) })
    const timer = setTimeout(() => { socket.destroy(); done(false) }, 5000)
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); done(true) })
    socket.once('error', () => { clearTimeout(timer); done(false) })
  }
  if (action === 'unix') {
    const socket = net.createConnection({ path: args[0] })
    const timer = setTimeout(() => { socket.destroy(); done(false) }, 5000)
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); done(true) })
    socket.once('error', (error) => {
      clearTimeout(timer)
      fs.writeSync(2, String(error?.code ?? 'unix_socket_error'))
      done(false)
    })
  }
  if (action !== 'tcp' && action !== 'unix') done(false)
} catch (error) {
  if (action === 'unix') fs.writeSync(2, String(error?.code ?? 'unix_socket_error'))
  done(false)
}
`)
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key)
}

function tomlValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`
  throw new Error('unsupported_toml_value')
}

function tomlInlineValue(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return `{ ${Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${tomlKey(key)} = ${tomlInlineValue(child)}`)
      .join(', ')} }`
  }
  return tomlValue(value)
}

function configOverrideArgs(config: Record<string, unknown>): string[] {
  return Object.entries(config).flatMap(([key, value]) => [
    '-c',
    `${key}=${tomlInlineValue(value)}`,
  ])
}

function serializeToml(config: Record<string, unknown>): string {
  const lines: string[] = []

  function visit(table: Record<string, unknown>, segments: string[]): void {
    const scalars = Object.entries(table).filter(([, value]) => (
      value === null || typeof value !== 'object' || Array.isArray(value)
    ))
    const children = Object.entries(table).filter(([, value]) => (
      value !== null && typeof value === 'object' && !Array.isArray(value)
    ))

    if (segments.length) lines.push(`[${segments.map(tomlKey).join('.')}]`)
    for (const [key, value] of scalars) {
      if (value === null) continue
      lines.push(`${tomlKey(key)} = ${tomlValue(value)}`)
    }
    if (segments.length || scalars.length) lines.push('')

    for (const [key, value] of children) {
      visit(value as Record<string, unknown>, [...segments, key])
    }
  }

  visit(config, [])
  return `${lines.join('\n').trim()}\n`
}

function diagnostic(result: SpawnSyncReturns<string>, fixtureRoot: string): string | undefined {
  const message = [
    result.error?.message,
    result.stderr,
  ].filter(Boolean).join(' ').replaceAll(fixtureRoot, '<fixture>').trim()
  if (!message) return undefined
  return message.replace(/\s+/gu, ' ').slice(0, 300)
}

async function run(): Promise<void> {
  const codex = resolveCodexCommand()
  const versionResult = spawnSync(codex.executable, [...codex.prefixArgs, '--version'], {
    encoding: 'utf8',
  })
  if (versionResult.status !== 0) throw new Error('codex_version_probe_failed')
  const runtimeVersion = (versionResult.stdout ?? '').trim()

  if (setupWindowsSandbox) {
    await runWindowsSandboxSetup(codex)
    return
  }

  const fixtureRoot = fs.mkdtempSync(path.join(safeBaseDirectory(), fixturePrefix))
  const workDir = path.join(fixtureRoot, 'workspace')
  const outsideDir = path.join(fixtureRoot, 'outside')
  const otherVisitorDir = path.join(fixtureRoot, 'other-visitor')
  const configHome = path.join(fixtureRoot, 'codex-home')
  fs.mkdirSync(workDir)
  fs.mkdirSync(outsideDir)
  fs.mkdirSync(otherVisitorDir)
  fs.mkdirSync(configHome)
  const realWorkDir = fs.realpathSync(workDir)
  const randomSentinel = () => crypto.randomBytes(32).toString('hex')
  const insideFile = path.join(realWorkDir, 'inside.txt')
  const outsideFile = path.join(outsideDir, 'outside.txt')
  const otherVisitorFile = path.join(otherVisitorDir, 'fake-visitor-secret.txt')
  const workspaceEnv = path.join(realWorkDir, '.env')
  const workspaceKey = path.join(realWorkDir, 'test-private.key')
  const probeRunner = path.join(realWorkDir, 'probe-runner.mjs')
  const shennianHome = path.join(os.homedir(), '.shennian')
  const shennianHomeSentinel = path.join(
    shennianHome,
    `${fixturePrefix}${crypto.randomUUID()}.sentinel`,
  )
  let shennianHomeSentinelAvailable = false
  const managedRuntimeRoot = process.platform === 'win32'
    ? ''
    : fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-managed-room-e2e-'))
  const managedRuntimeDir = managedRuntimeRoot
    ? path.join(managedRuntimeRoot, 'runtime')
    : ''
  const managedRuntimeSentinel = path.join(
    managedRuntimeDir,
    `${fixturePrefix}${crypto.randomUUID()}.read`,
  )
  const managedRuntimeSocket = path.join(
    process.platform === 'win32' ? managedRuntimeDir : '/tmp',
    `sn-mrc-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sock`,
  )
  let managedRuntimeSentinelAvailable = false
  let managedRuntimeSocketAvailable = false
  fs.writeFileSync(insideFile, randomSentinel())
  fs.writeFileSync(outsideFile, randomSentinel())
  fs.writeFileSync(otherVisitorFile, randomSentinel())
  fs.writeFileSync(workspaceEnv, randomSentinel())
  fs.writeFileSync(workspaceKey, randomSentinel())
  writeProbeRunner(probeRunner)
  try {
    if (fs.statSync(shennianHome).isDirectory()) {
      fs.writeFileSync(shennianHomeSentinel, randomSentinel())
      shennianHomeSentinelAvailable = true
    }
  } catch {
    shennianHomeSentinelAvailable = false
  }
  try {
    if (managedRuntimeRoot) {
      fs.mkdirSync(managedRuntimeDir)
      fs.writeFileSync(managedRuntimeSentinel, randomSentinel())
      managedRuntimeSentinelAvailable = true
    }
  } catch {
    managedRuntimeSentinelAvailable = false
  }

  const symlinkTarget = process.platform === 'win32'
    ? path.join(realWorkDir, 'outside-junction', 'outside.txt')
    : path.join(realWorkDir, 'outside-symlink.txt')
  let symlinkAvailable = true
  try {
    if (process.platform === 'win32') {
      fs.symlinkSync(outsideDir, path.dirname(symlinkTarget), 'junction')
    } else {
      fs.symlinkSync(outsideFile, symlinkTarget)
    }
  } catch {
    symlinkAvailable = false
  }

  const hardlinkTarget = path.join(realWorkDir, 'outside-hardlink.txt')
  let hardlinkAvailable = true
  try {
    const capabilityProbe = path.join(realWorkDir, 'hardlink-capability-probe.txt')
    fs.linkSync(outsideFile, capabilityProbe)
    fs.unlinkSync(capabilityProbe)
  } catch {
    hardlinkAvailable = false
  }

  const listener = net.createServer(() => undefined)
  const managedRuntimeSocketListener = net.createServer((socket) => socket.end())
  const results: CheckResult[] = []

  return new Promise<void>((resolve, reject) => {
    listener.once('error', reject)
    managedRuntimeSocketListener.once('error', () => {
      managedRuntimeSocketAvailable = false
      startNetworkProbe()
    })

    const startNetworkProbe = () => listener.listen(0, '0.0.0.0', () => {
      try {
        const address = listener.address()
        if (!address || typeof address === 'string') throw new Error('network_probe_unavailable')
        const localAddress = Object.values(os.networkInterfaces())
          .flatMap((entries) => entries ?? [])
          .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address

        const runProfile = (
          profileName: ManagedAgentFileAccess,
          checks: Array<{
            name: string
            action: string
            args: string[]
            expectation: 'allow' | 'deny'
            postcondition?: () => boolean
            unavailable?: boolean
          }>,
        ) => {
          const compiled = compileCodexManagedPermissions(
            enforcement(profileName),
            realWorkDir,
          )
          if (
            process.platform === 'win32' &&
            (windowsSandboxOverride === 'elevated' || windowsSandboxOverride === 'unelevated')
          ) {
            compiled.threadConfig.windows = { sandbox: windowsSandboxOverride }
          }
          const serializedProfile = serializeToml(compiled.threadConfig)
          fs.writeFileSync(path.join(configHome, 'config.toml'), serializedProfile)
          if (keepFixture) {
            fs.writeFileSync(
              path.join(configHome, `config-${profileName}.toml`),
              serializedProfile,
            )
          }
          const profileConfigArgs = process.platform === 'win32'
            ? configOverrideArgs(compiled.threadConfig)
            : []

          const spawnProbe = (action: string, args: string[]) => spawnSync(
            codex.executable,
            [
              ...codex.prefixArgs,
              'sandbox',
              ...profileConfigArgs,
              '-P',
              compiled.profileId,
              '-C',
              realWorkDir,
              '--',
              process.execPath,
              probeRunner,
              action,
              ...args,
            ],
            {
              encoding: 'utf8',
              timeout: 20_000,
              env: {
                ...process.env,
                ...(process.platform === 'win32' ? {} : { CODEX_HOME: configHome }),
                [secretEnvironmentKey]: randomSentinel(),
              },
            },
          )

          const profilePreflight = spawnProbe('read', [insideFile])
          if (profilePreflight.status !== 0) {
            const profileDiagnostic = diagnostic(profilePreflight, fixtureRoot)
              ?? `profile preflight exit=${String(profilePreflight.status)}`
            for (const check of checks) {
              results.push({
                profile: profileName,
                check: check.name,
                status: 'fail',
                diagnostic: profileDiagnostic,
              })
            }
            return
          }

          for (const check of checks) {
            if (check.unavailable) {
              results.push({ profile: profileName, check: check.name, status: 'unavailable' })
              continue
            }
            const child = spawnProbe(check.action, check.args)
            const unavailable = child.status === 77
            const allowed = child.status === 0
            const expected = check.expectation === 'allow' ? allowed : !allowed
            const postcondition = check.postcondition?.() ?? true
            results.push({
              profile: profileName,
              check: check.name,
              status: unavailable ? 'unavailable' : expected && postcondition ? 'pass' : 'fail',
              ...(!expected || !postcondition
                ? { diagnostic: diagnostic(child, fixtureRoot) ?? `exit=${String(child.status)}` }
                : {}),
            })
          }
        }

        const commonDeniedChecks = () => [
          { name: 'outside absolute read', action: 'read', args: [outsideFile], expectation: 'deny' as const },
          { name: 'other visitor absolute read', action: 'read', args: [otherVisitorFile], expectation: 'deny' as const },
          { name: 'other visitor parent traversal read', action: 'read',
            args: [path.relative(realWorkDir, otherVisitorFile)], expectation: 'deny' as const },
          { name: 'other visitor write', action: 'write',
            args: [path.join(otherVisitorDir, 'blocked-write.txt')], expectation: 'deny' as const,
            postcondition: () => !fs.existsSync(path.join(otherVisitorDir, 'blocked-write.txt')) },
          {
            name: 'outside parent traversal read',
            action: 'read',
            args: [path.relative(realWorkDir, outsideFile)],
            expectation: 'deny' as const,
          },
          {
            name: 'outside write',
            action: 'write',
            args: [path.join(outsideDir, 'blocked-write.txt')],
            expectation: 'deny' as const,
            postcondition: () => !fs.existsSync(path.join(outsideDir, 'blocked-write.txt')),
          },
          { name: 'workspace .env read', action: 'read', args: [workspaceEnv], expectation: 'deny' as const },
          { name: 'workspace key read', action: 'read', args: [workspaceKey], expectation: 'deny' as const },
          {
            name: 'Shennian home credential boundary read',
            action: 'read',
            args: [shennianHomeSentinel],
            expectation: 'deny' as const,
            unavailable: !shennianHomeSentinelAvailable,
          },
          {
            name: 'managed runtime file read denied',
            action: 'read',
            args: [managedRuntimeSentinel],
            expectation: 'deny' as const,
            unavailable: !managedRuntimeSentinelAvailable,
          },
          {
            name: 'managed runtime Unix socket connect denied',
            action: 'unix',
            args: [managedRuntimeSocket],
            expectation: 'deny' as const,
            unavailable: !managedRuntimeSocketAvailable,
          },
          {
            name: 'symlink escape read',
            action: 'read',
            args: [symlinkTarget],
            expectation: 'deny' as const,
            unavailable: !symlinkAvailable,
          },
          {
            name: 'hardlink escape creation',
            action: 'link',
            args: [outsideFile, hardlinkTarget],
            expectation: 'deny' as const,
            postcondition: () => !fs.existsSync(hardlinkTarget),
            unavailable: !hardlinkAvailable,
          },
          {
            name: 'temp directory write',
            action: 'write',
            args: [path.join(os.tmpdir(), `${fixturePrefix}${crypto.randomUUID()}`)],
            expectation: 'deny' as const,
          },
          {
            name: 'rename outside workspace',
            action: 'rename',
            args: [path.join(realWorkDir, 'rename-source.txt'), path.join(outsideDir, 'renamed.txt')],
            expectation: 'deny' as const,
            postcondition: () => !fs.existsSync(path.join(outsideDir, 'renamed.txt')),
          },
          { name: 'shell child outside read', action: 'shell-read', args: [outsideFile], expectation: 'deny' as const },
          { name: 'Node child outside read', action: 'node-child-read', args: [outsideFile], expectation: 'deny' as const },
          { name: 'Python child outside read', action: 'python-read', args: [outsideFile], expectation: 'deny' as const },
          { name: 'public command network', action: 'tcp', args: ['example.com', '443'], expectation: 'deny' as const },
          { name: 'loopback command network', action: 'tcp', args: ['127.0.0.1', String(address.port)], expectation: 'deny' as const },
          {
            name: 'LAN command network',
            action: 'tcp',
            args: [localAddress ?? '', String(address.port)],
            expectation: 'deny' as const,
            unavailable: !localAddress,
          },
          { name: 'daemon environment sentinel', action: 'env-absent', args: [secretEnvironmentKey], expectation: 'allow' as const },
        ]

        if (!selectedProfile || selectedProfile === 'workspace-read') {
          fs.writeFileSync(path.join(realWorkDir, 'rename-source.txt'), 'probe')
          runProfile('workspace-read', [
            { name: 'inside workspace read', action: 'read', args: [insideFile], expectation: 'allow' },
            {
              name: 'read-only rejects workspace write',
              action: 'write',
              args: [path.join(realWorkDir, 'blocked-readonly-write.txt')],
              expectation: 'deny',
              postcondition: () => !fs.existsSync(path.join(realWorkDir, 'blocked-readonly-write.txt')),
            },
            ...commonDeniedChecks(),
          ])
        }

        if (!selectedProfile || selectedProfile === 'workspace-write') {
          fs.writeFileSync(path.join(realWorkDir, 'rename-source.txt'), 'probe')
          runProfile('workspace-write', [
            { name: 'inside workspace read', action: 'read', args: [insideFile], expectation: 'allow' },
            {
              name: 'inside create modify rename delete',
              action: 'write-lifecycle',
              args: [
                path.join(realWorkDir, 'write-lifecycle-a.txt'),
                path.join(realWorkDir, 'write-lifecycle-b.txt'),
              ],
              expectation: 'allow',
            },
            ...commonDeniedChecks(),
          ])
        }

        if (!selectedProfile || selectedProfile === 'host-full') {
          const hostFullOutsideWrite = path.join(outsideDir, 'host-full-write.txt')
          runProfile('host-full', [
            { name: 'inside workspace read', action: 'read', args: [insideFile], expectation: 'allow' },
            { name: 'outside read explicitly allowed', action: 'read', args: [outsideFile], expectation: 'allow' },
            {
              name: 'outside write explicitly allowed',
              action: 'write',
              args: [hostFullOutsideWrite],
              expectation: 'allow',
              postcondition: () => fs.existsSync(hostFullOutsideWrite),
            },
            { name: 'workspace .env still denied', action: 'read', args: [workspaceEnv], expectation: 'deny' },
            { name: 'workspace key still denied', action: 'read', args: [workspaceKey], expectation: 'deny' },
            {
              name: 'Shennian home credential boundary still denied',
              action: 'read',
              args: [shennianHomeSentinel],
              expectation: 'deny',
              unavailable: !shennianHomeSentinelAvailable,
            },
            {
              name: 'managed runtime file follows host-full access',
              action: 'read',
              args: [managedRuntimeSentinel],
              expectation: 'allow',
              unavailable: !managedRuntimeSentinelAvailable,
            },
            {
              name: 'managed runtime Unix socket connect still denied',
              action: 'unix',
              args: [managedRuntimeSocket],
              expectation: 'deny',
              unavailable: !managedRuntimeSocketAvailable,
            },
            { name: 'public command network', action: 'tcp', args: ['example.com', '443'], expectation: 'deny' },
            { name: 'loopback command network', action: 'tcp', args: ['127.0.0.1', String(address.port)], expectation: 'deny' },
            {
              name: 'LAN command network',
              action: 'tcp',
              args: [localAddress ?? '', String(address.port)],
              expectation: 'deny',
              unavailable: !localAddress,
            },
            { name: 'daemon environment sentinel', action: 'env-absent', args: [secretEnvironmentKey], expectation: 'allow' },
          ])
        }

        const failedInitializationMarker = path.join(realWorkDir, 'invalid-profile-ran.txt')
        const invalidConfig = {
          default_permissions: 'broken',
          permissions: {
            broken: {
              extends: ':unknown-profile',
              filesystem: { ':root': 'write' },
            },
          },
        }
        fs.writeFileSync(path.join(configHome, 'config.toml'), serializeToml(invalidConfig))
        const invalidConfigArgs = process.platform === 'win32'
          ? configOverrideArgs(invalidConfig)
          : []
        const failedInitialization = spawnSync(
          codex.executable,
          [
            ...codex.prefixArgs,
            'sandbox', ...invalidConfigArgs, '-P', 'broken', '-C', realWorkDir, '--',
            process.execPath, probeRunner, 'write', failedInitializationMarker,
          ],
          {
            encoding: 'utf8',
            timeout: 20_000,
            env: {
              ...process.env,
              ...(process.platform === 'win32' ? {} : { CODEX_HOME: configHome }),
            },
          },
        )
        results.push({
          profile: 'invalid',
          check: 'sandbox initialization fails closed',
          status: failedInitialization.status !== 0 && !fs.existsSync(failedInitializationMarker)
            ? 'pass'
            : 'fail',
          ...(failedInitialization.status === 0 || fs.existsSync(failedInitializationMarker)
            ? { diagnostic: diagnostic(failedInitialization, fixtureRoot) ?? 'invalid profile command ran' }
            : {}),
        })

        const wsl = process.platform === 'win32'
          ? spawnSync('wsl.exe', ['--status'], { encoding: 'utf8', timeout: 10_000 })
          : null
        const report = {
          platform: process.platform,
          arch: process.arch,
          runtimeVersion,
          permissionProfile: CODEX_MANAGED_PERMISSION_PROFILE_ID,
          windowsSandbox: process.platform === 'win32'
            ? windowsSandboxOverride ?? 'elevated'
            : 'not-applicable',
          wsl: process.platform === 'win32'
            ? wsl?.status === 0 ? 'available-not-exercised' : 'unavailable'
            : 'not-applicable',
          results,
          summary: {
            pass: results.filter((entry) => entry.status === 'pass').length,
            fail: results.filter((entry) => entry.status === 'fail').length,
            unavailable: results.filter((entry) => entry.status === 'unavailable').length,
          },
          ...(keepFixture ? { fixtureRoot } : {}),
        }
        const serializedReport = `${JSON.stringify(report, null, 2)}\n`
        if (outputPath) fs.writeFileSync(path.resolve(outputPath), serializedReport)
        else process.stdout.write(serializedReport)
        process.exitCode = report.summary.fail ? 1 : 0
        resolve()
      } catch (error) {
        reject(error)
      } finally {
        listener.close()
        if (managedRuntimeSocketListener.listening) managedRuntimeSocketListener.close()
        if (managedRuntimeSocketAvailable) {
          fs.rmSync(managedRuntimeSocket, { force: true })
        }
        if (managedRuntimeSentinelAvailable) {
          fs.rmSync(managedRuntimeSentinel, { force: true })
        }
        if (managedRuntimeRoot.includes('shennian-managed-room-e2e-')) {
          fs.rmSync(managedRuntimeRoot, { recursive: true, force: true })
        }
        if (shennianHomeSentinelAvailable) {
          fs.rmSync(shennianHomeSentinel, { force: true })
        }
        if (!keepFixture && fixtureRoot.includes(fixturePrefix)) {
          fs.rmSync(fixtureRoot, { recursive: true, force: true })
        }
      }
    })

    if (managedRuntimeSentinelAvailable) {
      managedRuntimeSocketListener.listen(managedRuntimeSocket, () => {
        managedRuntimeSocketAvailable = true
        startNetworkProbe()
      })
    } else {
      startNetworkProbe()
    }
  })
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
