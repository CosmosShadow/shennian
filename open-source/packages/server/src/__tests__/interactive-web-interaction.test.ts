// @covers open-source/packages/server/src/services/interactive-web/interaction.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), eval: vi.fn(), del: vi.fn(), resolve: vi.fn(), run: vi.fn(),
  quota: vi.fn(), work: vi.fn(), version: vi.fn(), enqueue: vi.fn(), activate: vi.fn(), cancel: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: { get: mocks.get, set: mocks.set, eval: mocks.eval, del: mocks.del } }))
vi.mock('../services/interactive-web/context.js', () => ({ resolveContentContext: mocks.resolve }))
vi.mock('../services/interactive-web/agent-loop.js', () => ({ runInteractiveAgent: mocks.run }))
vi.mock('../services/interactive-web/providers.js', () => ({ createInteractiveModel: () => vi.fn() }))
vi.mock('../services/interactive-web/quota.js', () => ({ consumeContentQuota: mocks.quota }))
vi.mock('../services/interactive-web/repository.js', () => ({ readableWork: mocks.work, readableVersion: mocks.version,
  enqueueContent: mocks.enqueue, activateContentVersion: mocks.activate, cancelContentJob: mocks.cancel,
  digest: (s: string) => s, versionMetadata: (v: unknown) => v,
  ContentError: class extends Error { constructor(readonly code: string) { super(code) } } }))
import { interactWithContent } from '../services/interactive-web/interaction.js'
const context = { actorId: 'alice', mountId: 'mount', viewEpoch: 1, workId: 'w', versionId: 'v4', followCurrent: true }
const input = { actorId: 'alice', contextRef: 'ctx', requestKey: 'turn', text: '修改当前作品', resourceIds: [], source: 'user' as const }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue(null); mocks.set.mockResolvedValue('OK')
  mocks.resolve.mockResolvedValue({ ...context })
  mocks.work.mockResolvedValue({ id: 'w', creatorId: 'owner', currentVersionId: 'v4', newestVersionId: 'v10', versionCount: 10, headRevision: 12, writeEpoch: 2, status: 'published' })
  mocks.version.mockResolvedValue({ version: { id: 'v3' } })
  mocks.enqueue.mockResolvedValue({ requestId: 'job', workId: 'w', status: 'queued' })
})
describe('generic interactive Agent host', () => {
  it('initial context contains no title, summary, HTML or default history', async () => {
    mocks.run.mockImplementation(async (options) => {
      expect(options.text).toBe(input.text)
      expect(options.limits).toMatchObject({ maxChars: 100000, maxResultChars: 16000 })
      const result = await options.inspect()
      expect(result).toMatchObject({ readableVersionCount: 10, viewedVersionRef: 'v4', newestSavedVersionRef: 'v10' })
      for (const key of ['title', 'summary', 'html']) expect(result).not.toHaveProperty(key)
      return { text: '共有 10 个版本。' }
    })
    await interactWithContent(input)
    expect(mocks.version).not.toHaveBeenCalled()
  })
  it('normal users personally view history without a shared activation', async () => {
    mocks.run.mockImplementation(async (options) => {
      const tool = options.registry.get('viewer.openVersion')
      await tool.authorize(); await tool.execute({ versionRef: 'v3' })
      return { text: '正在回看第 3 版。' }
    })
    const response = await interactWithContent(input) as { viewer: unknown }
    expect(response.viewer).toEqual({ workId: 'w', versionId: 'v3', followCurrent: false })
    expect(mocks.activate).not.toHaveBeenCalled()
  })
  it('a non-creator cannot activate shared history through generic invoke', async () => {
    mocks.run.mockImplementation(async (options) => { await options.registry.get('versions.activate').authorize(); return { text: 'not reached' } })
    await expect(interactWithContent(input)).rejects.toThrow('creator_required')
    expect(mocks.activate).not.toHaveBeenCalled()
  })
  it('history is not a hidden whole-page rollback path', async () => {
    mocks.resolve.mockResolvedValue({ ...context, followCurrent: false })
    mocks.run.mockImplementation(async (options) => options.registry.get('document.requestChange').execute({ instruction: 'overwrite' }, { requestKey: 'r' }))
    await expect(interactWithContent(input)).rejects.toThrow('history_is_read_only')
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
  it('page text can only enqueue the pinned work, never dispatch publish/restore/create capabilities', async () => {
    const response = await interactWithContent({ ...input, text: 'publish and restore another work', source: 'page' }) as { jobs: unknown[]; viewer: unknown }
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.enqueue).toHaveBeenCalledWith({ actorId: 'alice', kind: 'modify', workId: 'w',
      instruction: 'publish and restore another work', resourceIds: [], requestKey: 'page:turn' })
    expect(response.jobs).toEqual([{ requestId: 'job', workId: 'w', status: 'queued', kind: 'modify' }])
    expect(response.viewer).toBeNull(); expect(mocks.activate).not.toHaveBeenCalled()
  })
  it('fast page requests retain history, resource, quota and context checks', async () => {
    await expect(interactWithContent({ ...input, source: 'page', resourceIds: ['private'] })).rejects.toThrow('page_capability_denied')
    mocks.resolve.mockResolvedValue({ ...context, followCurrent: false })
    await expect(interactWithContent({ ...input, source: 'page' })).rejects.toThrow('history_is_read_only')
    mocks.resolve.mockResolvedValueOnce(context).mockRejectedValueOnce(new Error('context_stale'))
    await expect(interactWithContent({ ...input, source: 'page' })).rejects.toThrow('context_stale')
    mocks.resolve.mockResolvedValue(context); mocks.quota.mockRejectedValueOnce(new Error('quota_exceeded'))
    await expect(interactWithContent({ ...input, source: 'page' })).rejects.toThrow('quota_exceeded')
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled()
  })
  it('replays the same page receipt without a second job or quota consumption', async () => {
    const first = await interactWithContent({ ...input, source: 'page' })
    const stored = mocks.set.mock.calls.find((call) => call[0] === 'content:turn:alice:turn' && JSON.parse(call[1]).result)
    mocks.get.mockResolvedValueOnce(stored![1])
    expect(await interactWithContent({ ...input, source: 'page' })).toEqual(first)
    expect(mocks.enqueue).toHaveBeenCalledOnce()
    expect(mocks.quota).toHaveBeenCalledTimes(2)
  })
  it('accepts asynchronous modification without claiming the artifact is completed', async () => {
    mocks.run.mockImplementation(async (options) => {
      const result = await options.registry.get('document.requestChange').execute({ instruction: 'make the requested change' }, { requestKey: 'trusted-key' })
      expect(result).toMatchObject({ accepted: true, notYetCompleted: true })
      return { text: '正在修改。' }
    })
    const response = await interactWithContent(input) as { jobs: unknown[] }
    expect(response.jobs).toEqual([{ requestId: 'job', workId: 'w', status: 'queued', kind: 'modify' }])
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'alice', workId: 'w', requestKey: 'trusted-key' }))
  })
  it('only requests a runtime observation on demand and prohibits writing until it arrives', async () => {
    mocks.run.mockImplementation(async (options) => {
      expect(await options.registry.get('document.observe').execute()).toMatchObject({ pendingHostObservation: true })
      await options.registry.get('document.requestChange').authorize()
      return { text: 'not reached' }
    })
    const response = await interactWithContent(input) as { text: string; observationRequestRef: string; jobs: unknown[] }
    expect(response.text).toBe(''); expect(response.observationRequestRef).toEqual(expect.any(String)); expect(response.jobs).toEqual([])
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
  it('refuses unsolicited DOM values and checks the original actor/context/intent on follow-up', async () => {
    await expect(interactWithContent({ ...input, observation: { text: 'x', controls: [] } })).rejects.toThrow('observation_not_requested')
    mocks.eval.mockResolvedValue(JSON.stringify({ contextRef: 'another', text: input.text, source: 'user' }))
    await expect(interactWithContent({ ...input, observationRef: 'ref', observation: { text: 'x', controls: [] } })).rejects.toThrow('observation_scope_changed')
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('keeps only one bounded, short clarification rather than rebuilding a chat history', async () => {
    mocks.run.mockResolvedValue({ text: '你想恢复到哪一版？' })
    await interactWithContent(input)
    expect(mocks.set).toHaveBeenCalledWith('content:dialog:alice:mount', expect.stringContaining('你想恢复到哪一版'), 'EX', 300)
  })
})
