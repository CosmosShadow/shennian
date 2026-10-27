// @arch docs/architecture/app/modular-features.md#登录-feature
// @test src/__tests__/auth-providers.test.ts

import { useEffect, useState } from 'react'
import { api } from '../../../config/api'
import { emptyPublicAuthConfig, type PublicAuthConfig } from '../types'

export function useAuthPublicConfig() {
  const [config, setConfig] = useState<PublicAuthConfig>(() => emptyPublicAuthConfig())

  useEffect(() => {
    void api<PublicAuthConfig>('/auth/public-config')
      .then((next) => setConfig({ ...emptyPublicAuthConfig(), ...next }))
      .catch(() => setConfig(emptyPublicAuthConfig()))
  }, [])

  return config
}
