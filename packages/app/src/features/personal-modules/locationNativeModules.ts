// @arch docs/features/recording-location.md
// @test src/__tests__/recording-location-native.test.ts
/** Called only after the immutable runtime and native-module capability checks. */
export function locationApi(): typeof import('expo-location') {
  return require('expo-location')
}
export function taskApi(): typeof import('expo-task-manager') {
  return require('expo-task-manager')
}
