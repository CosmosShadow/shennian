// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @test src/__tests__/chat-relay-status.test.ts

import { useCallback } from 'react'
import type { TFunction } from 'i18next'
import type { useRouter } from 'expo-router'
import { accountRuntime } from '../account-runtime/accountRuntime'

type Router = ReturnType<typeof useRouter>

export function useDesktopChatConnectivityActions({
  effectiveAgentIdentityId,
  machineId,
  machineOffline,
  relayFeedbackStatus,
  router,
  setShowSessionDetails,
  t,
}: {
  effectiveAgentIdentityId?: string
  machineId: string | null
  machineOffline: boolean
  relayFeedbackStatus: string
  router: Router
  setShowSessionDetails: (visible: boolean) => void
  t: TFunction
}) {
  const connectionLabel = machineOffline
    ? t('machine_offline')
    : relayFeedbackStatus === 'connecting'
      ? t('relay_connecting_short')
      : relayFeedbackStatus === 'network_offline'
        ? t('relay_network_offline')
        : relayFeedbackStatus === 'version_unsupported'
          ? t('relay_version_unsupported')
          : relayFeedbackStatus === 'auth_required'
            ? t('relay_auth_required')
            : relayFeedbackStatus === 'permission_revoked'
              ? t('relay_permission_revoked')
              : relayFeedbackStatus === 'plan_required'
                ? t('relay_plan_required')
                : relayFeedbackStatus === 'machine_unavailable'
                  ? t('relay_machine_unavailable')
                  : relayFeedbackStatus !== 'hidden'
                    ? t('relay_not_connected_short')
                    : null

  const openConnectivityDestination = useCallback(
    (includeVersionCategory: boolean) => {
      if (relayFeedbackStatus === 'version_unsupported') {
        router.navigate(
          includeVersionCategory
            ? { pathname: '/(main)/profile', params: { category: 'version' } }
            : '/(main)/profile',
        )
        return
      }
      if (relayFeedbackStatus === 'plan_required') {
        router.navigate('/(main)/profile')
        return
      }
      if (
        relayFeedbackStatus === 'permission_revoked' ||
        relayFeedbackStatus === 'machine_unavailable'
      ) {
        if (machineId)
          router.navigate({ pathname: '/(main)/machine/[machineId]', params: { machineId } })
        return
      }
      if (relayFeedbackStatus === 'auth_required') {
        router.replace('/(auth)/login')
        return
      }
      void accountRuntime.reconnect('manual')
    },
    [machineId, relayFeedbackStatus, router],
  )

  const handleConnectionPress = useCallback(
    () => openConnectivityDestination(true),
    [openConnectivityDestination],
  )
  const handleRelayStatusPress = useCallback(
    () => openConnectivityDestination(false),
    [openConnectivityDestination],
  )
  const handleOpenAgentSettings = useCallback(() => {
    if (!effectiveAgentIdentityId) return
    setShowSessionDetails(false)
    router.navigate(`/(main)/agents/${effectiveAgentIdentityId}/settings`)
  }, [effectiveAgentIdentityId, router, setShowSessionDetails])

  return { connectionLabel, handleConnectionPress, handleOpenAgentSettings, handleRelayStatusPress }
}
