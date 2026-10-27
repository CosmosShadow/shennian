// @covers src/agents/opencode.ts
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('../agents/command-spec.js', async (original) => ({
  ...await original<typeof import('../agents/command-spec.js')>(),
  resolveBuiltinCommand: () => ({ command: 'opencode', args: [], path: 'opencode.cmd', kind: 'cmd-shim' }),
  spawnAgentCommand: mocks.spawn,
}))
import { OpenCodeAdapter } from '../agents/opencode.js'

describe('OpenCode prompt transport', () => {
  it('sends exact multiline quoted text through stdin, not command arguments', async () => {
    const proc = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    })
    const chunks: Buffer[] = []
    proc.stdin.on('data', chunk => chunks.push(chunk))
    mocks.spawn.mockReturnValue(proc)
    const adapter = new OpenCodeAdapter()
    await adapter.start('session-input', process.cwd())
    const input = '保留 "quotes" & %PATH%\nsecond line \\ path'
    await adapter.send(input, 'provider/flash')
    const [, args, options] = mocks.spawn.mock.calls[0]
    expect(args).not.toContain(input)
    expect(args).not.toContain('--dir')
    expect(args).toEqual(['run', '--auto', '--format', 'json', '--model', 'provider/flash'])
    expect(options.cwd).toBe(process.cwd())
    if (process.platform !== 'win32') expect(options.env.PWD).toBe(process.cwd())
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(Buffer.concat(chunks).toString('utf8')).toBe(input)
    expect(proc.stdin.writableEnded).toBe(true)
    proc.emit('close', 0)
  })
})
