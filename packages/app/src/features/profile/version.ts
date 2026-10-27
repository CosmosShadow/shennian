// @arch docs/engineering/build-and-release.md
// @test packages/app/src/__tests__/profile-version.test.ts

export type AppVersionPlatform = 'native' | 'web' | 'desktop'

type FormatAppVersionInput = {
  platform: AppVersionPlatform
  shellVersion: string | null | undefined
  otaVersion?: string | null | undefined
  otaSuffix?: string | null | undefined
  deliveryVersion?: string | null | undefined
  desktopVersion?: string | null | undefined
}

type RuntimeVersionInput = {
  platform: AppVersionPlatform
  shellVersion: string | null | undefined
  deliveryVersion?: string | null | undefined
  desktopVersion?: string | null | undefined
}

export function formatAppVersionLabel(input: FormatAppVersionInput): string
export function formatAppVersionLabel(
  rawVersion: string | null | undefined,
  otaSuffix: string | null | undefined,
): string
export function formatAppVersionLabel(
  inputOrRawVersion: FormatAppVersionInput | string | null | undefined,
  legacyOtaSuffix?: string | null | undefined,
): string {
  if (typeof inputOrRawVersion === 'object' && inputOrRawVersion !== null) {
    const { platform, shellVersion, otaVersion, otaSuffix, deliveryVersion, desktopVersion } = inputOrRawVersion

    if (platform === 'desktop') {
      return formatPlainVersion(deliveryVersion ?? desktopVersion ?? shellVersion)
    }

    if (platform === 'web') {
      return formatPlainVersion(deliveryVersion ?? shellVersion)
    }

    if (otaVersion) {
      return formatPlainVersion(otaVersion)
    }

    if (deliveryVersion) {
      return formatPlainVersion(deliveryVersion)
    }

    return formatNativeVersionLabel(shellVersion, otaSuffix)
  }

  return formatNativeVersionLabel(inputOrRawVersion, legacyOtaSuffix)
}

export function formatRuntimeVersionDetails(input: RuntimeVersionInput): string[] {
  const delivery = formatOptionalPlainVersion(input.deliveryVersion)

  if (input.platform === 'desktop') {
    return [
      `前端：${delivery ?? '—'}`,
      `桌面壳：${formatOptionalPlainVersion(input.desktopVersion) ?? '—'}`,
    ]
  }

  if (input.platform === 'web') {
    return [`前端：${delivery ?? formatOptionalPlainVersion(input.shellVersion) ?? '—'}`]
  }

  return [
    `内容：${delivery ?? formatOptionalPlainVersion(input.shellVersion) ?? '—'}`,
    `壳：${formatOptionalPlainVersion(input.shellVersion) ?? '—'}`,
  ]
}

function formatPlainVersion(rawVersion: string | null | undefined): string {
  return formatOptionalPlainVersion(rawVersion) ?? '—'
}

function formatOptionalPlainVersion(rawVersion: string | null | undefined): string | null {
  const raw = rawVersion?.trim()
  if (!raw) return null

  const normalizedRaw = raw.startsWith('v') ? raw.slice(1) : raw
  return normalizedRaw.startsWith('v') ? normalizedRaw : `v${normalizedRaw}`
}

function formatNativeVersionLabel(
  rawVersion: string | null | undefined,
  otaSuffix: string | null | undefined,
): string {
  const shellLabel = formatPlainVersion(rawVersion)
  const raw = rawVersion?.trim()
  if (!raw) return shellLabel

  const normalizedRaw = raw.startsWith('v') ? raw.slice(1) : raw
  const suffix = otaSuffix?.trim()
  if (!suffix) return shellLabel

  const otaVersion = applyOtaPatchVersion(normalizedRaw, suffix)
  const otaLabel = otaVersion.startsWith('v') ? otaVersion : `v${otaVersion}`
  return `${shellLabel} / OTA ${otaLabel}`
}

function applyOtaPatchVersion(baseVersion: string, otaSuffix: string): string {
  if (!/^\d+$/.test(otaSuffix)) {
    return baseVersion.endsWith(`-${otaSuffix}`) ? baseVersion : `${baseVersion}-${otaSuffix}`
  }

  const parts = baseVersion.split('.')
  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    return `${parts[0]}.${parts[1]}.${otaSuffix}`
  }

  return baseVersion.endsWith(`-${otaSuffix}`) ? baseVersion : `${baseVersion}-${otaSuffix}`
}
