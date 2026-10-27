// @covers open-source/packages/cli/src/agents/custom.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomAgentAdapter } from '../agents/custom'
import type { CustomAgentEntry } from '../config/index'
import {
  resolveCustomRuntimeExecutableFingerprint,
  sha256File,
} from '../agents/custom-managed-runtime.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import type { ManagedAgentRuntimePlatform } from '../security/managed-agent-runtime.js'

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
}

function makeEntry(command: string): CustomAgentEntry {
  return {
    command,
    caps: {
      name: 'Test Agent',
      model: 'test-model',
      mode: 'spawn',
    },
  }
}

function managedPlatform(): ManagedAgentRuntimePlatform {
  return process.platform === 'darwin' ||
    process.platform === 'linux' ||
    process.platform === 'win32'
    ? process.platform
    : 'unsupported'
}

function makeDeclaredEntry(command: string, executablePath: string): CustomAgentEntry {
  const entry = makeEntry(command)
  entry.caps.version = '2.4.0'
  entry.caps.security = {
    schemaVersion: 1,
    declarationVersion: 1,
    policyProtocol: 'shennian-managed-policy-file-v1',
    runtimeVersion: '2.4.0',
    executablePath,
    executableSha256: sha256File(executablePath),
    conformance: {
      suiteVersion: '1',
      status: 'passed',
      platform: managedPlatform(),
      testedAt: '2026-09-05T00:00:00.000Z',
    },
    runtimeSecurity: {
      minimumRuntimeVersion: '2.4.0',
      platforms: {
        [managedPlatform()]: {
          level: 'partial',
          fileAccess: {
            'workspace-read': true,
            'workspace-write': true,
            'host-full': true,
          },
          externalCapabilities: {
            commandNetwork: { allow: false, deny: true },
            webSearch: { allow: false, deny: true },
            browser: { allow: false, deny: true },
            computerUse: { allow: false, deny: true },
            mcp: { allow: false, deny: true },
          },
          knownGaps: ['customRuntime.shellIsolationPartial'],
        },
      },
    },
  }
  return entry
}

function compiledPolicy(
  workDir: string,
  entry?: CustomAgentEntry,
): CompiledManagedAgentPolicy {
  const requestedPolicy = {
    version: 1,
    fileAccess: 'workspace-write' as const,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  }
  return {
    requestedPolicy,
    enforcement: {
      level: 'unverified',
      effectivePolicy: {
        ...requestedPolicy,
        fileAccess: 'host-full',
        externalCapabilities: {
          commandNetwork: true,
          webSearch: true,
          browser: true,
          computerUse: true,
          mcp: true,
        },
      },
      unsupportedCapabilities: ['fileAccess.workspaceWrite'],
      runtimeVersion: '2.4.0',
      platform: managedPlatform(),
      ...(entry
        ? { executableFingerprint: resolveCustomRuntimeExecutableFingerprint(entry) }
        : {}),
    },
    adapterPolicy: {
      version: 1,
      workDir,
      fileAccess: 'host-full',
      externalCapabilities: {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        computerUse: true,
        mcp: true,
      },
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: [],
      sessionEnvKeys: ['SHENNIAN_MANAGER_SESSION_ID'],
      shellSubprocess: { inherit: 'none', allowedEnvKeys: [], deniedEnvKeys: [] },
    },
  }
}

function writeScript(dir: string, name: string, source: string): string {
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, source)
  fs.chmodSync(filePath, 0o755)
  return filePath
}

describe('CustomAgentAdapter dispatch', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-custom-adapter-'))
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('fails closed when a managed Room turn has no compiled policy', async () => {
    const adapter = new CustomAgentAdapter('missing-policy', makeEntry('unused'))
    await adapter.start('sess-1', tempDir)

    await expect(
      adapter.send('hello', undefined, undefined, undefined, undefined, {
        source: 'room_activation',
      }),
    ).rejects.toThrow('managed_agent_policy_missing')
  })

  it('passes a private requested-policy file to declared runtimes while staying unverified', async () => {
    const script = writeScript(
      tempDir,
      'managed.mjs',
      `
      import fs from 'node:fs'
      process.stdin.resume()
      process.stdin.on('end', () => {
        const policyPath = process.env.SHENNIAN_MANAGED_AGENT_POLICY_FILE
        const policy = policyPath ? JSON.parse(fs.readFileSync(policyPath, 'utf8')) : null
        console.log(JSON.stringify({
          state: 'delta',
          text: JSON.stringify({
            hasPolicy: Boolean(policy),
            policyVersion: policy?.policyVersion,
            protection: policy?.enforcement?.level,
            requestedFileAccess: policy?.requestedPolicy?.fileAccess,
            roomContext: process.env.SHENNIAN_MANAGED_ROOM_CONTEXT,
            managerToken: process.env.SHENNIAN_MANAGER_IPC_TOKEN,
            leakedSecret: process.env.DAEMON_SECRET_SHOULD_NOT_LEAK,
          }),
        }))
        console.log(JSON.stringify({ state: 'final' }))
      })
    `,
    )
    const entry = makeDeclaredEntry(`${process.execPath} ${script}`, script)
    const adapter = new CustomAgentAdapter('verified', entry)
    const events: Array<{ state?: string; text?: string }> = []
    adapter.on('agentEvent', (event) => events.push(event))
    adapter.configure({
      managedAgentPolicy: compiledPolicy(tempDir, entry),
      env: {
        SHENNIAN_MANAGED_ROOM_CONTEXT: 'room-context',
        SHENNIAN_MANAGER_IPC_TOKEN: 'manager-token-must-not-pass',
        DAEMON_SECRET_SHOULD_NOT_LEAK: 'secret',
      },
    })

    await adapter.start('sess-1', tempDir)
    await adapter.send('hello', 'test-model', undefined, undefined, undefined, {
      source: 'room_activation',
    })
    await waitFor(() => events.some((event) => event.state === 'final'))
    const delta = events.find((event) => event.state === 'delta')
    expect(JSON.parse(delta?.text ?? '{}')).toEqual({
      hasPolicy: true,
      policyVersion: 1,
      protection: 'unverified',
      requestedFileAccess: 'workspace-write',
      roomContext: 'room-context',
    })
  })

  it('fails closed when any launch file changes after policy compilation', async () => {
    const script = writeScript(tempDir, 'runtime.mjs', 'process.exit(0)\n')
    const launchConfig = writeScript(tempDir, 'runtime-config.json', '{"safe":true}\n')
    const entry = makeDeclaredEntry(`${process.execPath} ${script} ${launchConfig}`, script)
    const adapter = new CustomAgentAdapter('changed-launch', entry)
    adapter.configure({ managedAgentPolicy: compiledPolicy(tempDir, entry) })
    await adapter.start('sess-1', tempDir)

    fs.writeFileSync(launchConfig, '{"safe":false}\n')
    await expect(
      adapter.send('hello', undefined, undefined, undefined, undefined, {
        source: 'room_activation',
      }),
    ).rejects.toThrow('custom_managed_runtime_executable_changed')
  })

  it('rejects a capability the self-declaration says it cannot provide', async () => {
    const script = writeScript(tempDir, 'limited-runtime.mjs', 'process.exit(0)\n')
    const entry = makeDeclaredEntry(`${process.execPath} ${script}`, script)
    const policy = compiledPolicy(tempDir, entry)
    policy.requestedPolicy.externalCapabilities.browser = true
    const adapter = new CustomAgentAdapter('limited', entry)
    adapter.configure({ managedAgentPolicy: policy })
    await adapter.start('sess-1', tempDir)

    await expect(
      adapter.send('hello', undefined, undefined, undefined, undefined, {
        source: 'room_activation',
      }),
    ).rejects.toThrow(
      'custom_managed_runtime_capability_unavailable:externalCapabilities.browser',
    )
  })

  it('restarts a managed stdio runtime before dispatching a changed policy', async () => {
    const script = writeScript(
      tempDir,
      'managed-stdio.mjs',
      `
      import fs from 'node:fs'
      import readline from 'node:readline'
      const policyPath = process.env.SHENNIAN_MANAGED_AGENT_POLICY_FILE
      const policyVersion = policyPath
        ? JSON.parse(fs.readFileSync(policyPath, 'utf8')).policyVersion
        : null
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (message.method === 'stop') process.exit(0)
        if (message.method === 'send') {
          console.log(JSON.stringify({ state: 'delta', text: String(policyVersion) }))
          console.log(JSON.stringify({ state: 'final' }))
        }
      })
    `,
    )
    const entry = makeDeclaredEntry(`${process.execPath} ${script}`, script)
    entry.caps.mode = 'stdio'
    const firstPolicy = compiledPolicy(tempDir, entry)
    const secondPolicy = compiledPolicy(tempDir, entry)
    secondPolicy.requestedPolicy.version = 2
    secondPolicy.adapterPolicy.version = 2
    secondPolicy.enforcement.effectivePolicy.version = 2
    const adapter = new CustomAgentAdapter('managed-stdio', entry)
    const texts: string[] = []
    adapter.on('agentEvent', (event) => {
      if (event.state === 'delta' && event.text) texts.push(event.text)
    })
    adapter.configure({ managedAgentPolicy: firstPolicy })
    await adapter.start('sess-1', tempDir)

    adapter.configure({ managedAgentPolicy: secondPolicy })
    await adapter.send('hello', undefined, undefined, undefined, undefined, {
      source: 'room_activation',
    })
    await waitFor(() => texts.includes('2'))

    expect(texts).toEqual(['2'])
    await adapter.stop()
  })

  it('resolves after the custom agent emits protocol events', async () => {
    const script = writeScript(
      tempDir,
      'ok.mjs',
      `
      process.stdin.resume()
      process.stdin.on('end', () => {
        console.log(JSON.stringify({ state: 'delta', text: 'accepted' }))
        console.log(JSON.stringify({ state: 'final', agentSessionId: 'custom-sid-1' }))
      })
    `,
    )
    const adapter = new CustomAgentAdapter('ok', makeEntry(`${process.execPath} ${script}`))
    const events: unknown[] = []
    adapter.on('agentEvent', (event) => events.push(event))

    await adapter.start('sess-1', tempDir)
    await expect(adapter.send('hello', 'test-model')).resolves.toBeUndefined()
    await waitFor(() =>
      events.some(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          (event as { state?: string }).state === 'final',
      ),
    )

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'delta', text: 'accepted' }),
        expect.objectContaining({ state: 'final', agentSessionId: 'custom-sid-1' }),
      ]),
    )
  })

  it('rejects when the first custom agent protocol event is an error', async () => {
    const script = writeScript(
      tempDir,
      'protocol-error.mjs',
      `
      process.stdin.resume()
      process.stdin.on('end', () => {
        console.log(JSON.stringify({ state: 'error', message: 'custom protocol failed' }))
      })
    `,
    )
    const adapter = new CustomAgentAdapter('bad', makeEntry(`${process.execPath} ${script}`))

    try {
      await adapter.start('sess-1', tempDir)
      await expect(adapter.send('hello')).rejects.toThrow('custom protocol failed')
    } finally { await adapter.stop() }
  }, 10000)

  it('rejects when the custom agent exits non-zero before dispatch is accepted', async () => {
    const script = writeScript(
      tempDir,
      'nonzero.mjs',
      `
      process.stderr.write('custom boot failed')
      process.exit(2)
    `,
    )
    const adapter = new CustomAgentAdapter('nonzero', makeEntry(`${process.execPath} ${script}`))

    await adapter.start('sess-1', tempDir)
    await expect(adapter.send('hello')).rejects.toThrow('custom boot failed')
  })

  it('rejects when the custom agent exits without protocol events', async () => {
    const script = writeScript(tempDir, 'silent.mjs', 'process.exit(0)')
    const adapter = new CustomAgentAdapter('silent', makeEntry(`${process.execPath} ${script}`))

    await adapter.start('sess-1', tempDir)
    await expect(adapter.send('hello')).rejects.toThrow(
      'Custom agent exited without protocol events',
    )
  })

  it('does not accept dispatch while launch environment preparation is still pending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const script = writeScript(tempDir, 'slow-preparation.mjs', 'process.exit(0)')
    const adapter = new CustomAgentAdapter('slow-preparation', makeEntry(`${process.execPath} ${script}`))
    let completePreparation!: (value: { env: NodeJS.ProcessEnv; configDir: null }) => void
    const launch = new Promise<{ env: NodeJS.ProcessEnv; configDir: null }>(resolve => {
      completePreparation = resolve
    })
    const preparation = vi.spyOn(adapter as unknown as {
      prepareManagedLaunch: () => typeof launch
    }, 'prepareManagedLaunch').mockReturnValue(launch)
    await adapter.start('sess-1', tempDir)
    const sent = adapter.send('hello')
    await vi.waitFor(() => expect(preparation).toHaveBeenCalled())
    vi.advanceTimersByTime(3_500)
    completePreparation({ configDir: null, env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR, TEMP: tempDir, TMP: tempDir,
    } })
    await expect(sent).rejects.toThrow('Custom agent exited without protocol events')
  })
})
