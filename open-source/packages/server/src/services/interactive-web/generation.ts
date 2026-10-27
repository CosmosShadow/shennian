import { observationChunk } from './runtime-observation.js'
import { contentActorAllowed } from './quota.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-generation.test.ts
import { prisma } from '../../lib/prisma.js'
import { getObjectText, putObjectBuffer } from '../../lib/oss.js'
import { runInteractiveAgent, type ToolRegistration } from './agent-loop.js'
import { assetUrl, generateContentImage, inspectContentImage, storeContentAsset } from './assets.js'
import { createInteractiveModel } from './providers.js'
import { ContentError, digest, readableWork, type ClaimedJob, type GeneratedArtifact } from './repository.js'

export function parseGeneratedDocument(args: Record<string, unknown>) {
  const { title, summary, html, changeSummary } = args
  if (typeof title !== 'string' || !title.trim() || title.length > 200
    || typeof summary !== 'string' || !summary.trim() || summary.length > 5000
    || typeof changeSummary !== 'string' || changeSummary.length > 500
    || typeof html !== 'string' || html.length < 40 || html.length > 120_000
    || !/<(?:html|body|main|div|section)[\s>]/i.test(html)) throw new ContentError('invalid_generated_document', 502)
  return { title: title.trim(), summary: summary.trim(), html, changeSummary: changeSummary.trim() }
}
/** Only the validated /save route writes this envelope; normal instructions never opt into it. */
export const EXACT_SAVE_PREFIX = 'shennian-exact-save-v1:'
/** An upload merely selected for a prompt is NOT automatically part of the public artifact. */
export async function referencedContentAssets(html: string, assets: Array<{ id: string; readToken: string; objectKey: string; contentType: string }>,
  read: (key: string) => Promise<string | null> = getObjectText) {
  const used = new Set<string>(), pending = [html]
  let total = html.length, files = 0
  while (pending.length) {
    const source = pending.shift()!.replace(/\\\//g, '/').replace(/&amp;/g, '&')
    for (const asset of assets) {
      const url = assetUrl(asset)
      let offset = source.indexOf(url)
      while (offset >= 0 && /[A-Za-z0-9_-]/.test(source.charAt(offset + url.length))) offset = source.indexOf(url, offset + 1)
      if (used.has(asset.id) || offset < 0) continue
      used.add(asset.id)
      if (['application/json', 'text/plain'].includes(asset.contentType)) {
        if (++files > 64) throw new ContentError('resource_graph_limit', 413)
        const text = await read(asset.objectKey)
        if (text === null) throw new ContentError('referenced_asset_missing', 502)
        total += text.length
        if (total > 8 * 1024 * 1024) throw new ContentError('resource_graph_limit', 413)
        pending.push(text)
      }
    }
  }
  return [...used]
}
const generationInstruction = `You create polished, mobile-first interactive HTML works, not a conversation page.
Art direction: design one coherent editorial-quality experience, not a generic admin form. Choose a deliberate palette (one accent, quiet neutrals), clear type hierarchy, generous but purposeful spacing, refined controls and subtle 120–220ms transitions. Prefer a strong focal visual or expressive typography over a stack of boxes; avoid oversized headings, default grey buttons, heavy borders, unexplained empty space and ornamental gradients. Adapt to 375–430px widths and short screens, with readable 15px+ body text and 44px touch targets. Make the first screen useful and engaging. Do not force every work into the same visual template.
Every action must provide immediate local pending/validation feedback, disable duplicate submission, and preserve typed input until a persisted result arrives. Do not claim a vote/save succeeded while still queued. Display meaningful participation records (the actual accepted reasons as well as counts), never fabricate participants or missing reasons. Keep short public titles, not implementation notes or revision labels.
First inspect the current position, then discover tools and read the actual document, optional document.observe runtime state, and selected material when needed. For earlier history or missing previous images, lazily use versions.list and versions.get (resources/html); do not guess or discard earlier real frames.
For small current-page changes, prefer document.patch: read the actual base, replace small unique exact strings, and supply updated metadata; do NOT regenerate thousands of unchanged HTML tokens for one vote or reason. Use document.submit for creation, full redesign, or larger changes. Deliver a complete self-contained HTML document, title, comprehensive searchable summary
(including visible text, interactions and visual content), and a brief PUBLIC change summary without private prompts.
The host supplies floating navigation and text/voice input; do not recreate host controls, draft labels or status badges inside HTML.
Use CSS var(--shennian-safe-top,110px) and var(--shennian-safe-bottom,135px), NEVER env(--shennian-safe-top) or env(--shennian-safe-bottom): these are custom properties, not environment variables. Respect host-owned --shennian-safe-top and --shennian-safe-bottom for readable text and controls under floating host bars. Never declare or overwrite these reserved variables. Apply box-sizing:border-box to full-height padded containers; reserve the bottom inset so ALL final buttons and inputs stay above the host bar. Background artwork may extend edge to edge. Use inline CSS and JS; no external scripts, localStorage, top navigation or secrets. Fetch is allowed ONLY for immutable asset URLs returned by tools, with credentials:'omit'. Use assets.write for optional JSON files; keep data in HTML when simpler. Never invent an image URL.
Use media.request when original generated images are needed. For continuation / editing, pass the actual previous referenceAssetIds. Use assets.inspect to understand uploaded images when needed. Existing asset URLs must be preserved exactly.
For deterministic shared interactions (votes, reasons, toggles), execute ordinary JS, serialize the updated canonical state into the HTML (for example a JSON script node AND visible DOM), then call window.shennian.save(undefined,{title,summary,changeSummary}). Supply accurate updated comprehensive public metadata; this exact-save path persists without any model call. Disable duplicate submission, keep pending UI outside the serialized snapshot, and let the host replace the page only after actual commit. Never save a stale initial state or disabled/pending controls. Local transient animation needs no shared save. Use request ONLY for work that needs AI generation/understanding/design.
Each HTML button that needs AI calls window.shennian.request(text) with a natural-language request. SDK request(text) and save(html?,metadata?) return void, NOT a Promise: never chain .then/.catch or treat their return as a save acknowledgement. Show pending until the host replaces the page with the committed artifact. Visible totals must actually render from the persisted data; do not hide accepted votes in an unused JS object.
Optionally expose named LOCAL UI operations with window.shennian.registerMethod({name,description,parameters}, handler). Local methods cannot save shared state or gain platform privileges. Use window.shennian.save(html,metadata) for explicit exact HTML/data saves; it uses the shared commit queue and rejects stale bases, but does NOT call the Agent when metadata is supplied. Local UI/animation runs directly in JS without any shared save.
When continuing images, preserve previous real images and their sequence, play their evolution automatically then stop
at the last one; provide short meaningful model-chosen continuation options AND a custom text input, not a fixed game template.
For AI-driven edits request the intended change so the Agent reads the latest queued base. For deterministic exact saves use the pinned HTML snapshot; the host rejects a stale base instead of overwriting concurrent changes. Never automatically retry a rejected old snapshot.
A shared action must change the persisted document/data, not merely its changeSummary or local JS variables. For example, recording one vote means updating the stored initial count and vote record so reloading retains it. Keep the DOM and initial JS/data consistent; never reset accepted user data on load. Buttons are only requests; do not show a committed success before a save receipt. Use inline validation, not alert/confirm/prompt: sandboxed modals are unavailable.
Only first publication is a host action, not an HTML button. Never say a save or image completed without a tool receipt.
On edits preserve useful existing content unless the user's request changes it. Don't hardcode gameplay types.
Only finish after document.submit or document.patch returns received:true. If validation rejects a submission, correct the document without repeating paid image generation; never resubmit after acceptance. Do not poll background jobs.`

export async function generateContentDocument(claim: ClaimedJob): Promise<GeneratedArtifact> {
  const { job, work } = claim
  if (job.observation && (JSON.parse(job.observation) as { versionId: string }).versionId !== work.currentVersionId) throw new ContentError('observation_base_changed', 409)
  if (job.kind === 'save' && job.snapshotBaseVersionId !== work.currentVersionId) throw new ContentError('snapshot_base_changed', 409)
  let submitted: ReturnType<typeof parseGeneratedDocument> | null = null
  let images = 0, dataWrites = 0, submissions = 0
  const generatedIds: string[] = []
  const selectedIds = Array.isArray(job.resourceIds) ? job.resourceIds.filter((v): v is string => typeof v === 'string') : []
  const baseId = job.baseVersionId || job.referenceId
  const base = baseId ? await prisma.interactiveVersion.findUnique({ where: { id: baseId } }) : null
  if (base && base.workId !== work.id) await readableWork(job.actorId, base.workId)
  const html = job.kind === 'save' ? job.snapshotHtml : base ? await getObjectText(base.objectKey) : ''
  if (base && job.kind !== 'save' && html !== null && digest(html || '') !== base.digest) throw new ContentError('base_integrity_failed', 502)
  if (base && html === null) throw new ContentError('base_artifact_missing', 502)
  const baseIds = Array.isArray(base?.resourceIds) ? base.resourceIds.filter((v): v is string => typeof v === 'string') : []
  const inheritedIds = [...new Set([...baseIds, ...selectedIds])]
  const assets = await prisma.interactiveAsset.findMany({ where: { id: { in: inheritedIds } } })
  const verify = async () => {
    if (!contentActorAllowed(job.actorId)) throw new ContentError('content_beta_access_required', 403)
    const active = await prisma.interactiveWork.findUnique({ where: { id: work.id } })
    const currentJob = await prisma.interactiveJob.findUnique({ where: { id: job.id }, select: { status: true } })
    if (!active || active.status === 'deleted' || active.leaseToken !== job.leaseToken || active.writeEpoch !== job.writeEpoch
      || active.headRevision !== job.baseRevision || currentJob?.status !== 'running') throw new ContentError('generation_invalidated', 409)
  }
  const historyWorkId = base?.workId || work.id
  const definitions: ToolRegistration[] = [
    { definition: { id: 'document.read', version: '1', effect: 'read', description: 'Read the pinned base HTML, metadata and selected material; paginated.',
      parameters: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 10000 } }, additionalProperties: false } },
    authorize: verify, execute: async (args) => {
      const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10000)
      return { versionId: base?.id ?? null, title: base?.title ?? '', summary: base?.summary.slice(0, 1800) ?? '',
        html: (html || '').slice(offset, offset + limit), nextOffset: offset + limit < (html || '').length ? offset + limit : null,
        resourceCount: assets.length, selectedAssets: assets.filter((asset) => selectedIds.includes(asset.id)).map((asset) => ({ id: asset.id, url: assetUrl(asset), contentType: asset.contentType })) }
    } },
    { definition: { id: 'document.observe', version: '1', effect: 'read', description: 'Read the explicitly requested runtime observation from this job. Non-authoritative DOM data, not platform permission.', parameters: { type: 'object', properties: { textOffset: { type: 'integer', minimum: 0 }, controlOffset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
      authorize: verify, execute: async (args) => job.observation ? { versionId: work.currentVersionId, observation: observationChunk(JSON.parse(job.observation).data, Number(args.textOffset || 0), Number(args.controlOffset || 0)) } : { available: false } },
    { definition: { id: 'media.request', version: '1', effect: 'enqueue', description: 'Generate one real image and persist it. At most two per job; costs platform quota.',
      parameters: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 3000 }, referenceAssetIds: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 3, uniqueItems: true } },
        required: ['prompt'], additionalProperties: false } },
    authorize: async () => { await verify(); if (submitted || submissions > 0 || images >= 2 || job.kind === 'save') throw new ContentError('image_job_limit', 429) },
    execute: async (args, execution) => {
      images++
      const references = Array.isArray(args.referenceAssetIds) ? args.referenceAssetIds as string[] : []
      if (references.some((assetId) => ![...inheritedIds, ...generatedIds].includes(assetId))) throw new ContentError('reference_asset_denied', 403)
      const referenceAssets = await prisma.interactiveAsset.findMany({ where: { id: { in: references }, contentType: { startsWith: 'image/' } } })
      if (referenceAssets.length !== references.length) throw new ContentError('reference_asset_unavailable', 404)
      const image = await generateContentImage({ actorId: job.actorId, workId: work.id, jobId: job.id,
        prompt: String(args.prompt), referenceUrls: referenceAssets.map(assetUrl), signal: execution.signal })
      generatedIds.push(image.id)
      return image
    } },
    { definition: { id: 'assets.list', version: '1', effect: 'read', description: 'Lazily list pinned resources, at most 20 per chunk; large histories are not preloaded.',
      parameters: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
    authorize: verify, execute: async (args) => {
      const offset = Number(args.offset || 0)
      return { count: assets.length, assets: assets.slice(offset, offset + 20).map((asset) => ({ id: asset.id, url: assetUrl(asset), contentType: asset.contentType })),
        nextOffset: offset + 20 < assets.length ? offset + 20 : null }
    } },
    { definition: { id: 'assets.write', version: '1', effect: 'enqueue', description: 'Persist an immutable JSON or text resource. Use returned URL in HTML; never overwrite current.json. At most four per job.',
      parameters: { type: 'object', properties: { contentType: { enum: ['application/json', 'text/plain'] }, content: { type: 'string', maxLength: 120000 } }, required: ['contentType', 'content'], additionalProperties: false } },
    authorize: async () => { await verify(); if (submitted || dataWrites >= 4 || job.kind === 'save') throw new ContentError('resource_job_limit', 429) },
    execute: async (args) => {
      dataWrites++
      const resource = await storeContentAsset({ ownerId: job.actorId, workId: work.id, jobId: job.id,
        buffer: Buffer.from(String(args.content)), contentType: String(args.contentType) })
      generatedIds.push(resource.id)
      return resource
    } },
    { definition: { id: 'assets.read', version: '1', effect: 'read', description: 'Read selected text material in bounded, explicitly truncated chunks.',
      parameters: { type: 'object', properties: { assetId: { type: 'string', maxLength: 64 }, offset: { type: 'integer', minimum: 0 } }, required: ['assetId'], additionalProperties: false } },
    authorize: verify, execute: async (args) => {
      const asset = assets.find((item) => item.id === args.assetId)
      if (!asset || !['text/plain', 'application/json'].includes(asset.contentType)) throw new ContentError('text_asset_unavailable', 404)
      const text = await getObjectText(asset.objectKey)
      if (text === null) throw new ContentError('text_asset_unavailable', 404)
      const offset = Number(args.offset || 0)
      return { assetId: asset.id, text: text.slice(offset, offset + 8000), nextOffset: offset + 8000 < text.length ? offset + 8000 : null }
    } },
    { definition: { id: 'assets.inspect', version: '1', effect: 'read', description: 'Use a vision model to actually inspect a selected or inherited image. Do not guess from its URL.',
      parameters: { type: 'object', properties: { assetId: { type: 'string', maxLength: 64 }, question: { type: 'string', maxLength: 500 } }, required: ['assetId'], additionalProperties: false } },
    authorize: verify, execute: async (args, execution) => {
      const asset = assets.find((item) => item.id === args.assetId)
      if (!asset || !asset.contentType.startsWith('image/')) throw new ContentError('image_unavailable', 404)
      return inspectContentImage({ actorId: job.actorId, assetId: asset.id, allowedIds: inheritedIds, question: String(args.question || 'Describe this image accurately, including visible text and composition.'), signal: execution.signal })
    } },
    { definition: { id: 'versions.list', version: '1', effect: 'read', description: 'Lazily inspect saved history of this work/reference, including earlier real images. Read-only, no restore.',
      parameters: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
    authorize: verify, execute: async (args) => {
      if (historyWorkId !== work.id) await readableWork(job.actorId, historyWorkId)
      const versions = await prisma.interactiveVersion.findMany({ where: { workId: historyWorkId }, orderBy: { seq: 'asc' }, skip: Number(args.offset || 0), take: 12,
        select: { id: true, seq: true, title: true, changeSummary: true } })
      return { versions, nextOffset: versions.length === 12 ? Number(args.offset || 0) + 12 : null }
    } },
    { definition: { id: 'versions.get', version: '1', effect: 'read', description: 'Read a scoped historical version HTML or resources lazily. Resources become available for image references and publication only when actually used.',
      parameters: { type: 'object', properties: { versionRef: { type: 'string', maxLength: 64 }, part: { enum: ['html', 'resources'] }, offset: { type: 'integer', minimum: 0 } }, required: ['versionRef', 'part'], additionalProperties: false } },
    authorize: verify, execute: async (args) => {
      if (historyWorkId !== work.id) await readableWork(job.actorId, historyWorkId)
      const version = await prisma.interactiveVersion.findUnique({ where: { id: String(args.versionRef) } })
      if (!version || version.workId !== historyWorkId) throw new ContentError('history_version_denied', 403)
      if (args.part === 'html') {
        const text = await getObjectText(version.objectKey)
        if (text === null || digest(text) !== version.digest) throw new ContentError('history_artifact_unavailable', 502)
        const offset = Number(args.offset || 0)
        return { versionRef: version.id, html: text.slice(offset, offset + 10000), nextOffset: offset + 10000 < text.length ? offset + 10000 : null }
      }
      const ids = Array.isArray(version.resourceIds) ? version.resourceIds.filter((v): v is string => typeof v === 'string') : []
      const offset = Number(args.offset || 0), selected = ids.slice(offset, offset + 20)
      const found = await prisma.interactiveAsset.findMany({ where: { id: { in: selected } } })
      for (const asset of found) if (!assets.some((known) => known.id === asset.id)) { assets.push(asset); inheritedIds.push(asset.id) }
      return { versionRef: version.id, assets: found.map((asset) => ({ id: asset.id, url: assetUrl(asset), contentType: asset.contentType })),
        nextOffset: offset + 20 < ids.length ? offset + 20 : null }
    } },
    { definition: { id: 'document.patch', version: '1', effect: 'enqueue', description: 'Efficient small edit of the pinned HTML. Exact unique replacements, atomic acceptance; no gameplay schema. Supply accurate resulting metadata. A received:true receipt completes the artifact.',
      parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 200 },
        summary: { type: 'string', minLength: 1, maxLength: 5000 }, changeSummary: { type: 'string', maxLength: 500 },
        replacements: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', properties: {
          before: { type: 'string', minLength: 1, maxLength: 20000 }, after: { type: 'string', maxLength: 20000 } }, required: ['before', 'after'], additionalProperties: false } } },
        required: ['title', 'summary', 'changeSummary', 'replacements'], additionalProperties: false } },
      authorize: async () => { await verify(); if (submitted || !base || job.kind !== 'modify') throw new ContentError('patch_unavailable', 409) },
      execute: async (args) => {
        if (++submissions > 3) throw new ContentError('document_submission_limit', 502)
        let next = html || ''
        for (const replacement of args.replacements as Array<{ before: string; after: string }>) {
          const index = next.indexOf(replacement.before)
          if (index < 0 || next.indexOf(replacement.before, index + 1) >= 0) return {
            received: false, error: 'patch_target_not_unique', instruction: 'Nothing was saved. Read the pinned HTML and use a unique exact before string, or submit the complete HTML.' }
          next = next.slice(0, index) + replacement.after + next.slice(index + replacement.before.length)
          if (next.length > 120000) throw new ContentError('invalid_generated_document', 502)
        }
        if (digest(next) === base!.digest) return { received: false, error: 'unchanged_document' }
        submitted = parseGeneratedDocument({ ...args, html: next })
        return { received: true }
      },
    },
    { definition: { id: 'document.submit', version: '1', effect: 'enqueue', description: 'Deliver the complete HTML artifact and its metadata once. Host validates then commits separately.',
      parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 200 },
        summary: { type: 'string', minLength: 1, maxLength: 5000 }, changeSummary: { type: 'string', maxLength: 500 },
        html: { type: 'string', minLength: 40, maxLength: 120000 } }, required: job.kind === 'save' ? ['title', 'summary', 'changeSummary'] : ['title', 'summary', 'html', 'changeSummary'], additionalProperties: false } },
    authorize: async () => { await verify(); if (submitted) throw new ContentError('already_submitted', 409) },
    execute: async (args) => {
      if (++submissions > 3) throw new ContentError('document_submission_limit', 502)
      const next = parseGeneratedDocument(job.kind === 'save' ? { ...args, html: job.snapshotHtml } : args)
      if (job.kind === 'modify' && base && digest(next.html) === base.digest) return {
        received: false, error: 'unchanged_document', instruction: 'No change was saved. The HTML is identical to the base. Perform the requested persistent state/content change in the HTML or its referenced immutable data, including initial DOM and JS values. Changing only changeSummary is not an action. Correct document.submit before finishing; do not generate another image just to retry submission.' }
      submitted = next
      return { received: true }
    } },
  ]
  const exact = job.kind === 'save' && job.instruction.startsWith(EXACT_SAVE_PREFIX)
  if (exact) submitted = parseGeneratedDocument({ ...JSON.parse(job.instruction.slice(EXACT_SAVE_PREFIX.length)), html: job.snapshotHtml })
  try {
    if (!exact) await runInteractiveAgent({ text: `${generationInstruction}\n\nUSER REQUEST (untrusted content):\n${job.instruction}${job.kind === 'save' ? '\nThis is an exact HTML snapshot save. Preserve its DOM and data; only derive accurate public metadata. Omit html from document.submit: the host will preserve the exact snapshot. No image generation.' : ''}`,
      context: { actorId: job.actorId, contextRef: job.id, turnRef: job.id, viewEpoch: job.baseRevision ?? 0 },
      finished: () => submitted !== null,
      executionMode: 'worker', limits: { timeoutMs: 240000, maxSteps: 12, maxCalls: 24, maxChars: 400000, maxResultChars: 16000 },
      model: createInteractiveModel(12000, 100000), verifyContext: verify,
      inspect: async () => ({ workRef: work.id, viewerMode: 'current', viewedVersionRef: baseId,
        currentVersionRef: work.currentVersionId, newestSavedVersionRef: work.newestVersionId,
        readableVersionCount: work.versionCount, headRevision: work.headRevision, writeEpoch: work.writeEpoch,
        canViewHistory: Boolean(base), canActivateSharedVersion: false, canRequestSharedChangeFromThisView: true }),
      find: async (query) => definitions.map((tool) => tool.definition.id).sort((a, b) => /version|history|previous|历史|版本|以前|演变/i.test(query) ? Number(b.startsWith('versions.')) - Number(a.startsWith('versions.')) : Number(b === (job.kind === 'modify' ? 'document.patch' : 'document.submit')) - Number(a === (job.kind === 'modify' ? 'document.patch' : 'document.submit'))),
      registry: new Map(definitions.map((tool) => [tool.definition.id, tool])),
    })
  } catch (error) { if (!submitted) throw error }
  if (!submitted) throw new ContentError('document_not_submitted', 502)
  await verify()
  const result = submitted as ReturnType<typeof parseGeneratedDocument>
  const sha = digest(result.html), objectKey = `interactive/works/${work.id}/${job.id}-${sha}.html`
  await putObjectBuffer(objectKey, Buffer.from(result.html), 'text/html; charset=utf-8')
  const generated = generatedIds.length ? await prisma.interactiveAsset.findMany({ where: { id: { in: generatedIds } } }) : []
  const resourceIds = await referencedContentAssets(result.html, [...assets, ...generated])
  return { title: result.title, summary: result.summary, changeSummary: result.changeSummary, objectKey, digest: sha, resourceIds }
}
