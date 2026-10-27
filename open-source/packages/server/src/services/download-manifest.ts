// @arch open-source/docs/server-runtime.md
// @test src/__tests__/downloads-routes.test.ts

export const DOWNLOAD_PLATFORMS = ['android', 'ios', 'macos', 'windows'] as const
export type Platform = (typeof DOWNLOAD_PLATFORMS)[number]

export interface PlatformInfo {
  url: string
  size: number
  sha256?: string
  version?: string
  date?: string
  arch?: 'arm64' | 'x64' | 'universal'
  minimumSystem?: string
  status?: 'preview' | 'stable'
  notes?: string
}

/** Top-level version/date are retained for previously released clients. */
export interface ReleaseInfo {
  version: string
  date: string
  platforms: Partial<Record<Platform, PlatformInfo>>
}

const extensions: Record<Platform, RegExp> = {
  android: /\.apk$/i,
  ios: /\.ipa$/i,
  macos: /\.dmg$/i,
  windows: /\.exe$/i,
}
const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/

export function isValidPlatform(value: string): value is Platform {
  return (DOWNLOAD_PLATFORMS as readonly string[]).includes(value)
}

/** Only allow relative artifact keys; never turn manifest data into an open redirect. */
export function parseReleaseManifest(value: unknown): ReleaseInfo | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (typeof input.version !== 'string' || !versionPattern.test(input.version)) return null
  if (typeof input.date !== 'string' || !input.platforms || typeof input.platforms !== 'object')
    return null
  const platforms: ReleaseInfo['platforms'] = {}
  for (const platform of DOWNLOAD_PLATFORMS) {
    const raw = (input.platforms as Record<string, unknown>)[platform]
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.url !== 'string' || !/^v[\w.-]+\/[\w .()/-]+$/.test(item.url)) continue
    if (item.url.split('/').some((part) => !part || part === '..' || part === '.')) continue
    if (
      !extensions[platform].test(item.url) ||
      !Number.isSafeInteger(item.size) ||
      Number(item.size) <= 0
    )
      continue
    if (
      item.version !== undefined &&
      (typeof item.version !== 'string' || !versionPattern.test(item.version))
    )
      continue
    if (
      item.sha256 !== undefined &&
      (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256))
    )
      continue
    if (
      (platform === 'macos' || platform === 'windows') &&
      (!item.version ||
        !item.sha256 ||
        !['arm64', 'x64', 'universal'].includes(String(item.arch)) ||
        !item.status)
    )
      continue
    if (item.status !== undefined && item.status !== 'preview' && item.status !== 'stable') continue
    platforms[platform] = {
      url: item.url,
      size: Number(item.size),
      version:
        typeof item.version === 'string'
          ? item.version
          : (/^v(\d+\.\d+\.\d+(?:-[\w.-]+)?)\//.exec(item.url)?.[1] ?? input.version),
      date: typeof item.date === 'string' ? item.date : input.date,
      ...(typeof item.sha256 === 'string' ? { sha256: item.sha256 } : {}),
      ...(item.arch === 'arm64' || item.arch === 'x64' || item.arch === 'universal'
        ? { arch: item.arch }
        : {}),
      ...(typeof item.minimumSystem === 'string'
        ? { minimumSystem: item.minimumSystem.slice(0, 120) }
        : {}),
      ...(typeof item.notes === 'string' ? { notes: item.notes.slice(0, 1200) } : {}),
      ...(item.status === 'preview' || item.status === 'stable' ? { status: item.status } : {}),
    }
  }
  return { version: input.version, date: input.date, platforms }
}
