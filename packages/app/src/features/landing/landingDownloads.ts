// @arch docs/engineering/build-and-release.md
// @test packages/app/src/__tests__/landing-desktop-downloads.test.ts

export type DesktopReleaseInfo = {
  version: string
  platforms?: Partial<Record<'mac' | 'win', { files?: DesktopReleaseFile[] }>>
}

export type DesktopReleaseFile = {
  name: string
  url: string
  size?: number
  updateMetadata?: boolean
}

export function isInstallableDesktopFile(file: DesktopReleaseFile): boolean {
  return Boolean(
    file.name &&
      file.url &&
      file.updateMetadata !== true &&
      !file.name.endsWith('.blockmap') &&
      !/^latest.*\.ya?ml$/i.test(file.name),
  )
}

export function pickDesktopDownloadUrl(
  release: DesktopReleaseInfo | null,
  platform: 'mac' | 'win',
): string | undefined {
  const files = (release?.platforms?.[platform]?.files ?? []).filter(isInstallableDesktopFile)
  const preferred = platform === 'mac'
    ? files.find((file) => file.name.endsWith('.dmg'))
    : files.find((file) => file.name.endsWith('.exe'))
  return preferred?.url
}
