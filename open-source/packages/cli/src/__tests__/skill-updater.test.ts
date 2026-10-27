// @covers src/skill/updater.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  OFFICIAL_SKILL_MANIFEST_URL,
  OFFICIAL_SKILL_URL,
  SKILL_CHECK_INTERVAL_MS,
  updateOfficialSkill,
} from '../skill/updater.js'

const skill = (version: string, body = '# 神念\n') =>
  `---\nname: shennian\ndescription: test\nversion: ${version}\nminimum_client_version: 0.5.5\nmaximum_client_version: null\n---\n\n${body}`
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex')

function fixture(initial = skill('0.5.5')) {
  const unitRoot = path.join(os.tmpdir(), 'shennian-tests', 'unit')
  fs.mkdirSync(unitRoot, { recursive: true })
  const root = fs.mkdtempSync(path.join(unitRoot, 'skill-update-'))
  const directory = path.join(root, 'shennian')
  fs.mkdirSync(directory)
  const target = path.join(directory, 'SKILL.md')
  const registryPath = path.join(root, 'state', 'skill-updates.json')
  fs.writeFileSync(target, initial)
  return { root, target, registryPath }
}

function officialFetch(content: string, overrides: Record<string, unknown> = {}, previousSkills?: Array<{ version: string; sha256: string }>) {
  const manifest = {
    schemaVersion: 1,
    product: 'shennian',
    skill: {
      name: 'shennian',
      version: /^version:\s*([^\s]+)/m.exec(content)![1],
      url: OFFICIAL_SKILL_URL,
      sha256: digest(content),
      minimumClientVersion: '0.5.5',
      maximumClientVersion: null,
      ...overrides,
    },
    ...(previousSkills ? { previousSkills } : {}),
  }
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === OFFICIAL_SKILL_MANIFEST_URL) {
      return new Response(JSON.stringify(manifest), { status: 200 })
    }
    if (url === OFFICIAL_SKILL_URL) return new Response(content, { status: 200 })
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
}

describe('official Skill updater', () => {
  it('does not downgrade a newer local Skill while the public Web Skill lags behind', async () => {
    const local = skill('0.5.18')
    const test = fixture(local)
    try {
      const olderFetch = officialFetch(skill('0.5.17'))
      const result = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.18', fetchImpl: olderFetch, registryPath: test.registryPath, now: 100,
      })
      expect(result).toMatchObject({ status: 'remote_older', remoteVersion: '0.5.17' })
      expect(fs.readFileSync(test.target, 'utf8')).toBe(local)
      expect(olderFetch).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('registers an exact official copy and reuses the 24-hour cache without networking', async () => {
    const test = fixture()
    try {
      const fetchImpl = officialFetch(fs.readFileSync(test.target, 'utf8'))
      const first = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl, registryPath: test.registryPath, now: 100,
      })
      expect(first.status).toBe('registered')
      expect(fetchImpl).toHaveBeenCalledTimes(1)

      const second = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl, registryPath: test.registryPath, now: 100 + SKILL_CHECK_INTERVAL_MS - 1,
      })
      expect(second).toMatchObject({ status: 'registered', checked: false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('atomically updates only an unchanged registered copy after integrity validation', async () => {
    const test = fixture()
    try {
      await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl: officialFetch(skill('0.5.5')), registryPath: test.registryPath, now: 100,
      })
      const next = skill('0.5.6', '# 新版\n')
      const result = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl: officialFetch(next), registryPath: test.registryPath,
        now: 100 + SKILL_CHECK_INTERVAL_MS,
      })
      expect(result.status).toBe('updated')
      expect(fs.readFileSync(test.target, 'utf8')).toBe(next)
      expect(fs.readdirSync(path.dirname(test.target))).toEqual(['SKILL.md'])
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('updates an unregistered exact older official copy without --replace', async () => {
    const old = skill('0.5.5')
    const next = skill('0.5.6', '# 新版\n')
    const test = fixture(old)
    try {
      const fetchImpl = officialFetch(next, {}, [{ version: '0.5.5', sha256: digest(old) }])
      const result = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.6', fetchImpl, registryPath: test.registryPath, now: 100,
      })
      expect(result.status).toBe('updated')
      expect(fs.readFileSync(test.target, 'utf8')).toBe(next)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('preserves an unregistered modified copy even when its version is trusted', async () => {
    const old = skill('0.5.5')
    const test = fixture(`${old}\nuser edit\n`)
    try {
      const result = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.6',
        fetchImpl: officialFetch(skill('0.5.6'), {}, [{ version: '0.5.5', sha256: digest(old) }]),
        registryPath: test.registryPath,
      })
      expect(result.status).toBe('manual_update_required')
      expect(fs.readFileSync(test.target, 'utf8')).toContain('user edit')
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('checks again after Client changes even when the 24-hour cache is fresh', async () => {
    const test = fixture()
    try {
      const firstFetch = officialFetch(skill('0.6.0'), { minimumClientVersion: '0.6.0' })
      expect((await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl: firstFetch, registryPath: test.registryPath, now: 100,
      })).status).toBe('client_incompatible')
      const secondFetch = officialFetch(skill('0.6.0'), { minimumClientVersion: '0.6.0' })
      const result = await updateOfficialSkill(test.target, {
        clientVersion: '0.6.0', fetchImpl: secondFetch, registryPath: test.registryPath, now: 101,
      })
      expect(result.checked).toBe(true)
      expect(secondFetch).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('preserves local modifications and gives an explicit manual replacement command', async () => {
    const test = fixture()
    try {
      await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl: officialFetch(skill('0.5.5')), registryPath: test.registryPath, now: 100,
      })
      fs.appendFileSync(test.target, '\n用户修改\n')
      const result = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl: officialFetch(skill('0.5.6')), registryPath: test.registryPath,
        now: 100 + SKILL_CHECK_INTERVAL_MS,
      })
      expect(result).toMatchObject({ status: 'local_modified', officialUrl: OFFICIAL_SKILL_URL })
      expect(result.manualCommand).toContain('--replace')
      expect(fs.readFileSync(test.target, 'utf8')).toContain('用户修改')
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('fails safely for incompatible or tampered official metadata', async () => {
    const test = fixture()
    try {
      const incompatibleFetch = officialFetch(skill('0.6.0'), { minimumClientVersion: '0.6.0' })
      const incompatible = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5',
        fetchImpl: incompatibleFetch,
        registryPath: test.registryPath,
        now: 100,
      })
      expect(incompatible.status).toBe('client_incompatible')
      const cached = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl: incompatibleFetch, registryPath: test.registryPath, now: 101,
      })
      expect(cached).toMatchObject({ status: 'client_incompatible', checked: false })
      expect(incompatibleFetch).toHaveBeenCalledTimes(1)

      const tamperedFetch = officialFetch(skill('0.5.5'), { sha256: '0'.repeat(64) })
      const tampered = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5', fetchImpl: tamperedFetch, registryPath: test.registryPath,
        now: 100, replace: true,
      })
      expect(tampered.status).toBe('check_failed')
      expect(fs.readFileSync(test.target, 'utf8')).toBe(skill('0.5.5'))
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('reuses an incompatible manifest failure for a registered target without refetching', async () => {
    const test = fixture()
    try {
      await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5',
        fetchImpl: officialFetch(skill('0.5.5')),
        registryPath: test.registryPath,
        now: 100,
      })

      const incompatibleFetch = officialFetch(skill('0.6.0'), {
        minimumClientVersion: '0.6.0',
      })
      const checkedAt = 100 + SKILL_CHECK_INTERVAL_MS
      const incompatible = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5',
        fetchImpl: incompatibleFetch,
        registryPath: test.registryPath,
        now: checkedAt,
      })
      expect(incompatible).toMatchObject({
        status: 'client_incompatible',
        checked: true,
        officialUrl: OFFICIAL_SKILL_URL,
      })
      expect(incompatible.manualCommand).toContain('--replace')

      const cached = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5',
        fetchImpl: incompatibleFetch,
        registryPath: test.registryPath,
        now: checkedAt + 1,
      })
      expect(cached).toMatchObject({
        status: 'client_incompatible',
        checked: false,
        officialUrl: OFFICIAL_SKILL_URL,
      })
      expect(cached.manualCommand).toContain('--replace')
      expect(incompatibleFetch).toHaveBeenCalledTimes(1)

      fs.appendFileSync(test.target, '\n用户修改\n')
      const modified = await updateOfficialSkill(test.target, {
        clientVersion: '0.5.5',
        fetchImpl: incompatibleFetch,
        registryPath: test.registryPath,
        now: checkedAt + 2,
      })
      expect(modified).toMatchObject({ status: 'local_modified' })
      expect(modified.manualCommand).toContain('--replace')
      expect(incompatibleFetch).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })

  it('rejects implicit paths and symlinks instead of scanning or following them', async () => {
    const test = fixture()
    const link = path.join(test.root, 'SKILL.md')
    try {
      fs.symlinkSync(test.target, link)
      await expect(updateOfficialSkill('SKILL.md', { clientVersion: '0.5.5' }))
        .rejects.toThrow('skill_path_must_be_absolute')
      await expect(updateOfficialSkill(link, { clientVersion: '0.5.5' }))
        .rejects.toThrow('skill_path_must_be_regular_file')
    } finally {
      fs.rmSync(test.root, { recursive: true, force: true })
    }
  })
})
