// @arch open-source/docs/cli-runtime.md
// @covers src/fs/boundary.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'

import {
  createAuthorizedFsRoot,
  createAuthorizedFsRootAsync,
  resolveAuthorizedPath,
  resolveAuthorizedPathAsync,
  resolveSessionWorkDir,
} from '../fs/boundary.js'

describe('authorized fs boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('blocks Windows parent traversal from D:\\project to D:\\ or C:\\', () => {
    const root = createAuthorizedFsRoot('D:\\project')

    expect(resolveAuthorizedPath('D:\\project', root)).toMatchObject({ ok: true, path: 'D:\\project' })
    expect(resolveAuthorizedPath('D:\\project\\src', root)).toMatchObject({ ok: true, path: 'D:\\project\\src' })
    expect(resolveAuthorizedPath('D:\\project\\..', root)).toMatchObject({ ok: false })
    expect(resolveAuthorizedPath('D:\\', root)).toMatchObject({ ok: false })
    expect(resolveAuthorizedPath('C:\\', root)).toMatchObject({ ok: false })
  })

  it('blocks normalized .. escapes relative to the authorized root', () => {
    const root = createAuthorizedFsRoot('/Users/alice/project')

    expect(resolveAuthorizedPath('src/../README.md', root)).toMatchObject({ ok: true, path: '/Users/alice/project/README.md' })
    expect(resolveAuthorizedPath('../secrets.txt', root)).toMatchObject({ ok: false })
    expect(resolveAuthorizedPath('/Users/alice/project/../../.ssh/id_rsa', root)).toMatchObject({ ok: false })
  })

  it('expands Linux root user home paths before enforcing the boundary', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/root')

    const root = createAuthorizedFsRoot('~')

    expect(root).toMatchObject({ normalized: '/root', boundary: '/root', flavor: 'posix' })
    expect(resolveAuthorizedPath('~', root)).toMatchObject({ ok: true, path: '/root' })
    expect(resolveAuthorizedPath('~/projects', root)).toMatchObject({ ok: true, path: '/root/projects' })
    expect(resolveAuthorizedPath('/root/projects', root)).toMatchObject({ ok: true, path: '/root/projects' })
    expect(resolveAuthorizedPath('/etc', root)).toMatchObject({ ok: false })
  })

  it('keeps absolute POSIX paths as their own browsing roots', () => {
    const root = createAuthorizedFsRoot('/var/www')

    expect(resolveAuthorizedPath('/var/www/app', root)).toMatchObject({ ok: true, path: '/var/www/app' })
    expect(resolveAuthorizedPath('/var/log', root)).toMatchObject({ ok: false })
  })

  it('does not rewrite Windows absolute paths while adding tilde support', () => {
    expect(resolveSessionWorkDir('G:\\Documents')).toBe('G:\\Documents')

    const root = createAuthorizedFsRoot('G:\\Documents')

    expect(resolveAuthorizedPath('G:\\Documents\\code', root)).toMatchObject({ ok: true, path: 'G:\\Documents\\code' })
    expect(resolveAuthorizedPath('G:\\Other', root)).toMatchObject({ ok: false })
  })

  it('blocks symlink realpath escapes', () => {
    const realpath = vi.spyOn(fs.realpathSync, 'native')
    realpath.mockImplementation((target) => {
      const value = String(target)
      if (value === '/workspace/project') return '/workspace/project'
      if (value === '/workspace/project/link') return '/etc'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const root = createAuthorizedFsRoot('/workspace/project')
    expect(resolveAuthorizedPath('/workspace/project/link', root)).toMatchObject({ ok: false })

    realpath.mockRestore()
  })

  it('enforces symlink boundaries without synchronous disk access', async () => {
    vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('synchronous stat must not run')
    })
    vi.spyOn(fs.realpathSync, 'native').mockImplementation(() => {
      throw new Error('synchronous realpath must not run')
    })
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({
      isFile: () => false,
    } as fs.Stats)
    vi.spyOn(fs.promises, 'realpath').mockImplementation(async (target) => {
      const value = String(target)
      if (value === '/workspace/project') return '/workspace/project'
      if (value === '/workspace/project/link') return '/etc'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const root = await createAuthorizedFsRootAsync('/workspace/project')
    await expect(resolveAuthorizedPathAsync('/workspace/project/link', root))
      .resolves.toMatchObject({ ok: false })
  })
})
