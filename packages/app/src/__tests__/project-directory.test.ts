// @covers packages/app/src/features/machines/utils/projectDirectory.ts
import { describe, expect, it, vi } from 'vitest'
import { isHomeDirectoryAlias, resolveProjectDirectory } from '../features/machines/utils/projectDirectory'

function runtime(response: unknown = { ok: true, payload: { path: '/Users/remote' } }) {
  return {
    observeMachine: vi.fn().mockResolvedValue(true),
    unobserveMachine: vi.fn().mockResolvedValue(undefined),
    requestMachine: vi.fn().mockResolvedValue(response),
  }
}

describe('project directory identity', () => {
  it.each(['~', ' ~/repo ', '~\\repo'])('resolves %s through the selected machine', async (path) => {
    const remote = runtime()
    expect(await resolveProjectDirectory('test_mac', path, remote)).toBe('/Users/remote')
    expect(remote.requestMachine).toHaveBeenCalledWith('test_mac', 'fs.ls', { path: path.trim() })
    expect(remote.observeMachine).toHaveBeenCalledWith('test_mac')
    expect(remote.unobserveMachine).toHaveBeenCalledWith('test_mac')
  })
  it.each(['/Users/remote/repo', '/', 'C:\\Users\\remote', '\\\\host\\share'])('keeps absolute %s unchanged', async (path) => {
    const remote = runtime()
    expect(await resolveProjectDirectory('machine', path, remote)).toBe(path)
    expect(remote.requestMachine).not.toHaveBeenCalled()
    expect(remote.observeMachine).not.toHaveBeenCalled()
  })
  it.each(['/home/remote', 'C:\\Users\\remote', '\\\\host\\share'])('accepts remote platform path %s', async (path) => {
    expect(await resolveProjectDirectory('machine', '~', runtime({ ok: true, payload: { path } }))).toBe(path)
  })
  it.each([undefined, '', '~', 'relative', 42])('fails closed on invalid remote path %s', async (path) => {
    const remote = runtime({ ok: true, payload: { path } })
    await expect(resolveProjectDirectory('machine', '~', remote)).rejects.toThrow('invalid project directory')
    expect(remote.unobserveMachine).toHaveBeenCalledOnce()
  })
  it('does not save an unresolved alias after machine failure', async () => {
    const remote = runtime({ ok: false, error: 'offline' })
    await expect(resolveProjectDirectory('machine', '~', remote)).rejects.toThrow('offline')
    expect(remote.unobserveMachine).toHaveBeenCalledOnce()
  })
  it('releases observation after transport failure', async () => {
    const remote = runtime()
    remote.requestMachine.mockRejectedValue(new Error('timeout'))
    await expect(resolveProjectDirectory('machine', '~', remote)).rejects.toThrow('timeout')
    expect(remote.unobserveMachine).toHaveBeenCalledOnce()
  })
  it('never requests on failed observation or guesses another machine home', async () => {
    const remote = runtime()
    remote.observeMachine.mockResolvedValue(false)
    await expect(resolveProjectDirectory('machine', '~', remote)).rejects.toThrow('connect')
    expect(remote.requestMachine).not.toHaveBeenCalled()
    expect(isHomeDirectoryAlias('~another-user')).toBe(false)
  })
})
