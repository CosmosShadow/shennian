// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/command-spec.test.ts

import { spawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncOptions } from 'node:child_process'
import fs from 'node:fs'
import crypto from 'node:crypto'
import type { BuiltinAgentType } from '@shennian/wire'
import os from 'node:os'
import path from 'node:path'
import { resetWindowsInstallationPaths, windowsLookupPath, windowsCodexDesktopCandidates } from './windows-agent-paths.js'
import { wrapCommandWithMacosFileSandbox, type MacosFileSandboxSpec } from '../security/macos-file-sandbox.js'

export type CommandSpec = {
  command: string
  args: string[]
  display: string
}

export type ResolvedCommandKind = 'native' | 'cmd-shim' | 'wsl-bridge'

export type ResolvedCommandSpec = CommandSpec & {
  kind: ResolvedCommandKind
  path: string
}

type LaunchSpec = {
  command: string
  args: string[]
  cwd?: string
}

type CommandInvocationKind = 'direct' | 'cmd-shim'

type CommandInvocation = {
  kind: CommandInvocationKind
  path: string
}

const BUILTIN_COMMANDS: Record<BuiltinAgentType, CommandSpec[]> = {
  shennian: [], // In-process SDK, never resolve a third-party executable.
  claude: [
    { command: 'claude', args: [], display: 'claude' },
  ],
  codex: [
    { command: 'codex', args: [], display: 'codex' },
  ],
  workbuddy: [
    { command: 'codebuddy', args: [], display: 'WorkBuddy' },
  ],
  gemini: [
    { command: 'gemini', args: [], display: 'gemini' },
  ],
  cursor: [
    { command: 'agent', args: [], display: 'agent' },
    { command: 'cursor', args: ['agent'], display: 'cursor agent' },
  ],
  // OpenClaw support is intentionally disabled.
  openclaw: [],
  opencode: [
    { command: 'opencode', args: [], display: 'opencode' },
  ],
  pi: [
    { command: 'shennian', args: [], display: 'shennian' },
  ],
  'pi-coding-agent': [
    { command: 'pi', args: [], display: 'pi' },
  ],
  manager: [
    { command: 'shennian', args: ['manager'], display: 'shennian manager' },
  ],
}

const availabilityCache = new Map<string, boolean>()
const resolvedCache = new Map<BuiltinAgentType, ResolvedCommandSpec | null>()
const pathLookupCache = new Map<string, string[]>()
const wslAvailabilityCache = new Map<string, boolean>()

export function resetCommandSpecCache(): void {
  resetWindowsInstallationPaths()
  availabilityCache.clear()
  resolvedCache.clear()
  pathLookupCache.clear()
  wslAvailabilityCache.clear()
}

export function getProcessPlatform(): NodeJS.Platform {
  return process.platform
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function getFallbackCommandCandidates(command: string): string[] {
  if (path.basename(command) !== command) return [command]

  const home = os.homedir()
  if (getProcessPlatform() === 'win32') {
    const winPath = path.win32
    const names = path.extname(command)
      ? [command]
      : [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
    const appData = process.env.APPDATA || winPath.join(home, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || winPath.join(home, 'AppData', 'Local')
    const dirs = [
      winPath.join(home, '.shennian', 'node'),
      winPath.join('C:\\', 'nvm4w', 'nodejs'),
      winPath.join(localAppData, 'npm-global'),
      winPath.join(appData, 'npm'),
      winPath.join(localAppData, 'pnpm'),
      winPath.join(home, 'scoop', 'shims'),
      winPath.join('C:\\', 'Program Files', 'nodejs'),
    ]
    const candidates = dirs.flatMap((dir) => names.map((name) => winPath.join(dir, name)))
    if (command === 'codebuddy') {
      const workBuddyRoots = [
        winPath.join(localAppData, 'Programs', 'WorkBuddy'),
        winPath.join(localAppData, 'WorkBuddy'),
        winPath.join('C:\\', 'Program Files', 'WorkBuddy'),
      ]
      for (const root of workBuddyRoots) {
        for (const name of ['codebuddy.exe', 'codebuddy.cmd', 'codebuddy']) {
          candidates.push(winPath.join(root, 'resources', 'app.asar.unpacked', 'cli', 'bin', name))
        }
      }
    }
    return candidates
  }

  const dirs = [
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
  const candidates = dirs.map((dir) => path.join(dir, command))
  if (command === 'claude' && getProcessPlatform() === 'darwin') {
    candidates.push(...getClaudeDesktopCommandCandidates(home))
  }
  if (command === 'codebuddy' && getProcessPlatform() === 'darwin') {
    candidates.push(
      '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
      path.join(home, 'Applications', 'WorkBuddy.app', 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
    )
  }
  return candidates
}

/** Only candidate locations; a Desktop GUI executable must never be treated as a CLI. */
export function getCodexDesktopCommandCandidates(
  platform: NodeJS.Platform = getProcessPlatform(),
  home: string = os.homedir(),
): string[] {
  if (platform === 'win32') return windowsCodexDesktopCandidates(home)
  if (platform !== 'darwin') return []
  return ['/Applications', path.join(home, 'Applications')].flatMap((root) =>
    ['ChatGPT.app', 'Codex.app'].flatMap((app) => [
      path.join(root, app, 'Contents', 'Resources', 'codex'),
      path.join(root, app, 'Contents', 'Resources', 'codex-cli', 'CodexCLI.app', 'Contents', 'MacOS', 'codex'),
    ]),
  )
}

function getClaudeDesktopCommandCandidates(home: string): string[] {
  const roots = [
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code'),
  ]
  const candidates: string[] = []
  for (const root of roots) {
    let versions: string[]
    try {
      versions = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    } catch {
      continue
    }
    for (const version of versions) {
      candidates.push(path.join(root, version, 'claude.app', 'Contents', 'MacOS', 'claude'))
    }
  }
  return candidates
}

function buildFallbackPathEnv(currentPath?: string, command?: string): string {
  const parts = currentPath?.split(path.delimiter).filter(Boolean) ?? []
  if (getProcessPlatform() === 'win32') {
    if (command && path.basename(command) !== command) {
      const commandDir = path.win32.dirname(command)
      if (!parts.includes(commandDir)) parts.unshift(commandDir)
    }
    for (const candidate of getFallbackCommandCandidates('shennian')) {
      const dir = path.win32.dirname(candidate)
      if (!parts.includes(dir)) parts.push(dir)
    }
    return parts.join(path.delimiter)
  }
  if (command && path.basename(command) !== command) {
    const commandDir = path.dirname(command)
    if (!parts.includes(commandDir)) parts.unshift(commandDir)
  }
  for (const candidate of getFallbackCommandCandidates('shennian')) {
    const dir = path.dirname(candidate)
    if (!parts.includes(dir)) parts.push(dir)
  }
  return parts.join(path.delimiter)
}

function lookupCommandPaths(command: string): string[] {
  if (pathLookupCache.has(command)) {
    return pathLookupCache.get(command) ?? []
  }

  const isWindows = getProcessPlatform() === 'win32'
  const lookup = isWindows ? 'where' : 'which'
  const result = spawnSync(lookup, [command], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3000,
    windowsHide: true,
    env: {
      ...process.env,
      PATH: isWindows ? windowsLookupPath() : buildFallbackPathEnv(process.env.PATH, command),
    },
  })
  const paths = result.status === 0 ? splitLines(result.stdout ?? '') : []
  const withFallbacks = [...paths]
  for (const candidate of getFallbackCommandCandidates(command)) {
    if (fs.existsSync(candidate) && !withFallbacks.includes(candidate)) withFallbacks.push(candidate)
  }
  pathLookupCache.set(command, withFallbacks)
  return withFallbacks
}

function getWindowsShellPath(): string {
  return process.env.ComSpec || 'cmd.exe'
}

function isWindowsNativeBinary(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.exe' || ext === '.com'
}

function isWindowsCmdShim(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.cmd' || ext === '.bat'
}

function isWindowsNodeScript(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.js' || ext === '.mjs' || ext === '.cjs'
}

function resolveWindowsNodeCommand(): string {
  return lookupCommandPaths('node.exe')[0] ?? lookupCommandPaths('node')[0] ?? 'node'
}

function quoteCmdArg(text: string): string {
  return `"${text.replace(/"/g, '""')}"`
}

function quotePosixArg(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

export function windowsPathToWsl(input: string): string | undefined {
  if (!input) return undefined
  const normalized = input.replace(/\//g, '\\')
  const driveMatch = normalized.match(/^([A-Za-z]):\\(.*)$/)
  if (driveMatch) {
    const [, drive, rest] = driveMatch
    const suffix = rest.replace(/\\/g, '/')
    return `/mnt/${drive.toLowerCase()}/${suffix}`
  }
  if (normalized.startsWith('\\\\wsl$\\')) {
    const remainder = normalized.replace(/^\\\\wsl\$\\[^\\]+\\?/, '')
    return `/${remainder.replace(/\\/g, '/')}`
  }
  if (input.startsWith('/')) return input
  return undefined
}

function resolveArbitraryWindowsCommand(command: string): CommandInvocation {
  const normalized = command.trim()
  if (!normalized) {
    throw new Error('Command string is empty')
  }

  const hasExplicitPath = /[\\/]/.test(normalized) || /^[A-Za-z]:/.test(normalized)
  if (hasExplicitPath) {
    if (isWindowsCmdShim(normalized)) return { kind: 'cmd-shim', path: normalized }
    return { kind: 'direct', path: normalized }
  }

  const paths = lookupCommandPaths(normalized)
  const native = paths.find(isWindowsNativeBinary)
  if (native) return { kind: 'direct', path: native }

  const shim = paths.find(isWindowsCmdShim)
  if (shim) return { kind: 'cmd-shim', path: shim }

  return { kind: 'direct', path: normalized }
}

function canUseWslBridge(command: string): boolean {
  if (wslAvailabilityCache.has(command)) {
    return wslAvailabilityCache.get(command) ?? false
  }

  const wslPath = lookupCommandPaths('wsl.exe')[0] ?? lookupCommandPaths('wsl')[0]
  if (!wslPath) {
    wslAvailabilityCache.set(command, false)
    return false
  }

  const result = spawnSync(wslPath, ['-e', 'sh', '-lc', `command -v ${quotePosixArg(command)} >/dev/null 2>&1`], {
    stdio: 'ignore',
    timeout: 5000,
    windowsHide: true,
  })
  const ok = result.status === 0
  wslAvailabilityCache.set(command, ok)
  return ok
}

export function commandExists(command: string): boolean {
  if (availabilityCache.has(command)) {
    return availabilityCache.get(command) ?? false
  }

  const exists = lookupCommandPaths(command).length > 0 || (getProcessPlatform() === 'win32' && canUseWslBridge(command))
  availabilityCache.set(command, exists)
  return exists
}

/** Stable, non-secret identity used to invalidate local capability caches. */
export function resolveCommandFileIdentity(command: string): { pathHash: string; fingerprint: string } | null {
  const resolved = lookupCommandPaths(command)[0]
  if (!resolved) return null
  try {
    const realPath = fs.realpathSync(resolved)
    const stat = fs.statSync(realPath, { bigint: true })
    const pathHash = crypto.createHash('sha256').update(realPath).digest('hex')
    const fingerprint = crypto.createHash('sha256')
      .update(`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`)
      .digest('hex')
    return { pathHash, fingerprint }
  } catch {
    return null
  }
}

export function resolveCommandFilePath(command: string): string | null {
  return lookupCommandPaths(command)[0] ?? null
}

function resolveWindowsBuiltinCommand(candidate: CommandSpec): ResolvedCommandSpec | null {
  const paths = lookupCommandPaths(candidate.command)
  if (candidate.command === 'codex') {
    const override = process.env.SHENNIAN_CODEX_PATH?.trim()
    const candidates = override ? [override] : [...paths, ...getCodexDesktopCommandCandidates()]
    for (const commandPath of candidates) {
      if (override && !path.win32.isAbsolute(commandPath)) return null
      const kind = isWindowsNativeBinary(commandPath) ? 'native' : isWindowsCmdShim(commandPath) ? 'cmd-shim' : null
      if (!kind) continue
      const spec = { ...candidate, kind, path: commandPath } as ResolvedCommandSpec
      if (getBuiltinAgentVersion('codex', spec)) return spec
    }
    // Windows and WSL have different homes/auth/history. Never migrate an
    // existing Codex queue to WSL just because a Windows PATH entry disappeared.
    return null
  }
  const native = paths.find(isWindowsNativeBinary)
  if (native) {
    return { ...candidate, kind: 'native', path: native }
  }

  const shim = paths.find(isWindowsCmdShim)
  if (shim) {
    return { ...candidate, kind: 'cmd-shim', path: shim }
  }

  if (canUseWslBridge(candidate.command)) {
    const wslPath = lookupCommandPaths('wsl.exe')[0] ?? lookupCommandPaths('wsl')[0]
    if (wslPath) {
      return { ...candidate, kind: 'wsl-bridge', path: wslPath }
    }
  }

  return null
}

export function resolveBuiltinCommand(type: BuiltinAgentType): ResolvedCommandSpec | null {
  if (resolvedCache.has(type)) {
    return resolvedCache.get(type) ?? null
  }

  const desktop = type === 'codex' && getProcessPlatform() === 'darwin'
    ? getCodexDesktopCommandCandidates().find((candidate) => {
        if (!fs.existsSync(candidate)) return false
        return Boolean(getBuiltinAgentVersion('codex', {
          command: candidate, args: [], display: 'Codex Desktop', kind: 'native', path: candidate,
        }))
      })
    : undefined
  const resolved = desktop
    ? { ...BUILTIN_COMMANDS.codex[0]!, kind: 'native' as const, path: desktop }
    : BUILTIN_COMMANDS[type]
    .map((candidate) => {
      if (getProcessPlatform() === 'win32') {
        return resolveWindowsBuiltinCommand(candidate)
      }
      const commandPath = lookupCommandPaths(candidate.command)[0]
      return commandPath ? { ...candidate, kind: 'native' as const, path: commandPath } : null
    })
    .find(Boolean) ?? null
  resolvedCache.set(type, resolved)
  return resolved
}

export function buildLaunchSpec(
  spec: ResolvedCommandSpec,
  runtimeArgs: string[],
  cwd?: string,
): LaunchSpec {
  if (spec.kind === 'native') {
    if (getProcessPlatform() === 'win32' && isWindowsNodeScript(spec.path)) {
      return {
        command: resolveWindowsNodeCommand(),
        args: [spec.path, ...spec.args, ...runtimeArgs],
        cwd,
      }
    }
    return {
      command: spec.path,
      args: [...spec.args, ...runtimeArgs],
      cwd,
    }
  }

  if (spec.kind === 'cmd-shim') {
    const commandLine = [spec.path, ...spec.args, ...runtimeArgs].map(quoteCmdArg).join(' ')
    return {
      command: getWindowsShellPath(),
      args: ['/d', '/s', '/c', `"${commandLine}"`],
      cwd,
    }
  }

  const wslCwd = cwd ? windowsPathToWsl(cwd) : undefined
  if (cwd && !wslCwd) {
    throw new Error(`Cannot map Windows path to WSL workDir: ${cwd}`)
  }
  const shellCommand = [
    wslCwd ? `cd ${quotePosixArg(wslCwd)}` : '',
    `exec ${[spec.command, ...spec.args, ...runtimeArgs].map(quotePosixArg).join(' ')}`,
  ].filter(Boolean).join(' && ')
  return {
    command: spec.path,
    args: ['-e', 'sh', '-lc', shellCommand],
    cwd: undefined,
  }
}

export function spawnResolvedCommand(
  spec: ResolvedCommandSpec,
  runtimeArgs: string[],
  options: Omit<SpawnOptions, 'cwd'> & { cwd?: string; macosFileSandbox?: MacosFileSandboxSpec } = {},
): ChildProcess {
  const { macosFileSandbox, ...spawnOptions } = options
  const launch = buildLaunchSpec(spec, runtimeArgs, spawnOptions.cwd)
  // Only a native binary launch can be wrapped this way; cmd-shim and the WSL
  // bridge are Windows-only paths where this macOS-specific spec never applies.
  const wrapped = macosFileSandbox && spec.kind === 'native'
    ? wrapCommandWithMacosFileSandbox(launch.command, launch.args, macosFileSandbox)
    : launch
  return spawn(wrapped.command, wrapped.args, {
    ...spawnOptions,
    cwd: launch.cwd,
    windowsHide: spawnOptions.windowsHide ?? true,
    ...(getProcessPlatform() === 'win32' && spec.kind === 'cmd-shim'
      ? { windowsVerbatimArguments: true }
      : {}),
  })
}

export function spawnAgentCommand(
  spec: ResolvedCommandSpec,
  runtimeArgs: string[],
  options: Omit<SpawnOptions, 'cwd'> & { cwd?: string; macosFileSandbox?: MacosFileSandboxSpec } = {},
): ChildProcess {
  return spawnResolvedCommand(spec, runtimeArgs, options)
}

export function spawnResolvedCommandSync(
  spec: ResolvedCommandSpec,
  runtimeArgs: string[],
  options: Omit<SpawnSyncOptions, 'cwd'> & { cwd?: string } = {},
) {
  const launch = buildLaunchSpec(spec, runtimeArgs, options.cwd)
  return spawnSync(launch.command, launch.args, {
    ...options,
    cwd: launch.cwd,
    windowsHide: options.windowsHide ?? true,
    ...(getProcessPlatform() === 'win32' && spec.kind === 'cmd-shim'
      ? { windowsVerbatimArguments: true }
      : {}),
  })
}

export function parseCommandString(command: string): string[] {
  const args: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false

  for (const ch of command) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) { args.push(current); current = '' }
      continue
    }
    current += ch
  }
  if (current) args.push(current)
  return args
}

export function buildCommandStringLaunchSpec(
  commandString: string,
  runtimeArgs: string[],
  cwd?: string,
): LaunchSpec {
  const parts = parseCommandString(commandString)
  const bin = parts[0]
  if (!bin) {
    throw new Error('Command string is empty')
  }
  const baseArgs = parts.slice(1)

  if (getProcessPlatform() !== 'win32') {
    return {
      command: bin,
      args: [...baseArgs, ...runtimeArgs],
      cwd,
    }
  }

  const invocation = resolveArbitraryWindowsCommand(bin)
  if (invocation.kind === 'cmd-shim') {
    return {
      command: getWindowsShellPath(),
      args: ['/d', '/s', '/c', `"${[invocation.path, ...baseArgs, ...runtimeArgs].map(quoteCmdArg).join(' ')}"`],
      cwd,
    }
  }

  if (isWindowsNodeScript(invocation.path)) {
    return {
      command: resolveWindowsNodeCommand(),
      args: [invocation.path, ...baseArgs, ...runtimeArgs],
      cwd,
    }
  }

  return {
    command: invocation.path,
    args: [...baseArgs, ...runtimeArgs],
    cwd,
  }
}

export function spawnCommandString(
  commandString: string,
  runtimeArgs: string[],
  options: Omit<SpawnOptions, 'cwd'> & { cwd?: string } = {},
): ChildProcess {
  const launch = buildCommandStringLaunchSpec(commandString, runtimeArgs, options.cwd)
  const parts = parseCommandString(commandString)
  const invocation =
    getProcessPlatform() === 'win32' && parts[0]
      ? resolveArbitraryWindowsCommand(parts[0])
      : null
  return spawn(launch.command, launch.args, {
    ...options,
    cwd: launch.cwd,
    windowsHide: options.windowsHide ?? true,
    env: {
      ...options.env,
      PATH: buildFallbackPathEnv(options.env?.PATH ?? process.env.PATH, parts[0]),
    },
    ...(getProcessPlatform() === 'win32' && invocation?.kind === 'cmd-shim'
      ? { windowsVerbatimArguments: true }
      : {}),
  })
}

export function getCommandVersion(spec: ResolvedCommandSpec, flag = '--version'): string | undefined {
  const result = spawnResolvedCommandSync(spec, [flag], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  })
  if (result.status !== 0) return undefined
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  const match = text.match(/\d+\.\d+[\w.-]*/)
  return match?.[0]
}

/**
 * Cursor's launcher can survive an in-place update while continuing to report
 * the previous build from `--version`. Its `about` command reports the build
 * that is actually executing, which is the identity the managed-security
 * allowlist must bind to. Do not fall back to the stale value when `about`
 * cannot be verified: an unknown build must resolve as unverified.
 */
export function getBuiltinAgentVersion(
  agentType: BuiltinAgentType,
  spec: ResolvedCommandSpec,
): string | undefined {
  if (agentType === 'codex' || agentType === 'claude') {
    const result = spawnResolvedCommandSync(spec, ['--version'], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    })
    if (result.status !== 0) return undefined
    const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '')
    // A same-named desktop launcher is not a callable coding tool.
    const match = agentType === 'codex'
      ? text.match(/^\s*codex-cli\s+(\d+\.\d+\.\d+[\w.-]*)\s*$/im)
      : text.match(/^\s*(\d+\.\d+\.\d+[\w.-]*)\s+\(Claude Code\)\s*$/im)
    return match?.[1]
  }
  if (agentType !== 'cursor') return getCommandVersion(spec)

  const result = spawnResolvedCommandSync(spec, ['about'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  })
  if (result.status !== 0) return undefined
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const match = text.match(/^\s*CLI Version\s+(\d+\.\d+(?:\.\d+)?[\w.-]*)\s*$/im)
  return match?.[1]
}
