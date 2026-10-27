// @covers src/commands/runtime.ts

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerRuntimeCommand } from '../commands/runtime.js'

const mocks = vi.hoisted(() => ({
  config: { customAgents: {} } as any,
  saveConfig: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('../config/index.js', () => ({
  loadConfig: () => mocks.config,
  saveConfig: mocks.saveConfig,
}))

vi.mock('../agents/command-spec.js', () => ({
  spawnCommandString: mocks.spawn,
  parseCommandString: (command: string) => command.trim().split(/\s+/),
}))

describe('custom runtime CLI', () => {
  let output = ''

  beforeEach(() => {
    output = ''
    process.exitCode = undefined
    mocks.config = { customAgents: {} }
    mocks.saveConfig.mockReset()
    mocks.spawn.mockReset()
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('registers a probed runtime under the runtime namespace', async () => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    })
    mocks.spawn.mockReturnValue(proc)
    const program = new Command().exitOverride()
    registerRuntimeCommand(program)
    const parsing = program.parseAsync(['runtime', 'add', 'demo', '--command', 'demo-agent'], {
      from: 'user',
    })
    queueMicrotask(() => {
      proc.stdout.write('{"name":"Demo","models":["demo-1"],"mode":"stdio"}\n')
      proc.emit('close', 0)
    })
    await parsing

    expect(mocks.config.customAgents.demo).toMatchObject({ command: 'demo-agent' })
    expect(mocks.saveConfig).toHaveBeenCalled()
    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      command: 'runtime.add',
      result: {
        runtimeRef: 'custom:demo',
        models: ['demo-1'],
        managedProtection: 'unverified',
        securityDeclaration: 'unverified',
      },
    })
  })

  it('lists custom runtimes as one JSON result', async () => {
    mocks.config.customAgents.demo = {
      command: 'demo-agent',
      caps: { name: 'Demo', model: 'demo-1', mode: 'spawn' },
    }
    const program = new Command().exitOverride()
    registerRuntimeCommand(program)

    await program.parseAsync(['runtime', 'list'], { from: 'user' })

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      command: 'runtime.list',
      result: {
        runtimes: [{
          runtimeRef: 'custom:demo',
          managedProtection: 'unverified',
          securityDeclaration: 'unverified',
        }],
      },
    })
  })

  it('rejects an explicit security declaration that cannot be verified', async () => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    })
    mocks.spawn.mockReturnValue(proc)
    const program = new Command().exitOverride()
    registerRuntimeCommand(program)
    const parsing = program.parseAsync(['runtime', 'add', 'unsafe', '--command', 'unsafe-agent'], {
      from: 'user',
    })
    queueMicrotask(() => {
      proc.stdout.write(
        JSON.stringify({
          name: 'Unsafe',
          models: ['unsafe-model'],
          mode: 'spawn',
          version: '1.0.0',
          security: { schemaVersion: 1 },
        }) + '\n',
      )
      proc.emit('close', 0)
    })
    await parsing

    expect(mocks.config.customAgents.unsafe).toBeUndefined()
    expect(mocks.saveConfig).not.toHaveBeenCalled()
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      error: 'runtime_security_declaration_invalid',
    })
  })
})
