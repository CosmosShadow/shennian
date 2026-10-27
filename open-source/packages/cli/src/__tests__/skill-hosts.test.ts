// @covers src/skill/hosts.ts
// @covers src/skill/updater.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectSkillHostTargets, installSkillForHosts, refreshExistingSkillForHosts } from '../skill/hosts.js'
import { OFFICIAL_SKILL_MANIFEST_URL, OFFICIAL_SKILL_URL } from '../skill/updater.js'

const skill = `---\nname: shennian\ndescription: test\nversion: 0.5.20\n---\n\n# 神念\n`
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex')
const roots: string[] = []

function home(...dirs: string[]): string {
  const base = path.join(os.tmpdir(), 'shennian-tests', 'unit')
  fs.mkdirSync(base, { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'skill-hosts-'))
  roots.push(root)
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true })
  return root
}

const officialFetch = (async (url: string | URL | Request) => {
  const target = String(url)
  if (target === OFFICIAL_SKILL_MANIFEST_URL) {
    return new Response(JSON.stringify({
      schemaVersion: 1,
      product: 'shennian',
      skill: {
        name: 'shennian', version: '0.5.20', url: OFFICIAL_SKILL_URL, sha256: digest(skill),
        minimumClientVersion: '0.5.0', maximumClientVersion: null,
      },
    }))
  }
  if (target === OFFICIAL_SKILL_URL) return new Response(skill)
  throw new Error(`unexpected ${target}`)
}) as typeof fetch

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Skill host targets', () => {
  it('maps each detected tool to one user-level Skill directory', () => {
    const root = home('.claude', '.codex', '.cursor', '.qwen')
    const targets = detectSkillHostTargets(root)
    expect(targets.map((target) => [target.id, target.names, path.relative(root, target.path)])).toEqual([
      ['claude', ['Claude Code'], path.join('.claude', 'skills', 'shennian', 'SKILL.md')],
      ['agents', ['Codex', 'Cursor'], path.join('.agents', 'skills', 'shennian', 'SKILL.md')],
      ['qwen', ['Qwen Code'], path.join('.qwen', 'skills', 'shennian', 'SKILL.md')],
    ])
  })

  it('finds nothing when no AI tool has run on this computer', () => {
    expect(detectSkillHostTargets(home())).toEqual([])
  })

  it('does not add a second copy next to a Claude Code plugin install', () => {
    const root = home('.claude/plugins/cache/shennian/shennian/0.5.20/skills/shennian')
    fs.writeFileSync(path.join(root, '.claude/plugins/cache/shennian/shennian/0.5.20/skills/shennian/SKILL.md'), skill)
    expect(detectSkillHostTargets(root)).toEqual([])
  })
})

describe('installing the Skill for detected tools', () => {
  it('refreshes an existing official copy after a Client upgrade without installing missing copies', async () => {
    const root = home('.codex')
    const registryPath = path.join(root, 'state', 'skill-updates.json')
    const target = path.join(root, '.agents', 'skills', 'shennian', 'SKILL.md')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, skill)
    await installSkillForHosts({ clientVersion: '0.5.20', home: root, fetchImpl: officialFetch, registryPath })
    fs.mkdirSync(path.join(root, '.qwen'))
    const next = skill.replaceAll('0.5.20', '0.5.21')
    const nextFetch = (async (url: string | URL | Request) => String(url) === OFFICIAL_SKILL_MANIFEST_URL
      ? new Response(JSON.stringify({ schemaVersion: 1, product: 'shennian', skill: {
        name: 'shennian', version: '0.5.21', url: OFFICIAL_SKILL_URL,
        sha256: digest(next), minimumClientVersion: '0.5.21', maximumClientVersion: null,
      } }))
      : new Response(next)) as typeof fetch
    const results = await refreshExistingSkillForHosts({
      clientVersion: '0.5.21', home: root, fetchImpl: nextFetch, registryPath,
    })
    expect(results).toMatchObject([{ id: 'agents', ok: true, result: { status: 'updated' } }])
    expect(fs.readFileSync(target, 'utf8')).toBe(next)
    expect(fs.existsSync(path.join(root, '.qwen', 'skills', 'shennian', 'SKILL.md'))).toBe(false)
  })

  it('writes the verified official copy, then reports it current on the next run', async () => {
    const root = home('.codex')
    const registryPath = path.join(root, 'state', 'skill-updates.json')
    const first = await installSkillForHosts({ clientVersion: '0.5.20', home: root, fetchImpl: officialFetch, registryPath })
    expect(first).toMatchObject([{ id: 'agents', ok: true, result: { status: 'installed' } }])
    const target = path.join(root, '.agents', 'skills', 'shennian', 'SKILL.md')
    expect(fs.readFileSync(target, 'utf8')).toBe(skill)

    const second = await installSkillForHosts({ clientVersion: '0.5.20', home: root, fetchImpl: officialFetch, registryPath })
    expect(second).toMatchObject([{ ok: true, result: { status: 'current' } }])
  })

  it('never overwrites a copy the person changed', async () => {
    const root = home('.claude')
    const target = path.join(root, '.claude', 'skills', 'shennian', 'SKILL.md')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const edited = skill.replace('# 神念', '# 我的神念')
    fs.writeFileSync(target, edited)
    const results = await installSkillForHosts({
      clientVersion: '0.5.20', home: root, fetchImpl: officialFetch,
      registryPath: path.join(root, 'state', 'skill-updates.json'),
    })
    expect(results).toMatchObject([{ ok: true, result: { status: 'manual_update_required' } }])
    expect(fs.readFileSync(target, 'utf8')).toBe(edited)
  })

  it('reports a download failure without writing a partial file', async () => {
    const root = home('.qwen')
    const failing = (async () => { throw new Error('offline') }) as typeof fetch
    const results = await installSkillForHosts({
      clientVersion: '0.5.20', home: root, fetchImpl: failing,
      registryPath: path.join(root, 'state', 'skill-updates.json'),
    })
    expect(results).toMatchObject([{ id: 'qwen', ok: false }])
    expect(fs.existsSync(path.join(root, '.qwen', 'skills', 'shennian', 'SKILL.md'))).toBe(false)
  })
})
