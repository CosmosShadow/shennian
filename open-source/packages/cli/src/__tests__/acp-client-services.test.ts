// @covers src/agents/acp/client-services.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AcpClientServices } from '../agents/acp/client-services.js'

const mockResolveBuiltinCommand = vi.hoisted(() => vi.fn())

vi.mock('../agents/command-spec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agents/command-spec.js')>()),
  resolveBuiltinCommand: mockResolveBuiltinCommand,
}))

describe('ACP opt-in Client services', () => {
  beforeEach(() => {
    mockResolveBuiltinCommand.mockReset()
  })
  it('keeps reads and writes inside the session workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-fs-'))
    const file = path.join(root, 'note.txt')
    fs.writeFileSync(file, 'one\ntwo\nthree')
    const services = new AcpClientServices(root, { readTextFile: true, writeTextFile: true })
    expect(await services.readTextFile({ sessionId: 's', path: file, line: 2, limit: 1 })).toEqual({ content: 'two' })
    await services.writeTextFile({ sessionId: 's', path: path.join(root, 'new.txt'), content: 'safe' })
    expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('safe')
    await expect(services.readTextFile({ sessionId: 's', path: '/etc/hosts' })).rejects.toThrow('outside')
    services.close()
  })

  it('runs bounded terminals only when explicitly enabled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-terminal-'))
    const disabled = new AcpClientServices(root, {})
    await expect(disabled.createTerminal({ sessionId: 's', command: process.execPath, cwd: root })).rejects.toThrow('disabled')
    const services = new AcpClientServices(root, { terminal: true })
    const { terminalId } = await services.createTerminal({
      sessionId: 's', command: process.execPath, args: ['-e', "process.stdout.write('abcdef')"], cwd: root, outputByteLimit: 4,
    })
    expect(await services.waitForTerminalExit({ sessionId: 's', terminalId })).toEqual({ exitCode: 0, signal: null })
    expect(services.terminalOutput({ sessionId: 's', terminalId })).toMatchObject({ output: 'cdef', truncated: true })
    services.releaseTerminal({ sessionId: 's', terminalId })
    services.close()
  })

  it('inherits the ACP session environment instead of the daemon environment', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-terminal-env-'))
    const services = new AcpClientServices(root, { terminal: true }, {
      PATH: process.env.PATH,
      SHENNIAN_MANAGED_ROOM_CONTEXT: 'managed-room-capability',
    })
    const { terminalId } = await services.createTerminal({
      sessionId: 's',
      command: process.execPath,
      args: ['-e', "process.stdout.write(JSON.stringify({ room: process.env.SHENNIAN_MANAGED_ROOM_CONTEXT, home: process.env.HOME }))"],
      cwd: root,
    })
    await services.waitForTerminalExit({ sessionId: 's', terminalId })
    expect(JSON.parse(services.terminalOutput({ sessionId: 's', terminalId }).output)).toEqual({
      room: 'managed-room-capability',
    })
    services.releaseTerminal({ sessionId: 's', terminalId })
    services.close()
  })

  it('bridges managed Room commands without exposing a general ACP terminal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-managed-room-'))
    mockResolveBuiltinCommand.mockReturnValue({
      command: process.execPath,
      args: ['-e', "process.stdout.write(JSON.stringify(process.argv.slice(1)))"],
      display: 'shennian',
      kind: 'native',
      path: process.execPath,
    })
    const services = new AcpClientServices(root, {
      terminal: true,
      terminalPolicy: 'managed-room-only',
    }, {
      SHENNIAN_MANAGED_ROOM_CONTEXT: 'managed-room-capability',
    })

    const { terminalId } = await services.createTerminal({
      sessionId: 's',
      command: 'shennian',
      args: ['room', 'status'],
      cwd: root,
      env: [{ name: 'SHENNIAN_MANAGED_ROOM_CONTEXT', value: 'forged' }],
    })
    await services.waitForTerminalExit({ sessionId: 's', terminalId })
    expect(JSON.parse(services.terminalOutput({ sessionId: 's', terminalId }).output)).toEqual([
      'room', 'status',
    ])
    services.releaseTerminal({ sessionId: 's', terminalId })

    await expect(services.createTerminal({
      sessionId: 's', command: 'shennian', args: ['worker', 'start'], cwd: root,
    })).rejects.toThrow('only permits Shennian Room commands')
    await expect(services.createTerminal({
      sessionId: 's', command: process.execPath, args: ['-e', 'process.exit()'], cwd: root,
    })).rejects.toThrow('only permits Shennian Room commands')
    await expect(services.createTerminal({
      sessionId: 's', command: 'shennian', args: ['room', 'attachment', 'delete'], cwd: root,
    })).rejects.toThrow('only permits Shennian Room commands')
    services.close()
  })
})
