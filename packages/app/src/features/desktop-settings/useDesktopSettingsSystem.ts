// @arch docs/features/desktop-settings-information-architecture.md
// @arch docs/features/desktop-local-first-client.md#33-进程职责
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionsStore } from '@shennian/shared'
import { getDesktopControlBridge } from '../desktop-control/bridge'
import { useDesktopUpdateState } from '../desktop-control/hooks/useDesktopUpdateState'
import { useDesktopNotificationPreference } from '../desktop-control/hooks/useDesktopNotificationPreference'
import {
  requestDesktopLogExport,
  revealDesktopLogExport,
} from '../desktop-control/desktopLogExport'
import {
  getActiveDesktopUpdateSessions,
  getDesktopRestartImpactMessage,
} from '../desktop-control/desktopUpdateSafety'
import { getDesktopUpdateMessage } from './versionPresentation'
import { useDesktopSystemSettings } from './useDesktopSystemSettings'

export function useDesktopSettingsSystem() {
  const bridge = useMemo(() => getDesktopControlBridge(), [])
  const mounted = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const notification = useDesktopNotificationPreference()
  const systemSettings = useDesktopSystemSettings()
  const logsPending = useRef(false)
  const [exporting, setExporting] = useState(false)
  const [canReveal, setCanReveal] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)
  const desktopUpdate = useDesktopUpdateState()
  const sessions = useSessionsStore((state) => state.sessions)
  const activeCount = getActiveDesktopUpdateSessions(sessions).length
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const perform = async <T>(action: () => Promise<T>): Promise<T | null> => {
    if (mounted.current) setError(null)
    try {
      return await action()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }
  const versionLabel = desktopUpdate.appVersion ?? '—'
  const badge =
    desktopUpdate.state?.status === 'available' ||
    (desktopUpdate.state?.status === 'downloaded' && !desktopUpdate.state.installOnExit)
  return {
    error,
    notifications: {
      ...notification,
      onChange: (enabled: boolean) => {
        void notification.setEnabled(enabled)
      },
      onChangeBody: (showBody: boolean) => {
        void notification.setShowBody(showBody)
      },
      onRetry: () => {
        void notification.retry()
      },
    },
    systemSettings: {
      ...systemSettings,
      onRefresh: () => {
        void systemSettings.refresh()
      },
      onOpenNotificationSettings: () => {
        void systemSettings.openNotificationSettings()
      },
      onOpenMicrophoneSettings: () => {
        void systemSettings.openMicrophoneSettings()
      },
    },
    logs: {
      available: Boolean(bridge?.openLog),
      exporting,
      canReveal: canReveal && Boolean(bridge?.revealLog),
      onExport: () => {
        void perform(async () => {
          if (logsPending.current) return
          logsPending.current = true
          setExporting(true)
          try {
            const status = await requestDesktopLogExport(bridge)
            if (status === 'unavailable') throw new Error('Desktop log export is unavailable')
            if (mounted.current && status === 'exported') setCanReveal(true)
          } finally {
            logsPending.current = false
            if (mounted.current) setExporting(false)
          }
        })
      },
      onReveal: () => {
        void perform(async () => {
          if (!(await revealDesktopLogExport(bridge)))
            throw new Error('Desktop log export cannot be revealed')
        })
      },
    },
    version: {
      label: versionLabel,
      badge: Boolean(badge),
      warning: Boolean(badge),
      updateMessage: getDesktopUpdateMessage(desktopUpdate.state, versionLabel),
      desktopUpdate: {
        ...desktopUpdate,
        check: () => perform(desktopUpdate.check),
        download: () => perform(desktopUpdate.download),
        restart: () => perform(desktopUpdate.restart),
        installOnExit: () => perform(desktopUpdate.installOnExit),
      },
      restartImpactMessage: getDesktopRestartImpactMessage(activeCount),
      showRestartConfirmation: confirmingRestart && activeCount > 0,
      onInstallLater: () => {
        setConfirmingRestart(false)
        void perform(desktopUpdate.installOnExit)
      },
      onRequestRestart: () => {
        if (activeCount) setConfirmingRestart(true)
        else void perform(desktopUpdate.restart)
      },
      onConfirmRestart: () => {
        setConfirmingRestart(false)
        void perform(desktopUpdate.restart)
      },
    },
  }
}
