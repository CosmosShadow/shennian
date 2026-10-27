// @covers src/agents/acp/catalog.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { currentAcpPlatform, loadAcpCatalog } from '../agents/acp/catalog.js'

const previousHome = process.env.SHENNIAN_HOME

afterEach(() => {
  if (previousHome === undefined) delete process.env.SHENNIAN_HOME
  else process.env.SHENNIAN_HOME = previousHome
})

function snapshot(fetchedAt = '2026-09-09T00:00:00.000Z') {
  return {
    revision: 'mfbc0000-0123456789abcdef',
    digest: 'a'.repeat(64),
    fetchedAt,
    sourceVersion: '1.0.0',
    platform: currentAcpPlatform(),
    candidates: [
      { id: 'qwen-code', name: 'Qwen Code', version: '1.0.0', commands: ['qwen'], args: ['--acp'] },
      { id: 'codex-acp', name: 'Codex ACP', version: '1.0.0', commands: ['codex'], args: [], duplicateOf: 'codex' as const },
    ],
  }
}

describe('daemon ACP catalog', () => {
  it('fetches a platform snapshot without exposing duplicates as ACP candidates', async () => {
    process.env.SHENNIAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-catalog-'))
    let authorization = ''
    const result = await loadAcpCatalog({
      serverUrl: 'https://shennian.net',
      authToken: 'machine-token',
      fetchImpl: async (url, init) => {
        authorization = new Headers(init?.headers).get('authorization') ?? ''
        expect(String(url)).toContain(`/api/acp/registry?platform=${currentAcpPlatform()}`)
        return new Response(JSON.stringify(snapshot()), { status: 200 })
      },
    })
    expect(authorization).toBe('Bearer machine-token')
    expect(result.candidates).toEqual([{
      id: 'qwen-code', name: 'Qwen Code', source: 'registry',
      launch: { command: 'qwen', args: ['--acp'] },
    }])
  })

  it('falls back to the last-known-good cache when Server is unavailable', async () => {
    process.env.SHENNIAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-catalog-'))
    await loadAcpCatalog({
      serverUrl: 'https://shennian.net', authToken: 'token',
      fetchImpl: async () => new Response(JSON.stringify(snapshot())),
    })
    const cached = await loadAcpCatalog({
      serverUrl: 'https://shennian.net', authToken: 'token',
      fetchImpl: async () => { throw new Error('offline') },
    })
    expect(cached.revision).toBe('mfbc0000-0123456789abcdef')
    expect(cached.candidates[0]?.id).toBe('qwen-code')
  })

  it('does not replace a newer last-known-good snapshot with a revision rollback', async () => {
    process.env.SHENNIAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-catalog-'))
    await loadAcpCatalog({
      serverUrl: 'https://shennian.net', authToken: 'token',
      fetchImpl: async () => new Response(JSON.stringify(snapshot('2026-09-09T00:00:00.000Z'))),
    })
    const result = await loadAcpCatalog({
      serverUrl: 'https://shennian.net', authToken: 'token',
      fetchImpl: async () => new Response(JSON.stringify(snapshot('2026-09-08T00:00:00.000Z'))),
    })
    expect(result.revision).toBe('mfbc0000-0123456789abcdef')
    expect(result.candidates[0]?.id).toBe('qwen-code')
  })
})
