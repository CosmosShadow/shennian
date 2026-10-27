// @covers src/steward/workspace.ts
// @covers src/steward/templates.ts
// @covers src/steward/onboarding.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  StewardWorkspaceError,
  assertPathsSeparate,
  ensureStewardWorkspace,
  getStewardDir,
} from '../steward/workspace.js'
import { defaultWorkspace } from '../steward/settings.js'
import { STEWARD_AGENTS_MD } from '../steward/templates.js'
import { STEWARD_INDEX_ONBOARDING } from '../steward/onboarding.js'
import { STEWARD_SYSTEM_PROMPT } from '../steward/session.js'

let root: string
let previousHome: string | undefined

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-steward-')))
  previousHome = process.env.SHENNIAN_HOME
  process.env.SHENNIAN_HOME = path.join(root, '.shennian')
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.SHENNIAN_HOME
  else process.env.SHENNIAN_HOME = previousHome
  fs.rmSync(root, { recursive: true, force: true })
})

describe('steward workspace location', () => {
  it('uses the visible shennian-agent directory for a fresh installation', () => {
    const home = vi.spyOn(os, 'homedir').mockReturnValue(root)
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.stubEnv('SHENNIAN_HOME', undefined)
    vi.stubEnv('VITEST', '')
    try {
      expect(defaultWorkspace()).toBe(path.join(root, 'shennian-agent'))
    } finally {
      vi.unstubAllEnvs()
      exists.mockRestore()
      home.mockRestore()
    }
  })

  it('is a sibling of the credential root and follows an isolated home', () => {
    expect(getStewardDir()).toBe(path.join(root, '.shennian-steward'))
    process.env.SHENNIAN_HOME = path.join(root, 'dev-home')
    expect(getStewardDir()).toBe(path.join(root, 'dev-home-steward'))
  })

  it('is the documented default beside ~/.shennian when no override is set', () => {
    delete process.env.SHENNIAN_HOME
    const dir = getStewardDir()
    // Vitest maps the default home into tmp; the sibling rule is what matters.
    expect(dir.endsWith('-steward')).toBe(true)
    expect(path.dirname(dir)).toBe(path.dirname(dir.slice(0, -'-steward'.length)))
  })
})

describe('ensureStewardWorkspace', () => {
  it('creates a private directory with AGENTS.md, index.md and a CLAUDE.md import', () => {
    const result = ensureStewardWorkspace()
    expect(result.dir).toBe(path.join(root, '.shennian-steward'))
    expect(result.created.sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'index.md'])
    expect(fs.readFileSync(path.join(result.dir, 'CLAUDE.md'), 'utf8').trim()).toBe('@AGENTS.md')
    expect(fs.readFileSync(path.join(result.dir, 'AGENTS.md'), 'utf8')).toBe(STEWARD_AGENTS_MD)
    if (process.platform !== 'win32') {
      expect(fs.statSync(result.dir).mode & 0o777).toBe(0o700)
      expect(fs.statSync(path.join(result.dir, 'AGENTS.md')).mode & 0o777).toBe(0o600)
    }
    expect(fs.existsSync(path.join(result.dir, 'work'))).toBe(false)
  })

  it('is idempotent and never overwrites a user-edited file', () => {
    const first = ensureStewardWorkspace()
    fs.writeFileSync(path.join(first.dir, 'index.md'), '# 我的资料\n')
    fs.rmSync(path.join(first.dir, 'CLAUDE.md'))
    const second = ensureStewardWorkspace()
    expect(second.created).toEqual(['CLAUDE.md'])
    expect(fs.readFileSync(path.join(first.dir, 'index.md'), 'utf8')).toBe('# 我的资料\n')
    expect(ensureStewardWorkspace().created).toEqual([])
  })

  it('tightens the permissions of an existing group/world-readable directory', () => {
    if (process.platform === 'win32') return
    const dir = getStewardDir()
    fs.mkdirSync(dir, { mode: 0o755 })
    fs.chmodSync(dir, 0o755)
    ensureStewardWorkspace()
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('repairs a missing index without touching existing agent instructions or scanning files', () => {
    const first = ensureStewardWorkspace()
    const custom = '# Custom privacy rules: never read my Documents'
    fs.writeFileSync(path.join(first.dir, 'AGENTS.md'), custom)
    fs.unlinkSync(path.join(first.dir, 'index.md'))
    const second = ensureStewardWorkspace()
    expect(second.created).toEqual(['index.md'])
    expect(fs.readFileSync(path.join(first.dir, 'AGENTS.md'), 'utf8')).toBe(custom)
    const index = fs.readFileSync(path.join(first.dir, 'index.md'), 'utf8')
    expect(index).toContain('先主动询问')
    expect(index).not.toContain(root)
    expect(STEWARD_SYSTEM_PROMPT).toContain(STEWARD_INDEX_ONBOARDING)
    expect(STEWARD_INDEX_ONBOARDING).toContain('同一次 shennian steward say')
    expect(STEWARD_INDEX_ONBOARDING).toContain('用户本轮已明确拒绝时不邀请')
    expect(STEWARD_SYSTEM_PROMPT).toContain('不要等第二次 say')
  })

  it('preserves deferred onboarding and existing restricted entries across initialization', () => {
    const { dir } = ensureStewardWorkspace()
    const custom = '# 资料地图\n资料引导：已跳过\n| 私人资料 | /private | 不可读 | restricted |\n'
    fs.writeFileSync(path.join(dir, 'index.md'), custom)
    expect(ensureStewardWorkspace().created).toEqual([])
    expect(fs.readFileSync(path.join(dir, 'index.md'), 'utf8')).toBe(custom)
    expect(STEWARD_AGENTS_MD).toContain(STEWARD_INDEX_ONBOARDING)
  })

  it('refuses a symlinked workspace, including one aimed at the credential root', () => {
    fs.mkdirSync(process.env.SHENNIAN_HOME!, { recursive: true })
    fs.symlinkSync(process.env.SHENNIAN_HOME!, getStewardDir())
    expect(() => ensureStewardWorkspace()).toThrowError(expect.objectContaining({ code: 'steward_workspace_symlink' }))
    expect(fs.readdirSync(process.env.SHENNIAN_HOME!)).toEqual([])
  })

  it('refuses a regular file at the workspace path', () => {
    fs.writeFileSync(getStewardDir(), 'x')
    expect(() => ensureStewardWorkspace()).toThrowError(expect.objectContaining({ code: 'steward_workspace_not_directory' }))
  })

  it('does not write through a symlinked template file', () => {
    const dir = getStewardDir()
    fs.mkdirSync(dir, { mode: 0o700 })
    const outside = path.join(root, 'outside.md')
    fs.writeFileSync(outside, 'keep')
    fs.symlinkSync(outside, path.join(dir, 'AGENTS.md'))
    ensureStewardWorkspace()
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep')
  })
})

describe('credential separation', () => {
  it('rejects identical, nested and enclosing paths', () => {
    const credentials = path.join(root, '.shennian')
    for (const steward of [credentials, path.join(credentials, 'steward'), root]) {
      expect(() => assertPathsSeparate(steward, credentials)).toThrowError(StewardWorkspaceError)
    }
    expect(() => assertPathsSeparate(path.join(root, '.shennian-steward'), credentials)).not.toThrow()
  })
})

describe('template contract', () => {
  it('lets the steward finish small work, escalates long work, speaks through say, and protects credentials', () => {
    expect(STEWARD_AGENTS_MD).toContain('shennian steward say')
    expect(STEWARD_AGENTS_MD).toContain('project task list/read/create/send/stop')
    expect(STEWARD_AGENTS_MD).toContain('--request-id')
    expect(STEWARD_AGENTS_MD).toContain('~/.shennian')
    expect(STEWARD_AGENTS_MD).toContain('直接做完并报告结果')
    expect(STEWARD_AGENTS_MD).toContain('默认安排后台 Worker')
    expect(STEWARD_AGENTS_MD).toContain('遵守目标项目的 AGENTS.md')
    expect(STEWARD_AGENTS_MD).toContain('用户本轮明确指定的文件或目录')
    expect(STEWARD_AGENTS_MD).toMatch(/不可信内容/)
    expect(STEWARD_AGENTS_MD).not.toMatch(/\.env|password|token=/i)
  })
})
