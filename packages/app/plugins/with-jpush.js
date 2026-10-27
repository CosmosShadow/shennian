const { AndroidConfig, createRunOncePlugin, withAndroidManifest } = require('@expo/config-plugins')

function ensureMetaData(mainApplication, name, value) {
  if (!value) return
  const metaData = mainApplication['meta-data'] ?? []
  const existing = metaData.find((item) => item.$['android:name'] === name)

  if (existing) {
    existing.$['android:value'] = value
    existing.$['tools:replace'] = 'android:value'
  } else {
    metaData.push({
      $: {
        'android:name': name,
        'android:value': value,
        'tools:replace': 'android:value',
      },
    })
  }

  mainApplication['meta-data'] = metaData
}

function withJPush(config) {
  const appKey = process.env.JPUSH_APP_KEY || process.env.EXPO_PUBLIC_JPUSH_APP_KEY || ''
  const channel = process.env.JPUSH_CHANNEL || process.env.EXPO_PUBLIC_JPUSH_CHANNEL || 'default'

  return withAndroidManifest(config, (mod) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults)
    ensureMetaData(mainApplication, 'JPUSH_APPKEY', appKey)
    ensureMetaData(mainApplication, 'JPUSH_CHANNEL', channel)
    return mod
  })
}

module.exports = createRunOncePlugin(withJPush, 'with-jpush', '1.0.0')
