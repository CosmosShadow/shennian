// @arch open-source/docs/cli-runtime.md

import { loadConfig } from '../config/index.js'
import { regionToUrl } from '../region.js'
import { getUpgradeChannel, type UpgradeChannel } from './channel.js'

export type CliDistribution = {
  schemaVersion: 1
  channel: UpgradeChannel
  version: string
  artifact: {
    url: string
    size: number
    integrity: string
  }
}
export type CliUpdateSourceOrder = 'npm-first' | 'oss-first'

export function getCliUpdateSourceOrder(value = process.env.SHENNIAN_CLI_UPDATE_SOURCE_ORDER): CliUpdateSourceOrder {
  return value === 'oss-first' ? 'oss-first' : 'npm-first'
}

export function parseCliDistribution(value: unknown, channel: UpgradeChannel): CliDistribution {
  const input = value as Partial<CliDistribution> | null
  const artifact = input?.artifact as Partial<CliDistribution['artifact']> | undefined
  if (
    input?.schemaVersion !== 1 ||
    input.channel !== channel ||
    typeof input.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(input.version) ||
    typeof artifact?.url !== 'string' ||
    !/^https?:\/\//.test(artifact.url) ||
    !Number.isSafeInteger(artifact.size) ||
    Number(artifact.size) <= 0 ||
    typeof artifact.integrity !== 'string' ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifact.integrity)
  ) {
    throw new Error('Shennian release API returned an invalid CLI distribution')
  }
  return input as CliDistribution
}

export async function fetchCliDistribution(
  options: {
    baseUrl?: string
    channel?: UpgradeChannel
    machineToken?: string
    timeoutMs?: number
  } = {},
): Promise<CliDistribution> {
  const config = loadConfig()
  const channel = options.channel ?? getUpgradeChannel()
  const machineToken = options.machineToken ?? config.machineToken
  if (!machineToken) throw new Error('Shennian release API requires a paired Client')
  const url = new URL('/api/releases/cli', options.baseUrl ?? config.serverUrl ?? regionToUrl('cn'))
  url.searchParams.set('channel', channel)
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${machineToken}` },
    signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
  })
  if (!response.ok) throw new Error(`Shennian release API returned ${response.status}`)
  return parseCliDistribution(await response.json(), channel)
}

export async function fetchOwnedCliArtifact(version: string): Promise<CliDistribution['artifact'] | null> {
  try {
    const distribution = await fetchCliDistribution()
    return distribution.version === version ? distribution.artifact : null
  } catch {
    return null
  }
}
