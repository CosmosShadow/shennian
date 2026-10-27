// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/server-binding.test.ts
import { normalizeInstanceOrigin } from '@shennian/wire'
import type { ShennianConfig } from './index.js'

export function assertSingleServerBinding(candidate: string | undefined, config: ShennianConfig): string | undefined {
  if (!candidate) return undefined
  const origin = normalizeInstanceOrigin(candidate)
  if ((config.machineToken || config.accessToken || config.refreshToken) && origin !== normalizeInstanceOrigin(config.serverUrl ?? 'https://shennian.net')) {
    throw new Error('Client is already bound to another server. Stop and reset the installation before rebinding; server overrides cannot reuse credentials or history.')
  }
  return origin
}
