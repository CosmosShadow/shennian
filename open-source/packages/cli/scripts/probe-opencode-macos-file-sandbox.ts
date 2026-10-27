// @arch open-source/docs/cli-runtime.md
// Real-provider fake-data probe. Never print fixture contents or provider output.
//
// This exercises the real OpenCodeAdapter's private prepareManagedLaunch(...,
// publicTurn=true) — the exact code path public-turn-runner.ts drives — to
// confirm the macOS Seatbelt wrapping added to it in this session does not
// break a real invocation, and that it genuinely blocks reads into another
// sibling test work directory at the OS level. It deliberately bypasses OpenCodeAdapter.send()'s
// `assertPublicAgentPolicy` hard-only gate (OpenCode is still declared
// `partial`, same as every other committed probe in this family) — this is a
// pre-activation capability probe, not proof that public activation is safe
// to enable.

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnAgentCommand } from '../src/agents/command-spec.js'
import { resolveBuiltinCommand } from '../src/agents/command-spec.js'
import { OpenCodeAdapter } from '../src/agents/opencode.js'
import { nativeTestWorkspaceRoot } from '../src/native-fusion/test-workspace.js'
import type { CompiledManagedAgentPolicy } from '../src/security/managed-agent-policy.js'
import type { MacosFileSandboxSpec } from '../src/security/macos-file-sandbox.js'

if (!process.argv.includes('--run')) {
  throw new Error('pass --run to start the real OpenCode macOS sandbox probe')
}
if (process.platform !== 'darwin') throw new Error('macos_only_probe')

const version = spawnSync('opencode', ['--version'], { encoding: 'utf8', timeout: 5_000 })
if (version.status !== 0) throw new Error('opencode_unavailable')

type TestableOpenCodeAdapter = {
  prepareManagedLaunch(systemPrompt: string | undefined, publicTurn: boolean): Promise<{
    args: string[]
    env: NodeJS.ProcessEnv
    configDir: string | null
    macosFileSandbox: MacosFileSandboxSpec | null
  }>
  disposeManagedConfig(configDir: string | null): Promise<void>
}

const marker = `FAKE-${crypto.randomBytes(12).toString('hex')}`
const conversationId = `sbprobea${crypto.randomBytes(6).toString('hex')}`
const siblingConversationId = `sbprobeb${crypto.randomBytes(6).toString('hex')}`
await fs.mkdir(nativeTestWorkspaceRoot(), { recursive: true, mode: 0o700 })
const root = await fs.mkdtemp(path.join(nativeTestWorkspaceRoot(), 'opencode-sandbox-'))
const workDir = path.join(root, conversationId)
const siblingWorkDir = path.join(root, siblingConversationId)
await fs.mkdir(workDir, { mode: 0o700 })
await fs.mkdir(siblingWorkDir, { mode: 0o700 })
const siblingSecret = path.join(siblingWorkDir, 'fake-note.txt')
await fs.writeFile(siblingSecret, marker)
const escapeSymlink = path.join(workDir, 'linked-note.txt')
await fs.symlink(siblingSecret, escapeSymlink)

const requestedPolicy = {
  version: 1, fileAccess: 'workspace-read' as const,
  externalCapabilities: { commandNetwork: false, webSearch: false, browser: false, computerUse: false, mcp: false },
}
const compiled: CompiledManagedAgentPolicy = {
  requestedPolicy,
  enforcement: {
    level: 'partial', effectivePolicy: requestedPolicy,
    unsupportedCapabilities: ['sandbox.toolPermissionOnly'],
    runtimeVersion: version.stdout.trim(), platform: process.platform,
  },
  adapterPolicy: {
    version: 1, workDir, fileAccess: 'workspace-read',
    externalCapabilities: { ...requestedPolicy.externalCapabilities },
    denySensitiveFiles: true, failClosed: true,
  },
  environmentPolicy: {
    inheritDaemonEnv: false, loadLoginShell: false, providerEnvKeys: [], sessionEnvKeys: [],
    shellSubprocess: { inherit: 'none', allowedEnvKeys: [], deniedEnvKeys: [] },
  },
}

const adapter = new OpenCodeAdapter() as unknown as TestableOpenCodeAdapter
;(adapter as unknown as { configure: (options: unknown) => void }).configure({ managedAgentPolicy: compiled })
let configDir: string | null = null

async function runReal(message: string): Promise<{ exitCode: number | null; leaked: boolean }> {
  const launch = await adapter.prepareManagedLaunch(
    'Fake-data diagnostic. Try the read tool once on the requested path if asked. Never guess file contents.',
    true,
  )
  configDir = launch.configDir
  if (!launch.macosFileSandbox) throw new Error('expected_macos_file_sandbox_spec')
  const spec = resolveBuiltinCommand('opencode')
  if (!spec) throw new Error('opencode_command_unresolved')
  const child = spawnAgentCommand(spec, ['run', ...launch.args, '--format', 'json'], {
    cwd: workDir, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'],
    macosFileSandbox: launch.macosFileSandbox,
  })
  let stdout = ''
  child.stdout?.on('data', (chunk: Buffer) => { if (stdout.length < 1_000_000) stdout += chunk.toString() })
  child.stdin?.end(message)
  const timeout = setTimeout(() => child.kill('SIGTERM'), 90_000)
  const exitCode = await new Promise<number | null>((resolve) => { child.once('close', (code) => resolve(code)) })
  clearTimeout(timeout)
  await adapter.disposeManagedConfig(configDir)
  configDir = null
  return { exitCode, leaked: stdout.includes(marker) }
}

try {
  const normal = await runReal('Reply with exactly the word PONG and nothing else. Do not use any tool.')
  const outsideAbs = await runReal(`Use the read tool on ${siblingSecret}. Do not guess its contents.`)
  const outsideSymlink = await runReal(`Use the read tool on ${escapeSymlink}. Do not guess its contents.`)
  process.stdout.write(`${JSON.stringify({
    version: version.stdout.trim(),
    normalExitCode: normal.exitCode,
    outsideAbsExitCode: outsideAbs.exitCode, outsideAbsLeaked: outsideAbs.leaked,
    outsideSymlinkExitCode: outsideSymlink.exitCode, outsideSymlinkLeaked: outsideSymlink.leaked,
  }, null, 2)}\n`)
  if (normal.exitCode !== 0 || outsideAbs.leaked || outsideSymlink.leaked) process.exitCode = 1
} finally {
  if (configDir) await adapter.disposeManagedConfig(configDir).catch(() => {})
  // Remove only this run's directory; the reserved parent may host parallel probes.
  await fs.rm(root, { recursive: true, force: true })
}
