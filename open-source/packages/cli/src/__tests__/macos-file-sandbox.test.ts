// @covers open-source/packages/cli/src/security/macos-file-sandbox.ts

import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildMacosFileSandboxProfile,
  isMacosFileSandboxSupported,
  wrapCommandWithMacosFileSandbox,
} from '../security/macos-file-sandbox.js'

describe('macOS file sandbox profile', () => {
  it('reports support only on darwin', () => {
    expect(isMacosFileSandboxSupported('darwin')).toBe(true)
    expect(isMacosFileSandboxSupported('linux')).toBe(false)
    expect(isMacosFileSandboxSupported('win32')).toBe(false)
  })

  it('requires at least one confined root', () => {
    expect(() => buildMacosFileSandboxProfile({ confinedRoots: [], scopes: [] }))
      .toThrow('macos_file_sandbox_confined_root_required')
  })

  it('builds a deny-the-root, reopen-the-scope profile', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shennian-sandbox-profile-'))
    try {
      const confined = await fs.realpath(root)
      const scopeDir = path.join(confined, 'workdir')
      await fs.mkdir(scopeDir)
      const profile = buildMacosFileSandboxProfile({
        confinedRoots: [root],
        scopes: [{ path: scopeDir, write: true }, { path: path.join(confined, 'readonly'), write: false }],
      })
      expect(profile.startsWith('(version 1)\n(allow default)\n')).toBe(true)
      expect(profile).toContain(`(deny file-read-data file-write* (subpath "${confined}"))`)
      expect(profile).toContain(`(allow file-read-data file-write* (subpath "${scopeDir}"))`)
      expect(profile).toContain(`(allow file-read-data (subpath "${path.join(confined, 'readonly')}"))`)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('deduplicates confined roots and quotes embedded quotes safely', () => {
    const profile = buildMacosFileSandboxProfile({
      confinedRoots: ['/tmp', '/tmp'],
      scopes: [],
    })
    const denyLines = profile.split('\n').filter((line) => line.startsWith('(deny'))
    expect(denyLines).toHaveLength(1)
    expect(() => buildMacosFileSandboxProfile({
      confinedRoots: ['/private/tmp'], scopes: [{ path: '/private/tmp/a"b', write: false }],
    })).not.toThrow()
  })

  it('refuses to wrap a command when unsupported on the current platform', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      expect(() => wrapCommandWithMacosFileSandbox('/bin/echo', ['hi'], {
        confinedRoots: ['/tmp'], scopes: [],
      })).toThrow('macos_file_sandbox_unsupported_platform')
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
  })

  it('wraps a command through sandbox-exec with -p and the profile text', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const wrapped = wrapCommandWithMacosFileSandbox('echo', ['hi'], {
        confinedRoots: ['/tmp'], scopes: [],
      })
      expect(wrapped.command).toBe('sandbox-exec')
      expect(wrapped.args[0]).toBe('-p')
      expect(wrapped.args[2]).toBe('--')
      expect(wrapped.args.slice(3)).toEqual(['echo', 'hi'])
    } finally { Object.defineProperty(process, 'platform', original) }
  })
})

// Real `sandbox-exec` enforcement, not just profile-string generation. Every
// case here only uses throwaway fixtures created under a fresh confined root
// created for this test; nothing outside that root is touched.
describe.skipIf(process.platform !== 'darwin')('macOS file sandbox real enforcement', () => {
  let root: string | null = null

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true })
    root = null
  })

  async function setup() {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shennian-sandbox-real-'))
    const confined = await fs.realpath(root)
    const workDir = path.join(confined, 'visitor-a')
    const siblingDir = path.join(confined, 'visitor-b')
    await fs.mkdir(workDir)
    await fs.mkdir(siblingDir)
    const siblingSecret = path.join(siblingDir, 'secret.txt')
    await fs.writeFile(siblingSecret, 'sibling-secret')
    const escapeSymlink = path.join(workDir, 'escape')
    await fs.symlink(siblingDir, escapeSymlink)
    const spec = { confinedRoots: [confined], scopes: [{ path: workDir, write: true }] }
    return { confined, workDir, siblingDir, siblingSecret, escapeSymlink, spec }
  }

  function run(command: string, args: string[], spec: Parameters<typeof wrapCommandWithMacosFileSandbox>[2],
    cwd: string) {
    const wrapped = wrapCommandWithMacosFileSandbox(command, args, spec)
    return spawnSync(wrapped.command, wrapped.args, { cwd, encoding: 'utf8', timeout: 15_000 })
  }

  it('still runs a plain command normally (allow default is not broken)', async () => {
    const { workDir, spec } = await setup()
    const result = run('/bin/echo', ['still-works'], spec, workDir)
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('still-works')
  })

  it('allows reading a file inside the reopened workDir', async () => {
    const { workDir, spec } = await setup()
    const own = path.join(workDir, 'own.txt')
    await fs.writeFile(own, 'own-content')
    const result = run('/bin/cat', [own], spec, workDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('own-content')
  })

  it('denies an absolute-path read into a sibling visitor directory', async () => {
    const { workDir, siblingSecret, spec } = await setup()
    const result = run('/bin/cat', [siblingSecret], spec, workDir)
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('sibling-secret')
  })

  it('denies a read through a symlink inside workDir that escapes to a sibling directory', async () => {
    const { workDir, escapeSymlink, spec } = await setup()
    const result = run('/bin/cat', [path.join(escapeSymlink, 'secret.txt')], spec, workDir)
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('sibling-secret')
  })

  it('denies a write outside the reopened workDir but allows one inside it', async () => {
    const { confined, workDir, spec } = await setup()
    const outsidePath = path.join(confined, 'pwned.txt')
    const deniedWrite = run('/bin/sh', ['-c', `echo pwned > ${outsidePath}`], spec, workDir)
    expect(deniedWrite.status).not.toBe(0)
    await expect(fs.access(outsidePath)).rejects.toThrow()

    const insidePath = path.join(workDir, 'allowed.txt')
    const allowedWrite = run('/bin/sh', ['-c', `echo written > ${insidePath}`], spec, workDir)
    expect(allowedWrite.status).toBe(0)
    await expect(fs.readFile(insidePath, 'utf8')).resolves.toBe('written\n')
  })

  it('still allows stat/realpath-style metadata lookups outside the reopened scope, unlike content or listing', async () => {
    const { workDir, siblingDir, siblingSecret, spec } = await setup()
    // A shell-script launcher's `realpath "$0"` walks every ancestor
    // directory component with metadata-only lookups; denying those (not
    // just the reopened leaf) broke real Adapters that use such launchers.
    const realpathResult = run('/usr/bin/stat', ['-f', '%N', siblingSecret], spec, workDir)
    expect(realpathResult.status).toBe(0)
    // Listing a denied directory's contents and reading a denied file's
    // bytes must both still fail — metadata visibility is not a content leak.
    const listResult = run('/bin/ls', [siblingDir], spec, workDir)
    expect(listResult.status).not.toBe(0)
    const catResult = run('/bin/cat', [siblingSecret], spec, workDir)
    expect(catResult.status).not.toBe(0)
  })
})
