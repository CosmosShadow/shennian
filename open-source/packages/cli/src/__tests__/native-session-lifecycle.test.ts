// @covers src/session/native-session-lifecycle.ts

import { describe, expect, it, vi } from 'vitest'
import {
  NativeSessionLifecycleRegistry,
  type NativeLifecycleCommandRunner,
} from '../session/native-session-lifecycle.js'

const uuid = '123e4567-e89b-42d3-a456-426614174000'

function result(stdout = '', code = 0) {
  return { code, stdout, stderr: '', timedOut: false }
}

describe('native session lifecycle capability adapters', () => {
  it('uses Codex archive before any destructive fallback', async () => {
    const runner = vi.fn<NativeLifecycleCommandRunner>(async (_agent, args) =>
      args[0] === '--help' ? result('archive  Archive a saved session') : result('', 1),
    )
    const codexArchive = vi.fn(async () => ({ outcome: 'archived' as const }))
    const registry = new NativeSessionLifecycleRegistry({ runner, codexArchive })

    await expect(registry.execute('codex', uuid)).resolves.toEqual({ outcome: 'archived' })
    expect(codexArchive).toHaveBeenCalledWith(uuid)
    expect(runner).not.toHaveBeenCalledWith('codex', ['delete', uuid], expect.anything())
  })

  it('falls back only to the official UUID archive command when App Server lacks the method', async () => {
    const runner = vi.fn<NativeLifecycleCommandRunner>(async (_agent, args) =>
      args[0] === '--help' ? result('archive  Archive a saved session') : result(),
    )
    const registry = new NativeSessionLifecycleRegistry({
      runner,
      codexArchive: vi.fn(async () => ({ outcome: 'unsupported' as const })),
    })

    await expect(registry.execute('codex', uuid)).resolves.toEqual({ outcome: 'archived' })
    expect(runner).toHaveBeenLastCalledWith('codex', ['archive', uuid], 15_000)
    await expect(registry.execute('codex', 'session by title')).resolves.toEqual({
      outcome: 'invalid_identity',
    })
  })

  it('deletes Gemini only by a full UUID and never resolves an index', async () => {
    const runner = vi.fn<NativeLifecycleCommandRunner>(async (_agent, args) =>
      args[0] === '--help' ? result('--delete-session') : result(),
    )
    const registry = new NativeSessionLifecycleRegistry({ runner })

    await expect(registry.execute('gemini', uuid, { workDir: process.cwd() }))
      .resolves.toEqual({ outcome: 'deleted' })
    expect(runner).toHaveBeenLastCalledWith(
      'gemini', ['--delete-session', uuid], 15_000, process.cwd(),
    )
    await expect(registry.execute('gemini', '2', { workDir: process.cwd() })).resolves.toEqual({
      outcome: 'invalid_identity',
    })
    await expect(registry.execute('gemini', uuid)).resolves.toEqual({
      outcome: 'invalid_identity',
    })
  })

  it('uses the official OpenCode session delete command for a stable session ID', async () => {
    const runner = vi.fn<NativeLifecycleCommandRunner>(async (_agent, args) =>
      args.includes('--help') ? result('opencode session delete <sessionID>') : result(),
    )
    const registry = new NativeSessionLifecycleRegistry({ runner })

    await expect(registry.execute('opencode', 'ses_abcdef123456', { workDir: process.cwd() }))
      .resolves.toEqual({
      outcome: 'deleted',
    })
    expect(runner).toHaveBeenLastCalledWith(
      'opencode',
      ['session', 'delete', 'ses_abcdef123456'],
      15_000,
      process.cwd(),
    )
  })

  it('keeps Cursor and unsupported providers as safe no-ops without a mutation command', async () => {
    const runner = vi.fn<NativeLifecycleCommandRunner>(async () =>
      result('create-chat\nls\nresume\nacp'),
    )
    const registry = new NativeSessionLifecycleRegistry({ runner })

    await expect(registry.execute('cursor', uuid)).resolves.toEqual({ outcome: 'unsupported' })
    await expect(registry.execute('claude', uuid)).resolves.toEqual({ outcome: 'unsupported' })
    await expect(registry.execute('workbuddy', uuid)).resolves.toEqual({ outcome: 'unsupported' })
    await expect(registry.execute('pi', uuid)).resolves.toEqual({ outcome: 'unsupported' })
    await expect(registry.execute('custom:local', uuid)).resolves.toEqual({
      outcome: 'unsupported',
    })
  })

  it('caches capability probes for the process lifetime', async () => {
    const runner = vi.fn<NativeLifecycleCommandRunner>(async (_agent, args) =>
      args.includes('--help') ? result('opencode session delete <sessionID>') : result(),
    )
    const registry = new NativeSessionLifecycleRegistry({ runner })

    await registry.execute('opencode', 'ses_abcdef123456')
    await registry.execute('opencode', 'ses_abcdef654321')

    expect(runner.mock.calls.filter(([, args]) => args.includes('--help'))).toHaveLength(1)
  })

  it('classifies missing sessions idempotently and native locks as retryable', async () => {
    const runner = vi.fn<NativeLifecycleCommandRunner>()
    runner.mockResolvedValueOnce(result('--delete-session'))
    runner.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: 'Session not found',
      timedOut: false,
    })
    const absent = new NativeSessionLifecycleRegistry({ runner })
    await expect(absent.execute('gemini', uuid, { workDir: process.cwd() }))
      .resolves.toEqual({ outcome: 'already_absent' })

    const lockedRunner = vi.fn<NativeLifecycleCommandRunner>()
    lockedRunner.mockResolvedValueOnce(result('opencode session delete <sessionID>'))
    lockedRunner.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: 'session is locked by an active writer',
      timedOut: false,
    })
    const locked = new NativeSessionLifecycleRegistry({ runner: lockedRunner })
    await expect(locked.execute('opencode', 'ses_abcdef123456', { workDir: process.cwd() }))
      .resolves.toEqual({
      outcome: 'transient',
      errorCode: 'native_busy',
    })

    const activeGeminiRunner = vi.fn<NativeLifecycleCommandRunner>()
    activeGeminiRunner.mockResolvedValueOnce(result('--delete-session'))
    activeGeminiRunner.mockResolvedValueOnce({
      code: 0,
      stdout: '',
      stderr: 'Cannot delete the current active session.',
      timedOut: false,
    })
    const activeGemini = new NativeSessionLifecycleRegistry({ runner: activeGeminiRunner })
    await expect(activeGemini.execute('gemini', uuid, { workDir: process.cwd() })).resolves.toEqual({
      outcome: 'transient',
      errorCode: 'native_busy',
    })
  })

  it('treats a missing valid Gemini UUID as already absent and rejects a missing project context', async () => {
    const runner = vi.fn<NativeLifecycleCommandRunner>()
    runner.mockResolvedValueOnce(result('--delete-session'))
    runner.mockResolvedValueOnce({
      code: 0,
      stdout: '',
      stderr: `Invalid session identifier "${uuid}".`,
      timedOut: false,
    })
    const registry = new NativeSessionLifecycleRegistry({ runner })

    await expect(registry.execute('gemini', uuid, { workDir: process.cwd() }))
      .resolves.toEqual({ outcome: 'already_absent' })
    await expect(registry.execute('gemini', uuid)).resolves.toEqual({
      outcome: 'invalid_identity',
    })
  })
})
