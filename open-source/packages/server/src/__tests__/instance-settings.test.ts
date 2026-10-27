// @covers open-source/packages/server/src/services/instance-settings.ts
// @covers open-source/packages/server/src/services/billing-mode.ts
// @covers open-source/packages/server/src/services/personal-model-feature.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDeploymentMode, systemPushEnabled } from '../services/instance-settings.js'
import { getBillingFeatureMode } from '../services/billing-mode.js'
import { builtinPersonalAgentEnabled } from '../services/personal-model-feature.js'
import { isApnsVoipConfigured, sendApnsVoipPush } from '../services/apns-voip.js'

afterEach(() => vi.unstubAllEnvs())

describe('instance deployment settings', () => {
  it('preserves official defaults and rejects unknown configuration', () => {
    expect(getDeploymentMode({})).toBe('official')
    expect(systemPushEnabled({})).toBe(true)
    expect(() => getDeploymentMode({ SHENNIAN_DEPLOYMENT_MODE: 'typo' })).toThrow('invalid_deployment_mode')
    expect(() => systemPushEnabled({ SHENNIAN_PUSH_MODE: 'typo' })).toThrow('invalid_push_mode')
  })
  it('defaults self-hosted push off but permits an explicit provider opt-in', () => {
    const env = { SHENNIAN_DEPLOYMENT_MODE: 'self-hosted' }
    expect(systemPushEnabled(env)).toBe(false)
    expect(systemPushEnabled({ ...env, SHENNIAN_PUSH_MODE: 'providers' })).toBe(true)
    expect(systemPushEnabled({ SHENNIAN_PUSH_MODE: 'off' })).toBe(false)
  })
  it('forces self-hosted billing off even in live/test configuration', () => {
    vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'self-hosted')
    vi.stubEnv('BILLING_FEATURE_MODE', 'live')
    expect(getBillingFeatureMode()).toBe('off')
  })
  it('requires explicit self-hosted model enablement without changing official defaults', () => {
    vi.stubEnv('SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED', '')
    vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'official')
    expect(builtinPersonalAgentEnabled()).toBe(true)
    vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'self-hosted')
    expect(builtinPersonalAgentEnabled()).toBe(false)
    vi.stubEnv('SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED', 'true')
    expect(builtinPersonalAgentEnabled()).toBe(true)
  })
  it('prevents the APNs voice-call transport from bypassing disabled push', async () => {
    vi.stubEnv('SHENNIAN_PUSH_MODE', 'off')
    const transport = vi.fn()
    expect(isApnsVoipConfigured()).toBe(false)
    await expect(sendApnsVoipPush({ token: 'unit', transport,
      payload: { aps: {}, call_id: 'unit', caller_name: 'unit', timestamp: 0 },
    })).rejects.toThrow('push_disabled')
    expect(transport).not.toHaveBeenCalled()
  })
})
