// @arch docs/engineering/build-and-release.md
// @covers packages/app/app.json

/**
 * Validates app.json permission configuration to prevent:
 * 1. Apple App Review rejections due to generic/missing permission purpose strings
 * 2. Accidental removal of required permissions (e.g. microphone for voice input)
 * 3. Duplicate Android permissions
 *
 * Root cause: App Store rejected 0.1.27 for generic camera string; microphone was
 * accidentally removed during cleanup and only caught after release.
 */

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SESSION_SYNC_RELEASE_GATE } from '@shennian/wire'
import appJson from '../../app.json'

const expo = appJson.expo

// @covers packages/app/locales/en.json
// @covers packages/app/locales/zh.json
describe('native application name localization', () => {
  it('uses English as the native fallback and resolves Chinese names on both platforms', async () => {
    const require = createRequire(import.meta.url)
    const { getResolvedLocalesAsync } = require('@expo/config-plugins/build/utils/locales')
    const { setDisplayName } = require('@expo/config-plugins/build/ios/Name')
    expect(setDisplayName(expo, {}).CFBundleDisplayName).toBe('Shennian')
    expect(expo.ios.infoPlist.CFBundleDevelopmentRegion).toBe('en')
    const projectRoot = resolve(__dirname, '../..')
    for (const platform of ['ios', 'android']) {
      const { localesMap } = await getResolvedLocalesAsync(projectRoot, expo.locales, platform)
      for (const locale of ['en', 'zh', 'zh-Hans', 'zh-Hant']) {
        const name = locale === 'en' ? 'Shennian' : '神念'
        expect(localesMap[locale]).toMatchObject(
          platform === 'ios'
            ? { CFBundleDisplayName: name, CFBundleName: name }
            : { app_name: name },
        )
      }
    }
  })
})

function getCameraPluginConfig(): Record<string, unknown> | null {
  const plugins = expo.plugins as Array<string | [string, Record<string, unknown>]>
  for (const p of plugins) {
    if (Array.isArray(p) && p[0] === 'expo-camera') {
      return p[1] as Record<string, unknown>
    }
  }
  return null
}

function getImagePickerPluginConfig(): Record<string, unknown> | null {
  const plugins = expo.plugins as Array<string | [string, Record<string, unknown>]>
  for (const p of plugins) {
    if (Array.isArray(p) && p[0] === 'expo-image-picker') {
      return p[1] as Record<string, unknown>
    }
  }
  return null
}

function getMediaLibraryPluginConfig(): Record<string, unknown> | null {
  const plugins = expo.plugins as Array<string | [string, Record<string, unknown>]>
  for (const p of plugins) {
    if (Array.isArray(p) && p[0] === 'expo-media-library') {
      return p[1] as Record<string, unknown>
    }
  }
  return null
}

function hasPlugin(name: string): boolean {
  const plugins = expo.plugins as Array<string | [string, Record<string, unknown>]>
  return plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name)
}

describe('app.json — iOS permissions', () => {
  it('uses a logo-free launch screen that follows system appearance', () => {
    const splash = (
      expo.ios as {
        splash?: { image?: string; backgroundColor?: string; dark?: { backgroundColor?: string } }
      }
    ).splash
    expect(expo.splash).not.toHaveProperty('image')
    expect(splash?.image).toBeUndefined()
    expect(splash?.backgroundColor).toBe('#ffffff')
    expect(splash?.dark?.backgroundColor).toBe('#0a0a0a')
  })

  it('allows app theme to follow the system appearance', () => {
    expect(
      expo.userInterfaceStyle,
      'useTheme(system) relies on the native shell exposing system color-scheme changes',
    ).toBe('automatic')
  })

  it('camera permission has a specific purpose string, not a generic one', () => {
    const cfg = getCameraPluginConfig()
    expect(cfg, 'expo-camera plugin must be configured').not.toBeNull()

    const perm = cfg!.cameraPermission as string
    expect(typeof perm, 'cameraPermission must be a string (not false/missing)').toBe('string')
    expect(perm.length).toBeGreaterThan(30)

    // Must explain specific use case — Apple rejects vague strings like "Allow app to access camera"
    const lowerPerm = perm.toLowerCase()
    expect(
      lowerPerm.includes('qr') || lowerPerm.includes('scan') || lowerPerm.includes('pair'),
      `cameraPermission must mention specific use case (qr/scan/pair). Got: "${perm}"`,
    ).toBe(true)
  })

  it('microphone permission is present and specific for voice input', () => {
    const cfg = getCameraPluginConfig()
    expect(cfg, 'expo-camera plugin must be configured').not.toBeNull()

    const perm = cfg!.microphonePermission
    expect(
      perm !== false && perm !== undefined && perm !== null,
      'microphonePermission must not be false/missing — required for voice input feature',
    ).toBe(true)

    expect(typeof perm, 'microphonePermission must be a descriptive string').toBe('string')
    expect((perm as string).length).toBeGreaterThan(20)

    const lower = (perm as string).toLowerCase()
    expect(
      lower.includes('microphone') || lower.includes('voice') || lower.includes('audio'),
      `microphonePermission must mention specific use (microphone/voice/audio). Got: "${perm}"`,
    ).toBe(true)
  })

  it('image picker keeps camera permission available for the QR scanner', () => {
    const cfg = getImagePickerPluginConfig()
    expect(cfg, 'expo-image-picker plugin must be configured').not.toBeNull()

    const perm = cfg!.cameraPermission as string
    expect(typeof perm).toBe('string')
    expect(perm.length).toBeGreaterThan(20)
    expect(perm).toContain('$(PRODUCT_NAME)')
    expect(perm.toLowerCase()).toContain('camera')
  })

  it('image picker photo permission covers media attachments', () => {
    const cfg = getImagePickerPluginConfig()
    expect(cfg, 'expo-image-picker plugin must be configured').not.toBeNull()

    const perm = cfg!.photosPermission as string
    expect(typeof perm).toBe('string')
    expect(perm).toContain('$(PRODUCT_NAME)')

    const lower = perm.toLowerCase()
    expect(lower).toContain('photo')
    expect(lower).toContain('video')
    expect(lower).toContain('media')
  })

  it('all iOS permission strings mention the app product name placeholder', () => {
    const cfg = getCameraPluginConfig()
    const camPerm = cfg!.cameraPermission as string
    const micPerm = cfg!.microphonePermission as string

    expect(camPerm).toContain('$(PRODUCT_NAME)')
    expect(micPerm).toContain('$(PRODUCT_NAME)')

    const pickerCfg = getImagePickerPluginConfig()
    const photosPerm = pickerCfg!.photosPermission as string
    expect(typeof photosPerm).toBe('string')
    expect(photosPerm).toContain('$(PRODUCT_NAME)')

    const mediaLibraryCfg = getMediaLibraryPluginConfig()
    const savePhotosPerm = mediaLibraryCfg!.savePhotosPermission as string
    expect(typeof savePhotosPerm).toBe('string')
    expect(savePhotosPerm).toContain('$(PRODUCT_NAME)')
    expect(savePhotosPerm.toLowerCase()).toContain('save')
    expect(savePhotosPerm.toLowerCase()).toContain('video')
    expect(mediaLibraryCfg!.granularPermissions).toEqual(['photo', 'video'])
  })

  it('enables background audio without VoIP system-call mode', () => {
    const modes =
      (expo.ios as { infoPlist?: { UIBackgroundModes?: string[] } }).infoPlist?.UIBackgroundModes ??
      []
    expect(modes).toEqual(expect.arrayContaining(['audio', 'remote-notification']))
    expect(modes).not.toContain('voip')
    expect(hasPlugin('./plugins/with-voice-incoming-call')).toBe(false)
  })
})

describe('app.json — Android permissions', () => {
  it('uses the same immutable application identifier as iOS', () => {
    expect(expo.android.package).toBe('net.shennian.community')
    expect(expo.android.package).toBe(expo.ios.bundleIdentifier)
  })

  it('uses a logo-free launch screen that follows system appearance', () => {
    const splash = (
      expo.android as {
        splash?: { image?: string; backgroundColor?: string; dark?: { backgroundColor?: string } }
      }
    ).splash

    expect(splash?.image).toBeUndefined()
    expect(splash?.backgroundColor).toBe('#ffffff')
    expect(splash?.dark?.backgroundColor).toBe('#0a0a0a')
  })

  it('does not enable JPush in the public base manifest', () => {
    expect(hasPlugin('./plugins/with-jpush')).toBe(false)
  })

  it('includes CAMERA permission', () => {
    const perms = (expo.android as { permissions: string[] }).permissions
    expect(perms).toContain('android.permission.CAMERA')
  })

  it('includes RECORD_AUDIO permission for voice input', () => {
    const perms = (expo.android as { permissions: string[] }).permissions
    expect(perms, 'android.permission.RECORD_AUDIO is required for voice input feature').toContain(
      'android.permission.RECORD_AUDIO',
    )
  })

  it('keeps background audio permissions without full-screen system calls', () => {
    const perms = (expo.android as { permissions: string[] }).permissions
    expect(perms).toEqual(
      expect.arrayContaining([
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.WAKE_LOCK',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      ]),
    )
    expect(perms).not.toContain('android.permission.USE_FULL_SCREEN_INTENT')
    expect(hasPlugin('./plugins/with-voice-incoming-call')).toBe(false)
  })

  it('has no duplicate permissions', () => {
    const perms = (expo.android as { permissions: string[] }).permissions
    const unique = new Set(perms)
    expect(
      unique.size,
      `Duplicate Android permissions found: ${perms.filter((p, i) => perms.indexOf(p) !== i).join(', ')}`,
    ).toBe(perms.length)
  })

  it('blocks optional dependency permissions that exceed the product privacy boundary', () => {
    const blocked = (expo.android as { blockedPermissions?: string[] }).blockedPermissions
    expect(blocked).toEqual(
      expect.arrayContaining([
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.READ_PHONE_STATE',
        'android.permission.GET_TASKS',
        'android.permission.QUERY_ALL_PACKAGES',
      ]),
    )
  })

  it('recordAudioAndroid is true for expo-camera (required for voice input on Android)', () => {
    const cfg = getCameraPluginConfig()
    expect(cfg, 'expo-camera plugin must be configured').not.toBeNull()
    expect(
      cfg!.recordAudioAndroid,
      'recordAudioAndroid must be true — required for voice recording on Android',
    ).toBe(true)
  })

  it('uses resize mode for the software keyboard', () => {
    const android = expo.android as { softwareKeyboardLayoutMode?: string }
    expect(
      android.softwareKeyboardLayoutMode,
      'Android chat layout relies on adjustResize instead of an extra padding avoider',
    ).toBe('resize')
  })

  it('uses dedicated adaptive icon foreground and not the legacy full-bleed icon', () => {
    const adaptiveIcon = (expo.android as { adaptiveIcon: Record<string, string> }).adaptiveIcon
    expect(adaptiveIcon.foregroundImage).toBe('./assets/android-icon-foreground.png')
    expect(adaptiveIcon.foregroundImage).not.toBe('./assets/adaptive-icon.png')
    expect(adaptiveIcon.backgroundColor).toBe('#00000000')
  })

  it('omits monochrome adaptive icon when the launcher should use the branded foreground only', () => {
    const adaptiveIcon = (expo.android as { adaptiveIcon: Record<string, string> }).adaptiveIcon
    expect(adaptiveIcon.monochromeImage).toBeUndefined()
  })
})

// @covers packages/app/scripts/sync-ios-icons.sh
// @covers packages/app/plugins/with-brand-icons.js
// @arch docs/design/brand/assets/README.md
describe('native iOS icon build inputs', () => {
  it('ships a white, flat Composer icon with moderate margins and the approved vector', () => {
    expect(expo.ios.icon).toBe('./assets/Shennian.icon')
    const icon = JSON.parse(
      readFileSync(resolve(__dirname, '../../assets/Shennian.icon/icon.json'), 'utf8'),
    )
    // Icon Composer rewrites channel precision when saving the editable project.
    const [space, channels] = icon.fill.solid.split(':')
    expect(space).toBe('srgb')
    expect(channels.split(',').map(Number)).toEqual([1, 1, 1, 1])
    const group = icon.groups[0]
    expect(group.specular).toBe(false)
    expect(group.shadow).toEqual({ kind: 'none', opacity: 0 })
    expect(group.translucency.enabled).toBe(false)
    expect(group.layers[0].glass).toBe(false)
    expect(group.layers[0].position.scale).toBe(0.96)
    const master = readFileSync(
      resolve(__dirname, '../../../../docs/design/brand/assets/shennian-logo-v3.svg'),
      'utf8',
    )
    expect(
      readFileSync(resolve(__dirname, '../../assets/Shennian.icon/Assets/Logo.svg'), 'utf8'),
    ).toBe(master.replace('width="1254" height="1254"', 'width="1024" height="1024"'))
  })

  it.each(['app', 'Shennian'])('syncs icons for %s and fails on missing artwork', (projectName) => {
    const runs = resolve(tmpdir(), 'shennian-tests/unit')
    mkdirSync(runs, { recursive: true })
    const root = mkdtempSync(resolve(runs, 'ios-icons-'))
    const script = resolve(__dirname, '../../scripts/sync-ios-icons.sh')
    try {
      // No generated iOS project yet: prebuild will create it later.
      execFileSync('sh', [script, root])
      const catalog = resolve(root, `ios/${projectName}/Images.xcassets/AppIcon.appiconset`)
      mkdirSync(resolve(root, `ios/${projectName}.xcodeproj`), { recursive: true })
      mkdirSync(catalog, { recursive: true })
      mkdirSync(resolve(root, 'assets'))
      for (const suffix of ['', '-dark', '-tinted']) {
        const source = readFileSync(resolve(__dirname, `../../assets/icon${suffix}.png`))
        writeFileSync(resolve(root, `assets/icon${suffix}.png`), source)
        writeFileSync(resolve(catalog, `App-Icon${suffix}-1024x1024@1x.png`), 'stale')
      }
      mkdirSync(resolve(root, 'assets/Shennian.icon/Assets'), { recursive: true })
      for (const file of ['icon.json', 'Assets/Logo.svg']) {
        writeFileSync(
          resolve(root, 'assets/Shennian.icon', file),
          readFileSync(resolve(__dirname, '../../assets/Shennian.icon', file)),
        )
      }
      execFileSync('sh', [script, root])
      execFileSync('sh', [script, root])
      for (const file of ['icon.json', 'Assets/Logo.svg']) {
        expect(readFileSync(resolve(root, `ios/${projectName}/Shennian.icon`, file))).toEqual(
          readFileSync(resolve(root, 'assets/Shennian.icon', file)),
        )
      }
      for (const suffix of ['', '-dark', '-tinted']) {
        expect(readFileSync(resolve(catalog, `App-Icon${suffix}-1024x1024@1x.png`))).toEqual(
          readFileSync(resolve(root, `assets/icon${suffix}.png`)),
        )
      }
      rmSync(resolve(root, 'assets/icon-dark.png'))
      expect(() => execFileSync('sh', [script, root])).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['app', 'Shennian'])('registers one sync phase with outputs for %s', (projectName) => {
    const require = createRequire(import.meta.url)
    const project = require('xcode').project('test.pbxproj')
    project.hash = {
      project: {
        objects: {
          PBXProject: { ROOT: { targets: [{ value: 'APP' }] } },
          PBXNativeTarget: { APP: { buildPhases: [{ value: 'RES', comment: 'Resources' }] } },
          PBXFileReference: {},
          PBXBuildFile: {},
        },
      },
    }
    const { applyIconBuildPhase } = require('../../plugins/with-brand-icons')
    applyIconBuildPhase(project, projectName)
    applyIconBuildPhase(project, projectName)
    const phases = project.getFirstTarget().firstTarget.buildPhases
    expect(phases).toHaveLength(2)
    expect(phases[0].comment).toBe('[Shennian] Sync app icons')
    const phase = project.hash.project.objects.PBXShellScriptBuildPhase[phases[0].value]
    expect(phase.outputPaths).toHaveLength(5)
    expect(
      phase.outputPaths.every((output: string) =>
        output.startsWith(`"$(PROJECT_DIR)/${projectName}/`),
      ),
    ).toBe(true)
    expect(JSON.parse(phase.shellScript)).toContain(`"${projectName}"`)
    expect(phase.alwaysOutOfDate).toBe(1)
    expect(expo.plugins).toContain('./plugins/with-brand-icons')
  })
})

it('keeps community native build numbers on the shared session-sync compatibility baseline', () => {
  expect(Number(expo.ios.buildNumber)).toBeGreaterThanOrEqual(
    SESSION_SYNC_RELEASE_GATE.minAppBuild.ios,
  )
  expect(expo.android.versionCode).toBeGreaterThanOrEqual(
    SESSION_SYNC_RELEASE_GATE.minAppBuild.android,
  )
})
