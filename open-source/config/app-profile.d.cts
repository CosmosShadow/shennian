// @arch open-source/docs/mobile-app.md
// @test open-source/config/app-profile.test.mjs
import type { ExpoConfig } from 'expo/config'
type Environment = Record<string, string | undefined>
export type OfficialAppComposition = {
  officialAppIdentity: { owner: string; eas: { projectId: string } }
  officialOtaConfig: (
    env: Environment,
    channel: string,
    backend: string,
  ) => NonNullable<ExpoConfig['updates']>
}
export function resolveAppDistribution(
  env: Environment,
  fallback?: 'official' | 'self-hosted',
): 'official' | 'self-hosted'
export function resolveOtaChannel(value: string | undefined): 'production' | 'preview'
export function resolveOtaBackend(value: string | undefined): 'eas' | 'oss'
export function resolveAppBuildProfile(
  env: Environment,
  official?: OfficialAppComposition,
  fallback?: 'official' | 'self-hosted',
): {
  distribution: 'official' | 'self-hosted'
  updates: NonNullable<ExpoConfig['updates']>
  owner?: string
  eas?: { projectId: string }
}
