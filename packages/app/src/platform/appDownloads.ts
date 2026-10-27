// @arch docs/features/official-website-positioning.md
import { getServerUrl } from '../config/server'
import { getMobileAppDownloadUrl } from './mobileAppDownload'
export type AppDownloadPlatform = 'ios' | 'android' | 'macos' | 'windows'
export type AppDownloadRelease = {
  version: string
  size: number
  arch?: string
  minimumSystem?: string
  status?: 'preview' | 'stable'
  notes?: string
}
export type AppDownloads = Partial<Record<AppDownloadPlatform, AppDownloadRelease>>
export function getAppDownloadUrl(platform: AppDownloadPlatform): string {
  return platform === 'ios' || platform === 'android'
    ? getMobileAppDownloadUrl(platform)
    : `${getServerUrl().replace(/\/+$/, '')}/download/${platform}`
}
export function parseAppDownloads(value: unknown): AppDownloads {
  if (!value || typeof value !== 'object') throw new Error('Invalid download information')
  const manifest = value as { version?: unknown; platforms?: Record<string, unknown> }
  if (!manifest.platforms || typeof manifest.platforms !== 'object')
    throw new Error('Invalid download information')
  const result: AppDownloads = {}
  for (const platform of ['android', 'macos', 'windows'] as const) {
    const info = manifest.platforms[platform] as
      | (Partial<AppDownloadRelease> & { url?: unknown })
      | undefined
    if (!info || typeof info !== 'object') continue
    if (
      (platform === 'macos' || platform === 'windows') &&
      (!info.version ||
        !['arm64', 'x64', 'universal'].includes(String(info.arch)) ||
        !['preview', 'stable'].includes(String(info.status)) ||
        typeof (info as { sha256?: unknown }).sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/i.test((info as { sha256: string }).sha256))
    )
      continue
    const version =
      info.version ??
      (typeof info.url === 'string'
        ? /^v(\d+\.\d+\.\d+(?:-[\w.-]+)?)\//.exec(info.url)?.[1]
        : undefined) ??
      manifest.version
    if (
      typeof version !== 'string' ||
      !/^\d+\.\d+\.\d+[\w.+-]*$/.test(version) ||
      typeof info.url !== 'string' ||
      !info.url ||
      !Number.isFinite(info.size) ||
      Number(info.size) <= 0
    )
      continue
    result[platform] = {
      version,
      size: Number(info.size),
      arch: typeof info.arch === 'string' ? info.arch.slice(0, 30) : undefined,
      minimumSystem:
        typeof info.minimumSystem === 'string' ? info.minimumSystem.slice(0, 120) : undefined,
      status:
        info.status === 'preview' ? 'preview' : info.status === 'stable' ? 'stable' : undefined,
      notes: typeof info.notes === 'string' ? info.notes.slice(0, 1200) : undefined,
    }
  }
  return result
}
export async function fetchAppDownloads(signal?: AbortSignal): Promise<AppDownloads> {
  const response = await fetch(`${getServerUrl().replace(/\/+$/, '')}/download/stable`, {
    signal,
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Downloads unavailable')
  return parseAppDownloads(await response.json())
}

export function getPreferredDownloadOrder(userAgent: string): AppDownloadPlatform[] {
  const preferred = /Android/i.test(userAgent)
    ? 'android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'ios'
      : /Windows/i.test(userAgent)
        ? 'windows'
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? 'macos'
          : null
  const all: AppDownloadPlatform[] = ['ios', 'android', 'macos', 'windows']
  return preferred ? [preferred, ...all.filter((platform) => platform !== preferred)] : all
}
