// @covers src/commands/english.ts
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const config = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../config/index.js', () => ({ loadConfig: config.load }))
import { readEnglishProgress, registerEnglishCommand } from '../commands/english.js'
beforeEach(() => {
  vi.resetAllMocks()
  config.load.mockReturnValue({ machineId: 'machine', machineToken: 'private-token' })
})
describe('cloud English progress', () => {
  it('makes a read-only, authenticated request with no user override and no redirects', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ source: 'cloud', total: 1, items: [{ word: 'apple' }] }),
      })
    expect(await readEnglishProgress(fetcher)).toMatchObject({ source: 'cloud', total: 1 })
    expect(fetcher).toHaveBeenCalledWith(
      'https://shennian.net/api/english-cli/progress',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: { authorization: 'Bearer private-token' },
      }),
    )
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('body')
  })
  it('does not request without pairing, or treat failed reads as zero progress', async () => {
    const fetcher = vi.fn()
    config.load.mockReturnValue({})
    await expect(readEnglishProgress(fetcher)).rejects.toThrow('not_paired')
    expect(fetcher).not.toHaveBeenCalled()
    config.load.mockReturnValue({ machineId: 'machine', machineToken: 'private-token' })
    for (const [status, code] of [
      [401, 'english_auth_required'],
      [403, 'english_access_denied'],
      [402, 'english_plan_required'],
      [404, 'english_server_upgrade_required'],
      [503, 'english_progress_unavailable'],
    ] as const) {
      fetcher.mockResolvedValue({ ok: false, status })
      await expect(readEnglishProgress(fetcher)).rejects.toThrow(code)
    }
  })
  it('exposes JSON progress and sanitizes errors without any write subcommands', async () => {
    const output: string[] = [],
      fail = vi.fn()
    const read = vi.fn().mockResolvedValue({ total: 2, mastered: 1, learning: 1 })
    const program = new Command()
    registerEnglishCommand(program, { read, write: (s) => output.push(s), fail })
    await program.parseAsync(['english', 'progress'], { from: 'user' })
    expect(JSON.parse(output[0]!)).toEqual({ ok: true, total: 2, mastered: 1, learning: 1 })
    expect(program.commands[0]!.commands.map((c) => c.name())).toEqual(['progress'])
    read.mockRejectedValue(new Error('secret response or token'))
    await program.parseAsync(['english', 'progress'], { from: 'user' })
    expect(JSON.parse(output[1]!)).toEqual({ ok: false, error: 'english_progress_unavailable' })
    expect(fail).toHaveBeenCalledOnce()
  })
})
