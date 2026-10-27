// @covers src/agents/native-capabilities.ts
// @covers src/session/handlers/agent-capabilities.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listAgentNativeCapabilities } from '../agents/native-capabilities.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-capabilities-'))
  roots.push(root)
  const homeDir = path.join(root, 'home')
  const workDir = path.join(root, 'repo', 'packages', 'app')
  fs.mkdirSync(homeDir, { recursive: true })
  fs.mkdirSync(workDir, { recursive: true })
  return { root, homeDir, workDir }
}

function skill(directory: string, name: string, description = `${name} description`) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBody is private.\n`)
}

describe('native Agent capability discovery', () => {
  it('discovers Codex project, personal and system skills with native invocations', () => {
    const { root, homeDir, workDir } = fixture()
    skill(path.join(root, 'repo', '.agents', 'skills', 'review'), 'review')
    skill(path.join(homeDir, '.agents', 'skills', 'deploy'), 'deploy')
    skill(path.join(homeDir, '.codex', 'skills', '.system', 'skill-installer'), 'skill-installer')

    const capabilities = listAgentNativeCapabilities({ agentType: 'codex', workDir, homeDir })
    expect(capabilities.map((item) => [item.invocation, item.source])).toEqual([
      ['$deploy', 'personal'],
      ['$review', 'project'],
      ['$skill-installer', 'system'],
    ])
    expect(JSON.stringify(capabilities)).not.toContain(homeDir)
    expect(JSON.stringify(capabilities)).not.toContain('Body is private')
  })

  it('prefers a Claude project skill when its invocation shadows a personal skill', () => {
    const { root, homeDir, workDir } = fixture()
    skill(path.join(homeDir, '.claude', 'skills', 'docs'), 'docs', 'personal')
    skill(path.join(root, 'repo', '.claude', 'skills', 'docs'), 'docs', 'project')

    const capabilities = listAgentNativeCapabilities({ agentType: 'claude', workDir, homeDir })
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]).toMatchObject({ invocation: '/docs', source: 'project', description: 'project' })
  })

  it('discovers WorkBuddy plugin skills only from registered plugin cache paths', () => {
    const { homeDir, workDir } = fixture()
    const pluginRoot = path.join(homeDir, '.codebuddy', 'plugins')
    const installPath = path.join(pluginRoot, 'cache', 'official', 'browser', '1.0.0')
    skill(path.join(installPath, 'skills', 'browse'), 'browse')
    fs.mkdirSync(pluginRoot, { recursive: true })
    fs.writeFileSync(path.join(pluginRoot, 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'browser@official': [{ installPath }],
        'unsafe@official': [{ installPath: path.join(homeDir, 'outside') }],
      },
    }))

    const capabilities = listAgentNativeCapabilities({ agentType: 'workbuddy', workDir, homeDir })
    expect(capabilities).toEqual([
      expect.objectContaining({
        name: 'browse',
        kind: 'plugin_skill',
        source: 'plugin',
        invocation: '/browser:browse',
      }),
    ])
  })

  it('returns no capabilities for unsupported agents', () => {
    const { homeDir, workDir } = fixture()
    skill(path.join(homeDir, '.gemini', 'skills', 'hidden'), 'hidden')
    expect(listAgentNativeCapabilities({ agentType: 'gemini', workDir, homeDir })).toEqual([])
  })
})
