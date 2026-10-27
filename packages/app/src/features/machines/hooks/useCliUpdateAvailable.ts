// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { useEffect, useState } from 'react'
import type { Machine } from '@shennian/wire'
import { compareVersions, fetchLatestCliVersion, isMachineCliVersionBlocked } from '../utils/launch'

/** A blocked (too old) client is handled by the required-upgrade banner, not the optional update hint. */
export function useCliUpdateAvailable(machine: Machine) {
  const [latestVersion, setLatestVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!machine.cliVersion) return
    fetchLatestCliVersion().then((value) => setLatestVersion(value)).catch(() => {})
  }, [machine.cliVersion])

  const blocked = isMachineCliVersionBlocked(machine.cliVersion)
  const hasUpdate = !blocked && latestVersion && machine.cliVersion
    ? compareVersions(machine.cliVersion, latestVersion) !== 'none'
    : false

  return { latestVersion, hasUpdate, blocked }
}
