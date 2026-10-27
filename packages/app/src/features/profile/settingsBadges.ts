// @arch docs/engineering/build-and-release.md
// @test packages/app/src/__tests__/profile-settings-badges.test.ts

import { useEffect, useMemo, useState } from 'react'
import type { Machine } from '@shennian/wire'
import {
  compareVersions,
  fetchLatestCliVersion,
  isMachineCliVersionBlocked,
} from '../machines/utils/launch'

export type SettingsUpgradeBadges = {
  any: boolean
  machines: boolean
  ota: boolean
}

export function useLatestCliVersionForBadges(enabled: boolean): string | null {
  const [latestCliVersion, setLatestCliVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLatestCliVersion(null)
      return
    }

    let cancelled = false
    fetchLatestCliVersion()
      .then((version) => {
        if (!cancelled) setLatestCliVersion(version)
      })
      .catch(() => {
        if (!cancelled) setLatestCliVersion(null)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return latestCliVersion
}

export function useSettingsUpgradeBadges(input: {
  machines: readonly Machine[]
  latestCliVersion: string | null
  ota: boolean
}): SettingsUpgradeBadges {
  return useMemo(
    () => getSettingsUpgradeBadges(input),
    [input.latestCliVersion, input.machines, input.ota],
  )
}

export function getSettingsUpgradeBadges(input: {
  machines: readonly Pick<Machine, 'cliVersion'>[]
  latestCliVersion: string | null
  ota: boolean
}): SettingsUpgradeBadges {
  const machines = hasMachineCliUpgradeBadge(input.machines, input.latestCliVersion)
  const ota = input.ota

  return {
    any: ota || machines,
    machines,
    ota,
  }
}

export function hasMachineCliUpgradeBadge(
  machines: readonly Pick<Machine, 'cliVersion'>[],
  latestCliVersion: string | null,
): boolean {
  return machines.some((machine) => {
    if (isMachineCliVersionBlocked(machine.cliVersion)) return true
    if (!latestCliVersion || !machine.cliVersion) return false
    return compareVersions(machine.cliVersion, latestCliVersion) !== 'none'
  })
}
