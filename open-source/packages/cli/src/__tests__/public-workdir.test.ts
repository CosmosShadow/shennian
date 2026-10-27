// @covers open-source/packages/cli/src/agents/public-workdir.ts

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ homeDir: '', protectedRoots: [] as string[] }))
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, default: { ...original, homedir: () => state.homeDir } }
})
vi.mock('../security/managed-agent-credential-paths.js', () => ({
  resolveProtectedShennianDirectories: () => state.protectedRoots,
}))

import { preparePublicAgentWorkDir } from '../agents/public-workdir.js'

describe('public Agent work directory', () => {
  beforeEach(async () => {
    state.homeDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'shennian-public-workdir-test-')))
    state.protectedRoots = [path.join(state.homeDir, '.shennian')]
  })
  afterEach(async () => { await fs.rm(state.homeDir, { recursive: true, force: true }) })

  it('reuses the Agent directory and its files without creating directories or changing permissions', async () => {
    const workDir = path.join(state.homeDir, 'agent')
    await fs.mkdir(workDir, { mode: 0o755 })
    await fs.writeFile(path.join(workDir, 'instructions.md'), 'Shared Agent knowledge')
    const mode = (await fs.stat(workDir)).mode
    const first = await preparePublicAgentWorkDir(workDir)
    expect(await preparePublicAgentWorkDir(workDir)).toBe(first)
    expect(first).toBe(await fs.realpath(workDir))
    expect(await fs.readdir(workDir)).toEqual(['instructions.md'])
    expect(await fs.readFile(path.join(first, 'instructions.md'), 'utf8')).toBe('Shared Agent knowledge')
    expect((await fs.stat(workDir)).mode).toBe(mode)
    expect(await fs.readdir(state.homeDir)).toEqual(['agent'])
  })

  it.each(['', 'relative/agent', '../other', '/bad\0path'])('rejects an invalid saved directory %j', async (workDir) => {
    await expect(preparePublicAgentWorkDir(workDir)).rejects.toThrow('public_agent_workdir_invalid')
    expect(await fs.readdir(state.homeDir)).toEqual([])
  })

  it('does not manufacture an unavailable Agent directory', async () => {
    await expect(preparePublicAgentWorkDir(path.join(state.homeDir, 'missing'))).rejects.toThrow()
    expect(await fs.readdir(state.homeDir)).toEqual([])
  })

  it('rejects a file instead of a directory', async () => {
    const file = path.join(state.homeDir, 'file')
    await fs.writeFile(file, 'not a directory')
    await expect(preparePublicAgentWorkDir(file)).rejects.toThrow('public_agent_workdir_invalid')
  })

  it('resolves an Owner-selected directory alias before compiling permissions', async () => {
    const directory = path.join(state.homeDir, 'agent')
    const alias = path.join(state.homeDir, 'alias')
    await fs.mkdir(directory)
    await fs.symlink(directory, alias, 'junction')
    expect(await preparePublicAgentWorkDir(alias)).toBe(await fs.realpath(directory))
  })

  it('rejects an existing symlink that points the Agent directory into credential storage', async () => {
    const credentialRoot = path.join(state.homeDir, '.shennian')
    await fs.mkdir(credentialRoot)
    const alias = path.join(state.homeDir, 'alias')
    await fs.symlink(credentialRoot, alias, 'junction')
    await expect(preparePublicAgentWorkDir(alias))
      .rejects.toThrow('public_agent_workdir_credential_overlap')
  })

  it('rejects both descendants and ancestors of the credential directory', async () => {
    const credentialRoot = path.join(state.homeDir, '.shennian')
    const child = path.join(credentialRoot, 'agent')
    await fs.mkdir(child, { recursive: true })
    for (const directory of [credentialRoot, child, state.homeDir]) {
      await expect(preparePublicAgentWorkDir(directory))
        .rejects.toThrow('public_agent_workdir_credential_overlap')
    }
  })
})
