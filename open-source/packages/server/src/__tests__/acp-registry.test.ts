// @covers src/services/acp-registry.ts

import { describe, expect, it, vi } from 'vitest'
import type { AcpRegistryStore } from '../services/acp-registry.js'
import { ACP_REGISTRY_URL, getAcpRegistryMetrics, getAcpRegistrySnapshot, getPublicAcpAgentCatalog, recordAcpDaemonCatalogRevision, refreshAcpRegistry, rollbackAcpRegistry } from '../services/acp-registry.js'

class MemoryStore implements AcpRegistryStore {
  values = new Map<string, string>()
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: string) { this.values.set(key, value); return 'OK' }
}

function registryResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers })
}

const document = {
  version: '1.0.0',
  extensions: [],
  agents: [
    {
      id: 'qwen-code', name: 'Qwen Code', version: '0.23.0', description: 'Qwen coding agent', website: 'https://qwen.ai', license_url: 'https://example.test/qwen-license',
      distribution: { npx: { package: '@qwen-code/qwen-code', args: ['--acp', '--experimental-skills'] } },
    },
    {
      id: 'kimi', name: 'Kimi CLI', version: '1.50.0', description: 'Kimi coding agent', repository: 'https://github.com/MoonshotAI/kimi-cli', license_url: 'https://example.test/kimi-license',
      distribution: { binary: { 'darwin-aarch64': { archive: 'https://example.test/kimi.zip', cmd: './kimi', args: ['acp'] } } },
    },
  ],
}

describe('ACP Registry mirror', () => {
  it('keeps both installed Qoder commands when the official Registry supersedes the supplement', async () => {
    const store = new MemoryStore()
    await refreshAcpRegistry({ store, fetchImpl: async () => registryResponse({
      version: '1.0.0', agents: [{
        id: 'qoder', name: 'Qoder CLI', version: '0.2.14', description: 'Qoder',
        website: 'https://qoder.com', license_url: 'https://example.test/license',
        distribution: { npx: { package: '@qoder-ai/qodercli', args: ['--acp'] } },
      }],
    }) })
    const candidates = (await getAcpRegistrySnapshot('darwin-aarch64', store))?.candidates.filter(candidate => candidate.id === 'qoder')
    expect(candidates).toEqual([expect.objectContaining({
      version: '0.2.14', commands: ['qoder', 'qoderclicn', 'qodercli'], args: ['--acp'],
      npmPackage: '@qoder-ai/qodercli', website: 'https://qoder.com',
    })])
  })

  it('keeps a version-pinned uvx provider in both discovery and the public directory', async () => {
    const store = new MemoryStore()
    await refreshAcpRegistry({store, fetchImpl: async () => registryResponse({version:'1.0.0', agents:[{
      id:'fast-agent', name:'fast-agent', version:'0.10.1', description:'Provider', license_url:'https://example.test/license',
      distribution:{uvx:{package:'fast-agent-acp==0.10.1',args:['-x']}},
    }]})})
    const snapshot = await getAcpRegistrySnapshot('darwin-aarch64',store)
    expect(snapshot?.candidates.find(candidate => candidate.id === 'fast-agent')).toMatchObject({id:'fast-agent',commands:['fast-agent-acp'],uvPackage:'fast-agent-acp==0.10.1'})
    const catalog = await getPublicAcpAgentCatalog(store)
    expect(catalog?.agents.map(agent => agent.id)).toEqual(['dsh', 'fast-agent', 'qoder'])
    expect(JSON.stringify(catalog)).not.toMatch(/commands|uvPackage|args/)
  })

  it('fetches only the fixed official URL and builds platform-minimal snapshots', async () => {
    const store = new MemoryStore()
    let requestedUrl = ''
    const result = await refreshAcpRegistry({
      store,
      now: new Date('2026-09-09T00:00:00Z'),
      fetchImpl: async (url) => {
        requestedUrl = String(url)
        return registryResponse(document, { etag: '"revision-1"' })
      },
    })
    expect(requestedUrl).toBe(ACP_REGISTRY_URL)
    expect(result.changed).toBe(true)
    expect(getAcpRegistryMetrics(new Date('2026-09-09T00:01:00Z'))).toMatchObject({
      lastKnownGoodAgeSeconds: 60,
    })
    const darwin = await getAcpRegistrySnapshot('darwin-aarch64', store)
    expect(darwin).toMatchObject({ sourceVersion: '1.0.0', fetchedAt: '2026-09-09T00:00:00.000Z' })
    expect(darwin?.candidates).toEqual([
      expect.objectContaining({ id: 'dsh', commands: ['dsh'], args: ['--profile', 'acp'], npmPackage: '@deepseek-ai/dsh' }),
      expect.objectContaining({ id: 'kimi', commands: ['kimi'], args: ['acp'] }),
      expect.objectContaining({ id: 'qoder', commands: ['qoder', 'qoderclicn'], args: ['--acp'], npmPackage: '@qodercn-ai/qoderclicn' }),
      expect.objectContaining({ id: 'qwen-code', commands: ['qwen', 'qwen-code'], args: ['--acp'], npmPackage: '@qwen-code/qwen-code' }),
    ])
  })

  it('publishes only display-safe fields and merges platform availability', async () => {
    const store = new MemoryStore()
    await refreshAcpRegistry({
      store,
      now: new Date('2026-09-09T00:00:00Z'),
      fetchImpl: async () => registryResponse(document),
    })

    const catalog = await getPublicAcpAgentCatalog(store)
    expect(catalog).toMatchObject({ sourceVersion: '1.0.0', fetchedAt: '2026-09-09T00:00:00.000Z' })
    expect(catalog?.agents.find((agent) => agent.id === 'qwen-code')).toEqual({
      id: 'qwen-code',
      name: 'Qwen Code',
      version: '0.23.0',
      website: 'https://qwen.ai',
      platforms: [
        'darwin-aarch64', 'darwin-x86_64', 'linux-aarch64',
        'linux-x86_64', 'windows-aarch64', 'windows-x86_64',
      ],
    })
    expect(JSON.stringify(catalog)).not.toContain('commands')
    expect(JSON.stringify(catalog)).not.toContain('args')
    expect(JSON.stringify(catalog)).not.toContain('npmPackage')
  })

  it('uses validators before atomically replacing last-known-good', async () => {
    const store = new MemoryStore()
    await refreshAcpRegistry({ store, fetchImpl: async () => registryResponse(document) })
    const previous = await getAcpRegistrySnapshot('linux-x86_64', store)
    await expect(refreshAcpRegistry({
      store,
      fetchImpl: async () => registryResponse({ ...document, unexpected: true }),
    })).rejects.toThrow('official Schema')
    expect(await getAcpRegistrySnapshot('linux-x86_64', store)).toEqual(previous)
  })

  it('honors 304 and response size limits without clearing last-known-good', async () => {
    const store = new MemoryStore()
    await refreshAcpRegistry({ store, fetchImpl: async () => registryResponse(document, { etag: '"one"' }) })
    const notModified = await refreshAcpRegistry({
      store,
      fetchImpl: async (_url, init) => {
        expect(new Headers(init?.headers).get('if-none-match')).toBe('"one"')
        return new Response(null, { status: 304 })
      },
    })
    expect(notModified.changed).toBe(false)
    await expect(refreshAcpRegistry({
      store,
      fetchImpl: async () => new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
    })).rejects.toThrow('size limit')
    expect(await getAcpRegistrySnapshot('darwin-aarch64', store)).not.toBeNull()
  })

  it('drops unsafe URLs, commands, and arguments from the daemon catalog', async () => {
    const store = new MemoryStore()
    await refreshAcpRegistry({
      store,
      fetchImpl: async () => registryResponse({
        version: '1.0.0',
        agents: [{
          id: 'unsafe', name: 'Unsafe', version: '1.0.0', description: 'Unsafe test agent', website: 'http://127.0.0.1/private', license_url: 'https://example.test/license',
          distribution: { binary: { 'darwin-aarch64': { archive: 'https://example.test/unsafe.zip', cmd: '../../evil shell', args: ['ok', 'bad\0arg'] } } },
        }],
      }),
    })
    const snapshot = await getAcpRegistrySnapshot('darwin-aarch64', store)
    expect(snapshot?.candidates.map(candidate => candidate.id)).toEqual(['dsh', 'qoder'])
  })

  it('adds Shennian supplements on every platform unless the Registry lists or blocks the same id', async () => {
    const store = new MemoryStore()
    await refreshAcpRegistry({ store, fetchImpl: async () => registryResponse(document) })
    for (const platform of ['darwin-aarch64', 'linux-x86_64', 'windows-x86_64'] as const) {
      expect((await getAcpRegistrySnapshot(platform, store))?.candidates).toContainEqual(expect.objectContaining({ id: 'dsh' }))
    }
    expect((await getPublicAcpAgentCatalog(store))?.agents).toContainEqual(expect.objectContaining({ id: 'dsh', name: 'DSH' }))

    await refreshAcpRegistry({ store, fetchImpl: async () => registryResponse({ ...document, agents: [...document.agents, {
      id: 'dsh', name: 'DSH (official)', version: '9.0.0', description: 'DSH', license_url: 'https://example.test/license',
      distribution: { npx: { package: '@deepseek-ai/dsh', args: ['acp'] } },
    }] }) })
    const official = (await getAcpRegistrySnapshot('darwin-aarch64', store))?.candidates.filter(candidate => candidate.id === 'dsh')
    expect(official).toEqual([expect.objectContaining({ name: 'DSH (official)', args: ['acp'] })])

    const previous = process.env.ACP_REGISTRY_BLOCKED_IDS
    process.env.ACP_REGISTRY_BLOCKED_IDS = 'dsh'
    try {
      await refreshAcpRegistry({ store, fetchImpl: async () => registryResponse(document) })
      expect((await getAcpRegistrySnapshot('darwin-aarch64', store))?.candidates.map(candidate => candidate.id)).not.toContain('dsh')
    } finally {
      if (previous === undefined) delete process.env.ACP_REGISTRY_BLOCKED_IDS
      else process.env.ACP_REGISTRY_BLOCKED_IDS = previous
    }
  })

  it('rebuilds snapshots once after the supplement list changes, even when the Registry is unchanged', async () => {
    const store = new MemoryStore()
    // A cache written before supplements existed: validators present, no supplement digest.
    await store.set('catalog:acp:v1:etag', '"old"')
    const headers: Array<string | null> = []
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get('if-none-match'))
      return registryResponse(document, { etag: '"new"' })
    }
    await refreshAcpRegistry({ store, fetchImpl })
    await refreshAcpRegistry({ store, fetchImpl })
    expect(headers).toEqual([null, '"new"'])
  })

  it('rejects malformed nested distribution metadata without replacing cache', async () => {
    const store = new MemoryStore()
    await refreshAcpRegistry({ store, fetchImpl: async () => registryResponse(document) })
    const previous = await getAcpRegistrySnapshot('darwin-aarch64', store)
    await expect(refreshAcpRegistry({
      store,
      fetchImpl: async () => registryResponse({
        version: '1.0.0',
        agents: [{ id: 'bad', name: 'Bad', version: '1.0.0', description: 'Bad agent', license_url: 'https://example.test/license', distribution: { npx: { package: 7 } } }],
      }),
    })).rejects.toThrow('official Schema')
    expect(await getAcpRegistrySnapshot('darwin-aarch64', store)).toEqual(previous)
  })

  it('accepts only the live CDN empty extension marker', async () => {
    const store = new MemoryStore()
    await expect(refreshAcpRegistry({ store, fetchImpl: async () => registryResponse(document) })).resolves.toMatchObject({ changed: true })
    await expect(refreshAcpRegistry({
      store,
      fetchImpl: async () => registryResponse({ ...document, extensions: [{ id: 'unstable' }] }),
    })).rejects.toThrow('Unsupported ACP Registry extensions')
  })

  it('aborts a stalled upstream request without replacing last-known-good', async () => {
    vi.useFakeTimers()
    try {
      const store = new MemoryStore()
      await refreshAcpRegistry({ store, fetchImpl: async () => registryResponse(document) })
      const previous = await getAcpRegistrySnapshot('darwin-aarch64', store)
      const stalled = refreshAcpRegistry({
        store,
        fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      })
      const rejection = expect(stalled).rejects.toThrow('aborted')
      await vi.advanceTimersByTimeAsync(15_001)
      await rejection
      expect(await getAcpRegistrySnapshot('darwin-aarch64', store)).toEqual(previous)
    } finally {
      vi.useRealTimers()
    }
  })

  it('supports emergency id blocking, revision metrics, and previous-known-good rollback', async () => {
    const previousBlocked = process.env.ACP_REGISTRY_BLOCKED_IDS
    const store = new MemoryStore()
    try {
      await refreshAcpRegistry({ store, now: new Date('2026-09-09T00:00:00Z'), fetchImpl: async () => registryResponse(document) })
      process.env.ACP_REGISTRY_BLOCKED_IDS = 'qwen-code'
      await refreshAcpRegistry({ store, now: new Date('2026-09-09T01:00:00Z'), fetchImpl: async () => registryResponse(document) })
      expect((await getAcpRegistrySnapshot('darwin-aarch64', store))?.candidates.some((item) => item.id === 'qwen-code')).toBe(false)
      expect(await rollbackAcpRegistry(store)).toBe(true)
      expect((await getAcpRegistrySnapshot('darwin-aarch64', store))?.candidates.some((item) => item.id === 'qwen-code')).toBe(true)
      recordAcpDaemonCatalogRevision('mfbc0000-0123456789abcdef')
      expect(getAcpRegistryMetrics().daemonRevisionDistribution).toMatchObject({
        'mfbc0000-0123456789abcdef': expect.any(Number),
      })
    } finally {
      if (previousBlocked === undefined) delete process.env.ACP_REGISTRY_BLOCKED_IDS
      else process.env.ACP_REGISTRY_BLOCKED_IDS = previousBlocked
    }
  })
})
