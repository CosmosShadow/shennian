// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-assets.test.ts
import { randomBytes, timingSafeEqual } from 'node:crypto'
import sharp from 'sharp'
import { prisma } from '../../lib/prisma.js'
import { getObjectBuffer, putObjectBuffer } from '../../lib/oss.js'
import { ContentError, id } from './repository.js'
import { contentProviderConfig, providerJson, readLimited } from './providers.js'
import { consumeContentQuota } from './quota.js'

export function assetUrl(asset: { id: string; readToken: string }) {
  return `https://shennian.net/api/interactive-content/assets/${encodeURIComponent(asset.id)}?token=${encodeURIComponent(asset.readToken)}`
}
export function validAssetToken(actual: string, expected: string) {
  const a = Buffer.from(actual), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
export function isSupportedRaster(buffer: Buffer) {
  return (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    || (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    || (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
}
export async function storeContentAsset(input: { ownerId: string; buffer: Buffer; contentType: string; workId?: string; jobId?: string }) {
  if (input.buffer.length > 8 * 1024 * 1024) throw new ContentError('asset_too_large', 413)
  let buffer = input.buffer, contentType = input.contentType
  if (['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    if (!isSupportedRaster(buffer)) throw new ContentError('unsupported_image_bytes', 415)
    buffer = await sharp(buffer, { limitInputPixels: 24_000_000 }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer()
    contentType = 'image/webp'
  } else if (!['text/plain', 'application/json'].includes(contentType)) throw new ContentError('unsupported_asset_type', 415)
  if (contentType === 'application/json') { try { JSON.parse(buffer.toString('utf8')) } catch { throw new ContentError('invalid_json_asset') } }
  const assetId = id(), readToken = randomBytes(32).toString('base64url')
  const objectKey = `interactive/assets/${assetId}`
  await putObjectBuffer(objectKey, buffer, contentType)
  const asset = await prisma.interactiveAsset.create({ data: { id: assetId, ownerId: input.ownerId,
    objectKey, contentType, size: buffer.length, readToken, workId: input.workId, jobId: input.jobId } })
  return { id: asset.id, url: assetUrl(asset), contentType, size: asset.size }
}
export async function readContentAsset(actorId: string, assetId: string) {
  const asset = await prisma.interactiveAsset.findUnique({ where: { id: assetId } })
  if (!asset || asset.ownerId !== actorId) throw new ContentError('asset_unavailable', 404)
  const file = await getObjectBuffer(asset.objectKey)
  if (!file) throw new ContentError('asset_unavailable', 404)
  return { asset, file }
}
export function allowedImageDownload(url: string) {
  const parsed = new URL(url)
  const configured = (process.env.INTERACTIVE_IMAGE_DOWNLOAD_HOSTS || '').split(',').filter(Boolean)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')
    || !(parsed.hostname.endsWith('.aliyuncs.com') || parsed.hostname.endsWith('.alicdn.com') || configured.includes(parsed.hostname))) {
    throw new ContentError('image_download_host_denied', 502)
  }
  return parsed.href
}
/** A worker invokes this at most once per image call; provider errors are not blindly retried. */
export async function generateContentImage(input: { actorId: string; workId: string; jobId: string; prompt: string; referenceUrls?: string[]; signal: AbortSignal }) {
  await consumeContentQuota(input.actorId, 'image')
  const config = contentProviderConfig()
  if (input.referenceUrls?.length && config.imageProtocol !== 'dashscope') throw new ContentError('image_edit_protocol_not_configured', 503)
  const data = await providerJson(config.imageBase, config.imageKey, config.imageProtocol === 'dashscope' ? {
    model: input.referenceUrls?.length ? process.env.INTERACTIVE_IMAGE_EDIT_MODEL || 'qwen-image-2.0-pro' : config.imageModel,
    input: { messages: [{ role: 'user', content: [...(input.referenceUrls || []).map((image) => ({ image })), { text: input.prompt }] }] },
    parameters: { size: '1024*1024', n: 1, prompt_extend: true, watermark: false },
  } : { model: config.imageModel, prompt: input.prompt, n: 1, size: '1024x1024' }, input.signal)
  const output = data.output as { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> } | undefined
  const first = (data.data as Array<{ url?: string; b64_json?: string }> | undefined)?.[0]
  let buffer: Buffer
  const url = output?.choices?.[0]?.message?.content?.find((item) => item.image)?.image || first?.url
  if (url) {
    const response = await fetch(allowedImageDownload(url), { signal: input.signal, redirect: 'error' })
    if (!response.ok) throw new ContentError('image_download_failed', 502)
    buffer = await readLimited(response, 8 * 1024 * 1024)
  } else if (first?.b64_json && first.b64_json.length < 12_000_000) buffer = Buffer.from(first.b64_json, 'base64')
  else throw new ContentError('image_result_missing', 502)
  return storeContentAsset({ ownerId: input.actorId, workId: input.workId, jobId: input.jobId, buffer, contentType: 'image/png' })
}

export async function inspectContentImage(input: { actorId: string; assetId: string; allowedIds?: string[]; question: string; signal: AbortSignal }) {
  const asset = await prisma.interactiveAsset.findUnique({ where: { id: input.assetId } })
  if (!asset || !asset.contentType.startsWith('image/') || (asset.ownerId !== input.actorId && !input.allowedIds?.includes(asset.id))) {
    throw new ContentError('image_unavailable', 404)
  }
  await consumeContentQuota(input.actorId, 'vision')
  const config = contentProviderConfig()
  const data = await providerJson(`${config.base}/chat/completions`, config.key, {
    model: process.env.INTERACTIVE_VISION_MODEL || 'qwen3-vl-plus', max_tokens: 1800,
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: assetUrl(asset) } },
      { type: 'text', text: input.question }] }],
  }, input.signal)
  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined
  const observation = choices?.[0]?.message?.content
  if (typeof observation !== 'string' || !observation.trim()) throw new ContentError('vision_result_missing', 502)
  return { assetId: asset.id, source: 'vision_model_observation', observation: observation.slice(0, 6000) }
}
