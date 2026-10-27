// @arch docs/features/desktop-daemon-pause-lifecycle.md
// @test ../../__tests__/desktop-machine-detail.test.ts
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useDesktopControlState } from '../desktop-control/hooks/useDesktopControlState'
import { getDesktopConnectorSourceLabel } from '../desktop-control/utils/status'
import { getDesktopControlStateKey } from '../desktop-control/utils/status'
import { useAuthStore } from '../../config/auth'
import { DesktopMachineAction } from './DesktopMachineAction'
import { desktopMachineDetailStyles } from './DesktopMachineDetailLayout'
import { resolveDesktopLocalServicePresentation } from './desktopMachinePresentation'
import { runDesktopLocalServiceAction } from './desktopMachineDetailCommands'

export function DesktopLocalMachineServiceSection({ machineId, serverOnline }: {
  machineId: string
  serverOnline: boolean | null
}) {
  const desktop = useDesktopControlState()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useState('')
  const accountId = useAuthStore((state) => state.user?.id)
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const matchingMachine = desktop.status?.machineId === machineId
  const visibleError = error || desktop.error || desktop.status?.error || (
    desktop.status?.remoteAccessDisabled && desktop.status.running && !desktop.status.stale
      ? t('desktop_local_pause_incomplete') : ''
  )
  const serviceState = getDesktopControlStateKey(desktop.status, {
    unavailable: !desktop.available,
    connectorMissing: desktop.connectorSource?.kind === 'missing',
    setupRunning: desktop.setupRunning,
    serverOnline,
    serverMachineKnown: matchingMachine,
  })
  const presentation = resolveDesktopLocalServicePresentation({
    state: serviceState,
    matchingMachine,
    bridgeAvailable: Boolean(desktop.bridge),
    running: desktop.status?.running && !desktop.status.stale,
    actionFailed: Boolean(visibleError),
  })
  const serviceLabel = t(
    presentation.status === 'running'
      ? 'desktop_local_running'
      : presentation.status === 'stopped'
        ? 'desktop_local_stopped'
        : presentation.status === 'checking'
          ? 'desktop_local_detecting'
          : 'agents_runtime_needs_attention',
  )
  const invoke = async (action: 'toggle' | 'log') => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      if (
        !desktop.bridge ||
        desktop.status?.machineId !== machineId ||
        useAuthStore.getState().user?.id !== accountId
      )
        throw new Error(t('desktop_local_action_failed'))
      if (action === 'log') {
        if (!desktop.bridge.openLog) throw new Error(t('desktop_local_action_failed'))
        await desktop.bridge.openLog()
      } else {
        await runDesktopLocalServiceAction(desktop.bridge, presentation.toggle, t('desktop_local_action_failed'))
      }
      if (alive.current && useAuthStore.getState().user?.id === accountId) await desktop.refresh()
    } catch (cause) {
      if (alive.current && useAuthStore.getState().user?.id === accountId) {
        setError(cause instanceof Error ? cause.message : t('desktop_local_action_failed'))
        await desktop.refresh()
      }
    } finally {
      pendingRef.current = false
      if (alive.current) setPending(false)
    }
  }
  return (
    <View
      style={[desktopMachineDetailStyles.section, styles.section, { borderColor: colors.border }]}
    >
      <View style={styles.header}>
        <View style={styles.identity}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('desktop_local_section_title')}
          </Text>
          <View style={styles.status}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: presentation.status === 'running'
                  ? colors.success
                  : presentation.status === 'attention'
                    ? colors.warning
                    : colors.textTertiary },
              ]}
            />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>
              {serviceLabel}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <DesktopMachineAction
            compact
            label={t(
              presentation.toggle === 'stop'
                ? 'desktop_local_stop_access'
                : desktop.status?.remoteAccessDisabled
                  ? 'desktop_local_resume_access'
                  : 'desktop_local_start_access',
            )}
            disabled={pending || !presentation.canToggle}
            onPress={() => void invoke('toggle')}
          />
          <DesktopMachineAction
            compact
            label={t('desktop_local_export_log')}
            disabled={pending}
            onPress={() => void invoke('log')}
          />
        </View>
      </View>
      <DesktopMachineAction
        compact
        label={t('desktop_local_diagnostics')}
        expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <View
          testID="desktop-machine-diagnostics"
          style={[styles.diagnostics, { borderTopColor: colors.border }]}
        >
          <Text style={[styles.diagnosticText, { color: colors.textSecondary }]}>
            {t('desktop_local_runtime_source', {
              source: getDesktopConnectorSourceLabel(desktop.status, desktop.connectorSource),
            })}
          </Text>
          <Text style={[styles.diagnosticText, { color: colors.textSecondary }]}>
            {t('desktop_local_app_version', {
              version: desktop.appVersion ?? t('desktop_local_detecting'),
            })}
          </Text>
        </View>
      ) : null}
      {visibleError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {visibleError}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  identity: { minWidth: 220, flex: 1, gap: 7 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  status: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  diagnostics: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 4 },
  diagnosticText: { fontSize: 12, lineHeight: 18 },
  error: { fontSize: 12, lineHeight: 18 },
})
