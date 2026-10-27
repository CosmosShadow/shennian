// @arch docs/features/recording-location.md
// @test src/__tests__/recording-location-config.test.ts
const { withAndroidManifest } = require('@expo/config-plugins')
const permissions = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION']
/** Existing checked-in manifests contain tools:node=remove. Simply unblocking config
 * does not remove those historical merger directives on incremental prebuild. */
module.exports = function withRecordingLocation(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest
    const entries = manifest['uses-permission'] ?? []
    for (const name of permissions.map((p) => `android.permission.${p}`)) {
      const existing = entries.find((p) => p.$?.['android:name'] === name)
      if (existing) delete existing.$['tools:node']
      else entries.push({ $: { 'android:name': name } })
    }
    manifest['uses-permission'] = entries
    return c
  })
}
