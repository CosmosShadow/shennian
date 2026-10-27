// @arch open-source/docs/cli-runtime.md
// @covers src/agents/pi-managed-extension.ts

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writePiManagedExtension } from '../agents/pi-managed-extension.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'

type GeneratedTool = {
  execute(
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: Array<{ type: string; text: string }> }>
}

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function policy(workDir: string, fileAccess: 'workspace-read' | 'workspace-write' | 'host-full') {
  const permissionPolicy = {
    version: 1,
    fileAccess,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  } as const
  return {
    requestedPolicy: permissionPolicy,
    enforcement: {
      level: 'partial',
      effectivePolicy: permissionPolicy,
      unsupportedCapabilities: ['runtime.hardIsolation'],
      runtimeVersion: '0.85.1',
      platform: process.platform,
    },
    adapterPolicy: {
      version: 1,
      workDir,
      fileAccess,
      externalCapabilities: { ...permissionPolicy.externalCapabilities },
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: [],
      sessionEnvKeys: [],
      shellSubprocess: { inherit: 'none', allowedEnvKeys: [], deniedEnvKeys: [] },
    },
  } satisfies CompiledManagedAgentPolicy
}

function createHarness(options: {
  fileAccess?: 'workspace-read' | 'workspace-write' | 'host-full'
  allowRoomControl?: boolean
  allowManagerControl?: boolean
  allowHostShell?: boolean
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-pi-extension-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  const outside = path.join(root, 'outside')
  fs.mkdirSync(workspace)
  fs.mkdirSync(outside)
  const outputPath = path.join(root, 'private', 'managed-extension.ts')
  writePiManagedExtension({
    outputPath,
    policy: policy(workspace, options.fileAccess ?? 'workspace-write'),
    allowRoomControl: options.allowRoomControl ?? true,
    allowManagerControl: options.allowManagerControl ?? false,
    allowHostShell: options.allowHostShell ?? false,
  })

  const registered = new Map<string, GeneratedTool>()
  const spawn = vi.fn((_command: string, _args: string[], _options: Record<string, unknown>) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    queueMicrotask(() => child.emit('close', 0))
    return child
  })
  const Type = {
    Object: (value: unknown) => value,
    String: () => ({}),
    Number: () => ({}),
    Optional: (value: unknown) => value,
  }
  const executableSource = fs.readFileSync(outputPath, 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export default function (pi)', 'return function (pi)')
  const register = new Function('fs', 'path', 'spawn', 'Type', executableSource)(
    fs,
    path,
    spawn,
    Type,
  ) as (pi: { registerTool(tool: GeneratedTool & { name: string }): void }) => void
  register({ registerTool: (tool) => registered.set(tool.name, tool) })
  return { root, workspace, outside, outputPath, registered, spawn }
}

function tool(harness: ReturnType<typeof createHarness>, name: string): GeneratedTool {
  const value = harness.registered.get(name)
  if (!value) throw new Error(`Generated tool not registered: ${name}`)
  return value
}

describe('writePiManagedExtension', () => {
  it('generates a private partial-protection extension without embedding capabilities', () => {
    const harness = createHarness({ allowRoomControl: true, allowManagerControl: false })
    const source = fs.readFileSync(harness.outputPath, 'utf8')
    expect(source).toContain("pi.registerTool({ name: 'read'")
    expect(source).toContain('managed_path_outside_workspace')
    expect(source).toContain('managed_path_link_rejected')
    expect(source).toContain('const ALLOW_ROOM = true')
    expect(source).toContain('const ALLOW_MANAGER = false')
    expect(source).toContain('const ALLOW_HOST_SHELL = false')
    expect(source).not.toContain('SHENNIAN_MANAGED_ROOM_CONTEXT')
  })

  it('rejects absolute paths and parent traversal outside the workspace', async () => {
    const harness = createHarness()
    const outsideFile = path.join(harness.outside, 'secret.txt')
    fs.writeFileSync(outsideFile, 'secret')

    await expect(tool(harness, 'read').execute('1', { path: outsideFile }))
      .rejects.toThrow('managed_path_outside_workspace')
    await expect(tool(harness, 'read').execute('2', { path: '../outside/secret.txt' }))
      .rejects.toThrow('managed_path_outside_workspace')
    await expect(tool(harness, 'write').execute('3', { path: outsideFile, content: 'changed' }))
      .rejects.toThrow('managed_path_outside_workspace')
    await expect(tool(harness, 'write').execute('4', { path: '../outside/new.txt', content: 'new' }))
      .rejects.toThrow('managed_path_outside_workspace')
  })

  it('rejects an external symlink or Windows junction', async () => {
    const harness = createHarness()
    fs.writeFileSync(path.join(harness.outside, 'secret.txt'), 'secret')
    const link = path.join(harness.workspace, 'external-link')
    fs.symlinkSync(harness.outside, link, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(tool(harness, 'read').execute('1', { path: path.join(link, 'secret.txt') }))
      .rejects.toThrow('managed_path_outside_workspace')
    await expect(tool(harness, 'write').execute('2', { path: path.join(link, 'new.txt'), content: 'new' }))
      .rejects.toThrow('managed_path_outside_workspace')
  })

  it('rejects hard-linked files for read, edit, write, find and grep', async () => {
    const harness = createHarness()
    const outsideFile = path.join(harness.outside, 'secret.txt')
    const linkedFile = path.join(harness.workspace, 'linked-secret.txt')
    fs.writeFileSync(outsideFile, 'secret marker')
    fs.linkSync(outsideFile, linkedFile)

    await expect(tool(harness, 'read').execute('1', { path: linkedFile }))
      .rejects.toThrow('managed_path_link_rejected')
    await expect(tool(harness, 'write').execute('2', { path: linkedFile, content: 'changed' }))
      .rejects.toThrow('managed_path_link_rejected')
    await expect(tool(harness, 'edit').execute('3', {
      path: linkedFile,
      oldText: 'secret',
      newText: 'changed',
    })).rejects.toThrow('managed_path_link_rejected')
    const found = await tool(harness, 'find').execute('4', { path: '.', pattern: 'linked-secret' })
    const grepped = await tool(harness, 'grep').execute('5', { path: '.', pattern: 'marker' })
    expect(found.content[0]?.text).toBe('')
    expect(grepped.content[0]?.text).toBe('')
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('secret marker')
  })

  it('blocks .env variants and Shennian credential directories case-insensitively', async () => {
    const harness = createHarness()
    fs.writeFileSync(path.join(harness.workspace, '.env'), 'SECRET=one')
    fs.writeFileSync(path.join(harness.workspace, '.ENV.local'), 'SECRET=two')
    const credentials = path.join(harness.workspace, '.SHENNIAN')
    fs.mkdirSync(credentials)
    fs.writeFileSync(path.join(credentials, 'config.json'), 'secret')

    for (const sensitivePath of ['.env', '.ENV.local', '.SHENNIAN/config.json']) {
      await expect(tool(harness, 'read').execute('read', { path: sensitivePath }))
        .rejects.toThrow('managed_path_sensitive')
      await expect(tool(harness, 'write').execute('write', { path: sensitivePath, content: 'x' }))
        .rejects.toThrow('managed_path_sensitive')
    }
    const listed = await tool(harness, 'ls').execute('ls', { path: '.' })
    expect(listed.content[0]?.text).not.toMatch(/\.env|\.shennian/i)
  })

  it('enforces workspace-read for both write and edit', async () => {
    const harness = createHarness({ fileAccess: 'workspace-read' })
    fs.writeFileSync(path.join(harness.workspace, 'file.txt'), 'before')

    await expect(tool(harness, 'write').execute('1', { path: 'new.txt', content: 'new' }))
      .rejects.toThrow('managed_workspace_read_only')
    await expect(tool(harness, 'edit').execute('2', {
      path: 'file.txt',
      oldText: 'before',
      newText: 'after',
    })).rejects.toThrow('managed_workspace_read_only')
    expect(fs.readFileSync(path.join(harness.workspace, 'file.txt'), 'utf8')).toBe('before')
  })

  it('rejects shell syntax and non-allowlisted Shennian commands before spawn', async () => {
    const harness = createHarness({ allowRoomControl: true, allowManagerControl: false })
    const bash = tool(harness, 'bash')
    for (const command of [
      'shennian room read; cat /etc/passwd',
      'shennian room read && whoami',
      'shennian room read | tee stolen',
      'shennian room read > stolen',
      'shennian room read $(whoami)',
      'shennian room read `whoami`',
    ]) {
      await expect(bash.execute('meta', { command })).rejects.toThrow('managed_shell_syntax_rejected')
    }
    for (const command of [
      'cat /etc/passwd',
      'shennian room list',
      'shennian room create --name stolen',
      'shennian manager sessions list',
    ]) {
      await expect(bash.execute('command', { command })).rejects.toThrow('managed_shell_command_rejected')
    }
    expect(harness.spawn).not.toHaveBeenCalled()
  })

  it('allows only the scoped Room and Manager command families without a shell', async () => {
    const harness = createHarness({ allowRoomControl: true, allowManagerControl: true })
    const bash = tool(harness, 'bash')
    for (const command of [
      'shennian room status',
      'shennian room attachment get ratt_test',
      'shennian manager sessions list --json',
      'shennian manager sessions queue delete --session-id s --message-id m',
      'shennian manager memory path',
    ]) {
      await expect(bash.execute('allowed', { command })).resolves.toBeDefined()
    }
    expect(harness.spawn).toHaveBeenCalledTimes(5)
    for (const call of harness.spawn.mock.calls) {
      expect(call[0]).toBe('shennian')
      expect(call[2]).toMatchObject({ shell: false, cwd: fs.realpathSync(harness.workspace) })
    }
  })

  it('keeps host-full as explicitly unrestricted shell access rather than claiming network isolation', async () => {
    const harness = createHarness({ fileAccess: 'host-full', allowHostShell: true })
    await expect(tool(harness, 'bash').execute('host', { command: 'curl https://example.test' }))
      .resolves.toBeDefined()
    const [command, args, options] = harness.spawn.mock.calls[0]!
    expect(command).toBe('curl https://example.test')
    expect(args).toEqual([])
    expect(options.shell).toBe(true)
    expect(options.cwd).toBe(fs.realpathSync(harness.workspace))
  })
})
