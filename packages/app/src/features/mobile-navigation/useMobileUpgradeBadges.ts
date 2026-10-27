// @arch docs/architecture/mobile-navigation.md
import { useMachinesStore } from '@shennian/shared'
import { useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import { useAppUpdateState } from '../profile/appUpdate'
import { useLatestCliVersionForBadges, useSettingsUpgradeBadges } from '../profile/settingsBadges'

export function useMobileUpgradeBadges() {
  const machines = useMachinesStore((state) => state.machines)
  const compatibilitySnapshot = useRelayConnectivitySnapshot()
  const update = useAppUpdateState({ autoCheck: true, compatibilitySnapshot })
  const latestCliVersion = useLatestCliVersionForBadges(machines.length > 0)
  return useSettingsUpgradeBadges({ machines, latestCliVersion, ota: update.hasUpdateBadge })
}
