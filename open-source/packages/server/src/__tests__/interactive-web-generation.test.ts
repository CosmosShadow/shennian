// @covers open-source/packages/server/src/services/interactive-web/generation.ts
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ model: vi.fn(), activeWork: vi.fn(), job: vi.fn(), base: vi.fn(), put: vi.fn(), read: vi.fn(), history: vi.fn(), assets: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: { interactiveWork: { findUnique: mocks.activeWork }, interactiveJob: { findUnique: mocks.job }, interactiveVersion: { findUnique: mocks.base, findMany: mocks.history }, interactiveAsset: { findMany: mocks.assets } } }))
vi.mock('../lib/oss.js', () => ({ putObjectBuffer: mocks.put, getObjectText: mocks.read }))
vi.mock('../services/interactive-web/providers.js', () => ({ createInteractiveModel: () => mocks.model }))
import { EXACT_SAVE_PREFIX, generateContentDocument, parseGeneratedDocument, referencedContentAssets } from '../services/interactive-web/generation.js'
describe('complete artifact validation', () => {
  const document = { title: 'A real work', summary: 'Visible content and interactions', changeSummary: 'Updated the page',
    html: '<!doctype html><html><body><main>Hello</main></body></html>' }
  it('requires complete HTML and separately generated metadata', () => {
    expect(parseGeneratedDocument(document).title).toBe('A real work')
    for (const patch of [{ title: '' }, { summary: '' }, { html: '```html' }, { html: 'x'.repeat(120001) }, { title: 'x'.repeat(201) }]) {
      expect(() => parseGeneratedDocument({ ...document, ...patch })).toThrow('invalid_generated_document')
    }
  })
})


// The provider is a deterministic unit fixture; the production Agent loop and tool registry execute normally.
describe('worker Agent submission pipeline', () => {
  const claim = { work: { id: 'w', currentVersionId: null, headRevision: 0 }, job: { id: 'j', actorId: 'a', kind: 'create', instruction: 'Create a unit fixture', resourceIds: [], leaseToken: 'lease', writeEpoch: 0, baseRevision: 0 } }
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('INTERACTIVE_CONTENT_ALLOWED_USERS', 'a')
    mocks.activeWork.mockResolvedValue({ status: 'unpublished', leaseToken: 'lease', writeEpoch: 0, headRevision: 0 })
    mocks.job.mockResolvedValue({ status: 'running' })
    mocks.assets.mockResolvedValue([]); mocks.history.mockResolvedValue([])
  })
  afterEach(() => vi.unstubAllEnvs())
  function submission() {
    mocks.model.mockResolvedValueOnce({ calls: [{ id: 'describe', name: 'tools.describe', args: { toolId: 'document.submit' } }] })
      .mockResolvedValueOnce({ calls: [{ id: 'submit', name: 'tools.invoke', args: { toolId: 'document.submit', definitionVersion: '1', args: {
        title: 'Unit fixture', summary: 'A static fixture used only in unit tests', changeSummary: 'Created', html: '<!doctype html><html><body><main>fixture</main></body></html>',
      } } }] }).mockResolvedValueOnce({ text: 'Submitted.' })
  }
  it('persists exact HTML and supplied public metadata without any model call', async () => {
    const html = '<!doctype html><html><body><main>Saved count: 4</main></body></html>'
    const metadata = { title: 'Count', summary: 'Saved count: 4, one added vote.', changeSummary: 'One vote' }
    const saved = { ...claim, work: { ...claim.work, currentVersionId: 'v1' }, job: { ...claim.job, kind: 'save', snapshotBaseVersionId: 'v1', snapshotHtml: html, instruction: EXACT_SAVE_PREFIX + JSON.stringify(metadata) } }
    const result = await generateContentDocument(saved as never)
    expect(mocks.model).not.toHaveBeenCalled()
    expect(mocks.put).toHaveBeenCalledWith(result.objectKey, Buffer.from(html), 'text/html; charset=utf-8')
    expect(result).toMatchObject(metadata)
    await expect(generateContentDocument({ ...saved, work: { ...saved.work, currentVersionId: 'v2' } } as never)).rejects.toThrow('snapshot_base_changed')
    expect(mocks.put).toHaveBeenCalledOnce()
    await expect(generateContentDocument({ ...saved, job: { ...saved.job, instruction: EXACT_SAVE_PREFIX + JSON.stringify({ ...metadata, title: ' ' }) } } as never)).rejects.toThrow('invalid_generated_document')
    expect(mocks.put).toHaveBeenCalledOnce()
  })
  it('uses the production lazy tool loop and stores an immutable artifact only after explicit submission', async () => {
    submission()
    const result = await generateContentDocument(claim as never)
    expect(result).toMatchObject({ title: 'Unit fixture', resourceIds: [] })
    expect(result.objectKey).toBe(`interactive/works/w/j-${result.digest}.html`)
    expect(mocks.put).toHaveBeenCalledOnce()
    expect(mocks.model).toHaveBeenCalledTimes(2)
    expect(mocks.model.mock.calls[0]?.[1].map((tool: { id: string }) => tool.id)).toEqual(['context.inspect', 'tools.find', 'tools.describe', 'tools.invoke'])
  })
  it('does not persist model prose as a successful artifact', async () => {
    mocks.model.mockResolvedValue({ text: 'I made the page, trust me.' })
    await expect(generateContentDocument(claim as never)).rejects.toThrow('document_not_submitted')
    expect(mocks.put).not.toHaveBeenCalled()
  })
  it('refuses an unchanged modification even when its public change summary claims success', async () => {
    const html = '<!doctype html><html><body><main>fixture</main></body></html>'
    mocks.base.mockResolvedValue({ id: 'base', workId: 'w', digest: createHash('sha256').update(html).digest('hex'), objectKey: 'unit/base', resourceIds: [] })
    mocks.read.mockResolvedValue(html)
    submission()
    await expect(generateContentDocument({ ...claim, job: { ...claim.job, kind: 'modify', baseVersionId: 'base' } } as never)).rejects.toThrow('document_not_submitted')
    expect(mocks.put).not.toHaveBeenCalled()
    const messages = mocks.model.mock.calls[2]?.[0]
    expect(JSON.parse(messages.at(-1).content)).toMatchObject({ received: false, error: 'unchanged_document' })
    mocks.model.mockReset()
    const args = { title: 'Unit fixture', summary: 'A unit fixture', changeSummary: 'Changed', html }
    const submit = (id: string, next: string) => ({ calls: [{ id, name: 'tools.invoke', args: { toolId: 'document.submit', definitionVersion: '1', args: { ...args, html: next } } }] })
    mocks.model.mockResolvedValueOnce({ calls: [{ id: 'describe', name: 'tools.describe', args: { toolId: 'document.submit' } }] })
      .mockResolvedValueOnce(submit('unchanged', html))
      .mockResolvedValueOnce(submit('corrected', html.replace('fixture', 'persisted vote: 1')))
      .mockResolvedValueOnce({ text: 'Submitted.' })
    const result = await generateContentDocument({ ...claim, job: { ...claim.job, kind: 'modify', baseVersionId: 'base' } } as never)
    expect(result.digest).not.toBe(createHash('sha256').update(html).digest('hex'))
    expect(mocks.put).toHaveBeenCalledOnce()
  })
  it('atomically patches small persisted changes without rewriting the whole artifact or a final model round', async () => {
    const html = '<html><body><h1>Fixture</h1><p id="votes">0</p><ul id="reasons"></ul></body></html>'
    mocks.base.mockResolvedValue({ id: 'base', workId: 'w', digest: createHash('sha256').update(html).digest('hex'), objectKey: 'unit/base', resourceIds: [] })
    mocks.read.mockResolvedValue(html)
    mocks.model.mockResolvedValueOnce({ calls: [{ id: 'describe', name: 'tools.describe', args: { toolId: 'document.patch' } }] })
      .mockResolvedValueOnce({ calls: [{ id: 'patch', name: 'tools.invoke', args: { toolId: 'document.patch', definitionVersion: '1', args: {
        title: 'Fixture', summary: 'One vote with a reason', changeSummary: 'Recorded a vote', replacements: [
          { before: '<p id="votes">0</p>', after: '<p id="votes">1</p>' },
          { before: '<ul id="reasons"></ul>', after: '<ul id="reasons"><li>A useful purchase</li></ul>' },
        ],
      } } }] })
    await generateContentDocument({ ...claim, job: { ...claim.job, kind: 'modify', baseVersionId: 'base' } } as never)
    expect(mocks.put.mock.calls[0]?.[1].toString()).toBe(html.replace('>0</p>', '>1</p>').replace('</ul>', '<li>A useful purchase</li></ul>'))
    expect(mocks.model).toHaveBeenCalledTimes(2)
  })
  it('rejects ambiguous or partially invalid patches without persisting any partial change', async () => {
    const html = '<html><body><p>Same</p><p>Same</p></body></html>'
    mocks.base.mockResolvedValue({ id: 'base', workId: 'w', digest: createHash('sha256').update(html).digest('hex'), objectKey: 'unit/base', resourceIds: [] })
    mocks.read.mockResolvedValue(html)
    mocks.model.mockResolvedValueOnce({ calls: [{ id: 'describe', name: 'tools.describe', args: { toolId: 'document.patch' } }] })
      .mockResolvedValueOnce({ calls: [{ id: 'patch', name: 'tools.invoke', args: { toolId: 'document.patch', definitionVersion: '1', args: {
        title: 'Fixture', summary: 'A unit document', changeSummary: 'not saved', replacements: [
          { before: '<body>', after: '<body class="new">' }, { before: 'Same', after: 'Changed' },
        ],
      } } }] }).mockResolvedValueOnce({ text: 'No artifact.' })
    await expect(generateContentDocument({ ...claim, job: { ...claim.job, kind: 'modify', baseVersionId: 'base' } } as never)).rejects.toThrow('document_not_submitted')
    expect(mocks.put).not.toHaveBeenCalled()
  })
  it('loads historical image resources lazily and preserves only actually referenced resources', async () => {
    const html = '<!doctype html><html><body><main>current fixture</main></body></html>'
    const base = { id: 'v2', workId: 'w', digest: createHash('sha256').update(html).digest('hex'), objectKey: 'unit/base', resourceIds: [] }
    mocks.base.mockResolvedValueOnce(base).mockResolvedValueOnce({ id: 'v1', workId: 'w', resourceIds: ['historic'] })
    mocks.read.mockResolvedValue(html)
    mocks.assets.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'historic', readToken: 'unit-capability', contentType: 'image/png', objectKey: 'unit/image' }])
    const invoke = (id: string, toolId: string, args: object) => ({ calls: [{ id, name: 'tools.invoke', args: { toolId, definitionVersion: '1', args } }] })
    mocks.model.mockResolvedValueOnce({ calls: [{ id: 'd-history', name: 'tools.describe', args: { toolId: 'versions.get' } }] })
      .mockResolvedValueOnce(invoke('read-history', 'versions.get', { versionRef: 'v1', part: 'resources' }))
      .mockResolvedValueOnce({ calls: [{ id: 'd-submit', name: 'tools.describe', args: { toolId: 'document.submit' } }] })
      .mockResolvedValueOnce(invoke('submit', 'document.submit', { title: 'Unit history', summary: 'An earlier image', changeSummary: 'Preserved history',
        html: '<html><body><img src="https://shennian.net/api/interactive-content/assets/historic?token=unit-capability"></body></html>' }))
      .mockResolvedValueOnce({ text: 'Submitted.' })
    const result = await generateContentDocument({ ...claim, job: { ...claim.job, kind: 'modify', baseVersionId: 'v2' } } as never)
    expect(result.resourceIds).toEqual(['historic'])
    expect(mocks.assets.mock.calls).toHaveLength(2)
    expect(mocks.put).toHaveBeenCalledOnce()
  })
  it('denies a historical version from an unrelated work before reading its resources', async () => {
    const html = '<!doctype html><html><body><main>current fixture</main></body></html>'
    mocks.base.mockResolvedValueOnce({ id: 'v2', workId: 'w', digest: createHash('sha256').update(html).digest('hex'), objectKey: 'unit/base', resourceIds: [] })
      .mockResolvedValueOnce({ id: 'foreign', workId: 'another-work', resourceIds: ['private'] })
    mocks.read.mockResolvedValue(html)
    mocks.model.mockResolvedValueOnce({ calls: [{ id: 'describe', name: 'tools.describe', args: { toolId: 'versions.get' } }] })
      .mockResolvedValueOnce({ calls: [{ id: 'read', name: 'tools.invoke', args: { toolId: 'versions.get', definitionVersion: '1', args: { versionRef: 'foreign', part: 'resources' } } }] })
    await expect(generateContentDocument({ ...claim, job: { ...claim.job, kind: 'modify', baseVersionId: 'v2' } } as never)).rejects.toThrow('history_version_denied')
    expect(mocks.assets).toHaveBeenCalledOnce()
    expect(mocks.put).not.toHaveBeenCalled()
  })
  it('rejects a cancelled or restored task before issuing a model call', async () => {
    mocks.activeWork.mockResolvedValue({ status: 'published', leaseToken: null, writeEpoch: 1, headRevision: 1 })
    await expect(generateContentDocument(claim as never)).rejects.toThrow('generation_invalidated')
    expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled()
  })
})


describe('published artifact resource closure', () => {
  const asset = (id: string, contentType: string) => ({ id, readToken: 'token', objectKey: id, contentType })
  const url = (id: string) => `https://shennian.net/api/interactive-content/assets/${id}?token=token`
  it('excludes selected but unused private material and follows actually linked immutable JSON', async () => {
    const read = vi.fn(async () => JSON.stringify({ image: url('image') }))
    expect(await referencedContentAssets(`<script>fetch("${url('data')}")</script>`, [asset('unused', 'image/webp'), asset('data', 'application/json'), asset('image', 'image/webp')], read)).toEqual(['data', 'image'])
    expect(read).toHaveBeenCalledOnce()
  })
  it('does not accept a partial ID or a different resource capability as a public reference', async () => {
    expect(await referencedContentAssets(url('image') + '-wrong', [asset('image', 'image/webp')])).toEqual([])
    expect(await referencedContentAssets(url('image').replace('token=token', 'token=wrong'), [asset('image', 'image/webp')])).toEqual([])
  })
})
