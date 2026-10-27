// @arch open-source/docs/server-runtime.md

import { getOssClient } from '../lib/oss.js'

export type OtaPlatform = 'ios' | 'android'
export type OtaChannel = 'production' | 'preview'

type OtaPointer = {
  schemaVersion: 1
  channel: OtaChannel
  runtimeVersion: string
  platform: OtaPlatform
  updateId: string
  manifestKey: string
}

export type StoredOtaManifest = {
  schemaVersion: 1
  manifestBody: string
  signature?: string
}

type ExpoManifest = {
  id: string
  createdAt: string
  runtimeVersion: string
  launchAsset: OtaAsset
  assets: OtaAsset[]
  metadata: Record<string, string>
  extra: Record<string, unknown>
}

type OtaAsset = {
  hash: string
  key: string
  contentType: string
  fileExtension?: string
  url: string
}

const OSS_REGION = process.env.OSS_REGION ?? 'oss-cn-hangzhou'
const OSS_BUCKET = process.env.OSS_BUCKET ?? 'videoindustry'
const OSS_PREFIX = (process.env.OSS_PREFIX ?? 'shennian').replace(/^\/+|\/+$/g, '')
const OTA_PREFIX = `${OSS_PREFIX}/ota`
const OTA_PUBLIC_ORIGIN = new URL(
  process.env.OSS_PUBLIC_BASE_URL ?? `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`,
).origin

function readJson(result: unknown): unknown {
  const content = (result as { content?: unknown }).content
  if (Buffer.isBuffer(content)) return JSON.parse(content.toString('utf8'))
  if (typeof content === 'string') return JSON.parse(content)
  return content
}

function validRuntime(value: string): boolean {
  return /^[A-Za-z0-9._+-]{1,80}$/.test(value)
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function parsePointer(value: unknown, expected: Omit<OtaPointer, 'schemaVersion' | 'updateId' | 'manifestKey'>): OtaPointer {
  const input = value as Partial<OtaPointer> | null
  if (
    input?.schemaVersion !== 1 ||
    input.channel !== expected.channel ||
    input.platform !== expected.platform ||
    input.runtimeVersion !== expected.runtimeVersion ||
    !validUuid(input.updateId) ||
    typeof input.manifestKey !== 'string' ||
    !input.manifestKey.startsWith(`${OTA_PREFIX}/updates/${input.updateId}/`) ||
    !input.manifestKey.endsWith('/manifest.json')
  ) throw new Error('Invalid OTA channel pointer')
  return input as OtaPointer
}

function validAsset(value: unknown, updateId: string): value is OtaAsset {
  const asset = value as Partial<OtaAsset> | null
  let url: URL | null = null
  try { url = typeof asset?.url === 'string' ? new URL(asset.url) : null }
  catch { url = null }
  return Boolean(
    asset &&
    typeof asset.hash === 'string' && /^[A-Za-z0-9_-]{43}$/.test(asset.hash) &&
    typeof asset.key === 'string' && asset.key.length > 0 &&
    typeof asset.contentType === 'string' && asset.contentType.length > 0 &&
    url?.protocol === 'https:' &&
    url.origin === OTA_PUBLIC_ORIGIN &&
    url.pathname.startsWith(`/${OTA_PREFIX}/updates/${updateId}/assets/`),
  )
}

function parseManifest(value: unknown, pointer: OtaPointer): StoredOtaManifest {
  const input = value as Partial<StoredOtaManifest> | null
  let manifest: ExpoManifest | null = null
  if (typeof input?.manifestBody === 'string') {
    try { manifest = JSON.parse(input.manifestBody) as ExpoManifest }
    catch { manifest = null }
  }
  if (
    input?.schemaVersion !== 1 ||
    typeof input.manifestBody !== 'string' ||
    !manifest ||
    manifest.id !== pointer.updateId ||
    manifest.runtimeVersion !== pointer.runtimeVersion ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !validAsset(manifest.launchAsset, pointer.updateId) ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.every((asset) => validAsset(asset, pointer.updateId)) ||
    !manifest.metadata || typeof manifest.metadata !== 'object' ||
    !manifest.extra || typeof manifest.extra !== 'object' ||
    (input.signature !== undefined && !/^sig="[A-Za-z0-9+/]+={0,2}", keyid="[A-Za-z0-9._-]+"$/.test(input.signature))
  ) throw new Error('Invalid OTA manifest')
  return input as StoredOtaManifest
}

export async function getOtaUpdate(input: {
  channel: OtaChannel
  platform: OtaPlatform
  runtimeVersion: string
}, deps: {
  getObject?: (key: string) => Promise<unknown>
} = {}): Promise<StoredOtaManifest | null> {
  if (!validRuntime(input.runtimeVersion)) throw new Error('Invalid OTA runtime version')
  const getObject = deps.getObject ?? ((key: string) => getOssClient().get(key))
  const pointerKey = `${OTA_PREFIX}/channels/${input.channel}/${input.runtimeVersion}/${input.platform}.json`
  let pointerResult: unknown
  try {
    pointerResult = await getObject(pointerKey)
  } catch { return null }
  const pointer = parsePointer(readJson(pointerResult), input)
  try {
    return parseManifest(readJson(await getObject(pointer.manifestKey)), pointer)
  } catch { return null }
}
