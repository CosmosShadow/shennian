// @covers src/personal-workspace/service.ts
// @covers src/steward/configure.ts
// @covers src/steward/settings.ts
// @covers src/session/handlers/personal-workspace.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configurePersonalPaths } from '../steward/configure.js'
import { getStewardDir, ensureStewardWorkspace } from '../steward/workspace.js'
import { readPersonalPaths } from '../steward/settings.js'
import { personalWorkspace } from '../personal-workspace/service.js'
import { handlePersonalWorkspace } from '../session/handlers/personal-workspace.js'
let root: string, previous: string | undefined
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'personal-workspace-'))); previous = process.env.SHENNIAN_HOME; process.env.SHENNIAN_HOME = path.join(root, '.client'); configurePersonalPaths({ workspace: path.join(root, 'agent'), diary: path.join(root, 'diary') }) })
afterEach(() => { if (previous === undefined) delete process.env.SHENNIAN_HOME; else process.env.SHENNIAN_HOME = previous; fs.rmSync(root, { recursive: true, force: true }) })
const call = (action: string, path = '', kind = 'memory', offset = 0) => personalWorkspace({ action, kind, path, offset }) as { entries: { name: string; path: string; title?: string; date?: string; summary?: string }[]; content: string; nextOffset: number | null }
describe('personal workspace configuration and bounded read-only files', () => {
  it('persists independent directories without reading or replacing Client identity', () => {
    const config = path.join(process.env.SHENNIAN_HOME!, 'config.json'); fs.writeFileSync(config, 'do-not-touch')
    expect(getStewardDir()).toBe(path.join(root, 'agent'))
    expect(readPersonalPaths().diary).toBe(path.join(root, 'diary'))
    ensureStewardWorkspace(); expect(fs.readFileSync(config, 'utf8')).toBe('do-not-touch')
    expect(() => configurePersonalPaths({ workspace: process.env.SHENNIAN_HOME! })).toThrow()
    expect(() => configurePersonalPaths({ diary: root })).toThrow()
    expect(() => configurePersonalPaths({ diary: 'relative' })).toThrow()
    const diary = readPersonalPaths().diary!
    configurePersonalPaths({ clearDiary: true }); expect(readPersonalPaths().diary).toBeUndefined(); expect(fs.existsSync(diary)).toBe(true)
    configurePersonalPaths({ diary })
    fs.symlinkSync(path.join(root, 'agent'), path.join(root, 'link'))
    expect(() => configurePersonalPaths({ workspace: path.join(root, 'link', 'child') })).toThrow()
  })
  it('prepares a changed directory before saving it, preserves edits, and leaves the previous directory intact', () => {
    const old = getStewardDir(), next = path.join(root, 'new-agent')
    fs.mkdirSync(next); fs.writeFileSync(path.join(next, 'AGENTS.md'), '# My rules')
    configurePersonalPaths({ workspace: next })
    expect(getStewardDir()).toBe(next)
    expect(fs.readdirSync(next).sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'index.md'])
    expect(fs.readFileSync(path.join(next, 'AGENTS.md'), 'utf8')).toBe('# My rules')
    expect(fs.existsSync(path.join(old, 'index.md'))).toBe(true)
    const invalid = path.join(root, 'broken-agent')
    fs.mkdirSync(invalid)
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('permission denied') })
    try { expect(() => configurePersonalPaths({ workspace: invalid })).toThrow() } finally { write.mockRestore() }
    expect(getStewardDir()).toBe(next)
  })
  it('keeps legacy defaults and fails closed on corrupted settings', () => {
    fs.unlinkSync(path.join(process.env.SHENNIAN_HOME!, 'personal-paths.json'))
    expect(getStewardDir()).toBe(`${process.env.SHENNIAN_HOME}-steward`)
    fs.writeFileSync(path.join(process.env.SHENNIAN_HOME!, 'personal-paths.json'), 'invalid')
    expect(() => getStewardDir()).toThrow('personal_settings_invalid')
  })
  it('lists directories and text, never follows hidden files or external links', () => {
    const agent = getStewardDir(); fs.writeFileSync(path.join(agent, 'note.md'), '# Hello'); fs.mkdirSync(path.join(agent, 'people')); fs.writeFileSync(path.join(agent, '.env'), 'secret'); fs.writeFileSync(path.join(agent, 'access-token.json'), 'secret'); fs.symlinkSync(path.join(root, 'diary'), path.join(agent, 'diary-link'))
    expect(call('list').entries.map(e => e.name)).toEqual(['people', ...['AGENTS.md', 'CLAUDE.md', 'index.md', 'note.md'].sort((a, b) => a.localeCompare(b))])
    expect(call('read', 'note.md').content).toBe('# Hello')
    for (const item of ['../diary', '/etc/passwd', '.env', 'people/../note.md', 'diary-link/x.md', 'access-token.json', 'people\\x.md']) expect(() => call('read', item)).toThrow()
    fs.writeFileSync(path.join(agent, 'image.png'), 'binary'); expect(() => call('read', 'image.png')).toThrow('personal_text_only')
    fs.writeFileSync(path.join(agent, 'large.md'), 'a'.repeat(512 * 1024 + 1)); expect(() => call('read', 'large.md')).toThrow('personal_file_too_large')
    expect(() => personalWorkspace({ action: 'write', kind: 'memory', path: 'note.md' })).toThrow()
    expect(() => personalWorkspace({ action: 'list', kind: 'memory', rootPath: '/' })).toThrow()
  })
  it('paginates memory and diaries, extracts actual headings and preserves the files', () => {
    const agent = getStewardDir(), diary = readPersonalPaths().diary!; fs.mkdirSync(path.join(diary, '2026'))
    for (let n = 0; n < 101; n++) fs.writeFileSync(path.join(agent, `note-${n}.md`), 'x')
    expect(call('list').entries).toHaveLength(100); expect(call('list').nextOffset).toBe(100); expect(call('list', '', 'memory', 100).entries).toHaveLength(4)
    for (let n = 1; n <= 31; n++) fs.writeFileSync(path.join(diary, `2026/2026-01-${String(n).padStart(2, '0')}.md`), `# 日期｜标题${n}\n> 概要：记录${n}\n\n正文`)
    fs.writeFileSync(path.join(diary, 'index.md'), '# Not a diary'); fs.writeFileSync(path.join(diary, '2026/2026-02-31.md'), 'invalid')
    const result = call('diary', '', 'diary'); expect(result.entries).toHaveLength(30); expect(result.nextOffset).toBe(30); expect(result.entries[0]).toMatchObject({ date: '2026-01-31', title: '日期｜标题31', summary: '记录31' })
    expect(call('diary', '', 'diary', 30).entries).toHaveLength(1)
    expect(call('read', result.entries[0]!.path, 'diary').content).toContain('正文')
    expect(() => call('read', 'index.md', 'diary')).toThrow('personal_path_forbidden')
    expect(() => call('list', '', 'diary')).toThrow('personal_invalid_request')
  })
  it('returns controlled errors, never absolute paths or file contents in failures', async () => {
    let result: unknown
    await handlePersonalWorkspace({ client: { sendRes: (v: unknown) => { result = v } } } as never, { id: 'r', params: { action: 'read', kind: 'memory', path: 'missing.md' } } as never)
    expect(result).toEqual({ type: 'res', id: 'r', ok: false, error: 'personal_directory_unavailable' })
  })
})

// @covers src/steward/primary-machine.ts
import { primaryMachineRequest } from '../steward/primary-machine.js'
import { saveConfig } from '../config/index.js'
it('binds primary selection to the paired machine and keeps credentials out of its result', async () => {
  saveConfig({ machineId: 'unit-machine', machineToken: 'unit-only', serverUrl: 'https://shennian.net' })
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ machine: { id: 'unit-machine', name: 'Unit Mac', online: true }, revision: 1 })))
  const result = await primaryMachineRequest({ expectedRevision: 0, confirmed: true }, fetcher as typeof fetch)
  expect(fetcher).toHaveBeenCalledWith('https://shennian.net/api/personal-workspace/primary-machine-cli', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedRevision: 0, confirmed: true, machineId: 'unit-machine' }) }))
  expect(result).toEqual({ machine: { id: 'unit-machine', name: 'Unit Mac', online: true }, revision: 1 })
})

it('exposes Worker defaults and only discovered external-capable targets, without persisting runtime metadata', () => {
  expect(personalWorkspace({ action: 'worker_info' }, [
    { type: 'codex', supportsExternalWorkerTarget: true, models: [{ id: 'm', name: 'Model' }] },
    { type: 'shennian', supportsExternalWorkerTarget: false, models: [] },
  ] as never)).toEqual({ agentType: 'shennian', modelId: null, defaultWorkDir: getStewardDir(), agents: [{ type: 'codex', models: [{ id: 'm', name: 'Model' }] }] })
  expect(personalWorkspace({ action: 'worker_set', settings: { agentType: 'codex', modelId: null } })).toEqual({ agentType: 'codex', modelId: null })
  expect(() => personalWorkspace({ action: 'worker_set', settings: { agentType: 'codex', modelId: null, secret: 'not-allowed' } })).toThrow('personal_worker_settings_invalid')
  expect(() => personalWorkspace({ action: 'worker_info', path: '/elsewhere' })).toThrow('personal_invalid_request')
})

it('advertises diary replica support and revisions; edits only existing diary files with exact CAS', () => {
  const diary = readPersonalPaths().diary!, relative = '2026/2026-10-23.md'
  fs.mkdirSync(path.join(diary, '2026')); fs.writeFileSync(path.join(diary, relative), '# Original\nBody')
  expect(personalWorkspace({ action: 'info' })).toMatchObject({ diarySync: 1, diaryEdit: 1 })
  const original = personalWorkspace({ action: 'read', kind: 'diary', path: relative }) as { content: string; revision: string }
  const list = personalWorkspace({ action: 'diary', kind: 'diary' }) as { snapshot: string; entries: { revision: string }[] }
  expect(list.entries[0]?.revision).toBe(original.revision)
  const write = (content: unknown, expectedRevision = original.revision, file = relative, kind = 'diary') => personalWorkspace({ action: 'diary_write', kind, path: file, content, expectedRevision })
  expect(() => write('new', '0'.repeat(64))).toThrow('personal_file_changed')
  expect(fs.readFileSync(path.join(diary, relative), 'utf8')).toBe(original.content)
  const updated = write('# Edited\nNew body') as { content: string; revision: string }
  expect(updated.content).toBe('# Edited\nNew body'); expect(updated.revision).not.toBe(original.revision)
  expect(fs.readFileSync(path.join(diary, relative), 'utf8')).toBe(updated.content)
  expect((personalWorkspace({ action: 'diary', kind: 'diary' }) as { snapshot: string }).snapshot).not.toBe(list.snapshot)
  expect(() => write('overwrite')).toThrow('personal_file_changed')
  expect(() => write('x'.repeat(512 * 1024 + 1))).toThrow('personal_file_too_large')
  expect(() => write('secret', original.revision, '../file.md')).toThrow('personal_path_forbidden')
  expect(() => write('x', original.revision, relative, 'memory')).toThrow('personal_path_forbidden')
  expect(() => write('x', original.revision, '2026/2026-02-31.md')).toThrow('personal_path_forbidden')
  fs.symlinkSync(path.join(diary, relative), path.join(diary, '2026/2026-10-24.md'))
  expect(() => write('x', original.revision, '2026/2026-10-24.md')).toThrow('personal_path_forbidden')
  expect(fs.readdirSync(path.join(diary, '2026')).filter(n => n.startsWith('.diary-'))).toEqual([])
})

it('reads memory info/list/content without evaluating the synchronous Agent catalog', async () => {
  fs.writeFileSync(path.join(getStewardDir(), 'note.md'), '# Unit memory')
  const getAgentSnapshot = vi.fn(() => { throw new Error('catalog must not block filesystem requests') })
  const sendRes = vi.fn()
  for (const params of [{ action: 'info' }, { action: 'list', kind: 'memory', path: '' }, { action: 'read', kind: 'memory', path: 'note.md' }]) {
    await handlePersonalWorkspace({ client: { sendRes }, getAgentSnapshot } as never, { id: 'memory-unit', params } as never)
    expect(sendRes).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true }))
  }
  expect(getAgentSnapshot).not.toHaveBeenCalled()
})
it('still supplies the Agent catalog when worker settings explicitly request it', async () => {
  const getAgentSnapshot = vi.fn(() => [{ type: 'shennian', supportsExternalWorkerTarget: true, models: [{ id: 'unit-model', name: 'Unit' }] }])
  const sendRes = vi.fn()
  await handlePersonalWorkspace({ client: { sendRes }, getAgentSnapshot } as never, { id: 'worker-unit', params: { action: 'worker_info' } } as never)
  expect(getAgentSnapshot).toHaveBeenCalledOnce()
  expect(sendRes).toHaveBeenCalledWith(expect.objectContaining({ ok: true, payload: expect.objectContaining({ agents: [{ type: 'shennian', models: [{ id: 'unit-model', name: 'Unit' }] }] }) }))
})
