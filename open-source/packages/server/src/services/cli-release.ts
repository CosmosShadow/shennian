// @arch open-source/docs/server-runtime.md

import { getOssClient, signDownloadUrl } from '../lib/oss.js'

export type CliDistributionChannel = 'stable' | 'preview'

export type CliDistributionResponse = {
  schemaVersion: 1
  channel: CliDistributionChannel
  version: string
  artifact: {
    url: string
    size: number
    integrity: string
  }
}

type StoredCliDistribution = {
  schemaVersion: 1
  channel: CliDistributionChannel
  version: string
  artifact: {
    objectKey: string
    size: number
    integrity: string
  }
}

const OSS_PREFIX = (process.env.OSS_PREFIX ?? 'shennian').replace(/^\/+|\/+$/g, '')
const CHANNEL_PREFIX = `${OSS_PREFIX}/client/channels`
const ARTIFACT_PREFIX = `${OSS_PREFIX}/client/artifacts/`
const CACHE_MS = 60_000
const cache = new Map<CliDistributionChannel, { expiresAt: number; value: StoredCliDistribution }>()

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
}

function parseStoredCliDistribution(value: unknown, channel: CliDistributionChannel): StoredCliDistribution {
  const input = value as Partial<StoredCliDistribution> | null
  const artifact = input?.artifact as Partial<StoredCliDistribution['artifact']> | undefined
  if (
    input?.schemaVersion !== 1 ||
    input.channel !== channel ||
    !isVersion(input.version) ||
    typeof artifact?.objectKey !== 'string' ||
    artifact.objectKey !== `${ARTIFACT_PREFIX}${input.version}/shennian-${input.version}.tgz` ||
    !Number.isSafeInteger(artifact.size) ||
    Number(artifact.size) <= 0 ||
    Number(artifact.size) > 200 * 1024 * 1024 ||
    typeof artifact.integrity !== 'string' ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifact.integrity)
  ) {
    throw new Error('Invalid CLI distribution manifest')
  }
  return input as StoredCliDistribution
}

function responseBody(result: unknown): unknown {
  const content = (result as { content?: unknown }).content
  if (Buffer.isBuffer(content)) return JSON.parse(content.toString('utf8'))
  if (typeof content === 'string') return JSON.parse(content)
  return content
}

export async function getCliDistribution(
  channel: CliDistributionChannel,
  deps: { now?: () => number } = {},
): Promise<CliDistributionResponse | null> {
  const now = (deps.now ?? Date.now)()
  const cached = cache.get(channel)
  let stored: StoredCliDistribution
  if (cached && cached.expiresAt > now) {
    stored = cached.value
  } else {
    try {
      const result = await getOssClient().get(`${CHANNEL_PREFIX}/${channel}.json`)
      stored = parseStoredCliDistribution(responseBody(result), channel)
      cache.set(channel, { expiresAt: now + CACHE_MS, value: stored })
    } catch (error) {
      const status = (error as { status?: number; code?: string }).status
      const code = (error as { status?: number; code?: string }).code
      if (status === 404 || code === 'NoSuchKey') return null
      throw error
    }
  }
  return {
    schemaVersion: 1,
    channel,
    version: stored.version,
    artifact: {
      url: signDownloadUrl(stored.artifact.objectKey, 60),
      size: stored.artifact.size,
      integrity: stored.artifact.integrity,
    },
  }
}

export function clearCliDistributionCache(): void {
  cache.clear()
}
