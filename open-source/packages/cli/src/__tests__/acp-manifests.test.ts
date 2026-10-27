// @covers src/agents/acp/manifests.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAcpManifests, validateAcpManifest, writeAcpManifest } from '../agents/acp/manifests.js'

describe('ACP local manifests', () => {
  it('round-trips a strict secret-free v1 manifest', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-manifest-'))
    writeAcpManifest({
      schemaVersion: 1,
      id: 'company-agent',
      name: 'Company Agent',
      protocol: 'acp',
      command: '/usr/local/bin/company-agent',
      args: ['serve', '--acp'],
      enabled: true,
      clientCapabilities: { readTextFile: true, writeTextFile: false, terminal: false },
    }, directory)
    expect(readAcpManifests(directory)).toEqual([{
      id: 'company-agent',
      name: 'Company Agent',
      source: 'local',
      launch: { command: '/usr/local/bin/company-agent', args: ['serve', '--acp'] },
      clientCapabilities: { readTextFile: true, writeTextFile: false, terminal: false },
    }])
    if (process.platform !== 'win32') {
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700)
      expect(fs.statSync(path.join(directory, 'company-agent.json')).mode & 0o777).toBe(0o600)
    }
  })

  it('rejects secrets, mixed-case ids, traversal commands, NUL, and unknown fields', () => {
    const base = {
      schemaVersion: 1, id: 'agent', name: 'Agent', protocol: 'acp', command: 'agent', enabled: true,
    } as const
    expect(() => validateAcpManifest({ ...base, apiKey: 'secret' })).toThrow()
    expect(() => validateAcpManifest({ ...base, id: 'MixedCase' })).toThrow()
    expect(() => validateAcpManifest({ ...base, command: '../agent' })).toThrow()
    expect(() => validateAcpManifest({ ...base, args: ['bad\0arg'] })).toThrow()
  })

  it('isolates malformed and oversized files from valid Agents', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-manifest-'))
    fs.writeFileSync(path.join(directory, 'bad.json'), '{')
    fs.writeFileSync(path.join(directory, 'huge.json'), ' '.repeat(70 * 1024))
    writeAcpManifest({
      schemaVersion: 1, id: 'good', name: 'Good', protocol: 'acp', command: 'good', args: [], enabled: true,
    }, directory)
    expect(readAcpManifests(directory).map((item) => item.id)).toEqual(['good'])
  })
})
