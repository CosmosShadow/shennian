// @arch open-source/docs/server-runtime.md
// @test src/__tests__/instance-settings.test.ts

export type DeploymentMode = 'official' | 'self-hosted'

export function getDeploymentMode(env: NodeJS.ProcessEnv = process.env): DeploymentMode {
  const value = env.SHENNIAN_DEPLOYMENT_MODE?.trim() || 'official'
  if (value !== 'official' && value !== 'self-hosted') throw new Error('invalid_deployment_mode')
  return value
}

/** No external push transport, including voice-call transports, when disabled. */
export function systemPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = getDeploymentMode(env)
  const value = env.SHENNIAN_PUSH_MODE?.trim() || (mode === 'official' ? 'providers' : 'off')
  if (value !== 'off' && value !== 'providers') throw new Error('invalid_push_mode')
  return value === 'providers'
}

/** Required before a self-hosted listener starts; never print secret values. */
export function validateSelfHostedEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (getDeploymentMode(env) !== 'self-hosted') return
  for (const key of ['JWT_SECRET', 'SHENNIAN_STORAGE_SIGNING_SECRET']) {
    if (Buffer.byteLength(env[key] ?? '') < 32) throw new Error(`self_hosted_missing_${key}`)
  }
  if (!/^[a-f0-9]{64}$/.test(env.SHENNIAN_ACCOUNT_NAMESPACE_ID ?? '')) throw new Error('self_hosted_missing_account_namespace')
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(env.SHENNIAN_INSTANCE_ID ?? '')) throw new Error('self_hosted_missing_instance_id')
  if (!['closed', 'invite', 'open'].includes(env.SHENNIAN_REGISTRATION_POLICY ?? 'invite')) throw new Error('invalid_registration_policy')
  if ((env.SHENNIAN_REGISTRATION_POLICY ?? 'invite') === 'invite' && (env.SHENNIAN_REGISTRATION_INVITE?.length ?? 0) < 24) throw new Error('self_hosted_missing_registration_invite')
  const origin = new URL(env.SHENNIAN_PUBLIC_URL ?? '')
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('self_hosted_invalid_public_url')
}
