// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-machine-detail.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { createDesktopMachineDetailCommands } from './desktopMachineDetailCommands'
import { desktopMachinePort } from './desktopMachinePort'
import { useDesktopMachineListModel } from './useDesktopMachineListModel'
import { isRemoteAccessPauseUnsupported } from '../machines/utils/remote-access-pause'

export function useDesktopMachineDetailModel(machineId: string) {
  const { t } = useTranslation()
  const accountId = useAuthStore(state => state.user?.id)
  const projection = useDesktopMachineListModel()
  const machine = projection.machines.find(value => value.id === machineId)
  const latest = useRef(machine); latest.current = machine
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const scope = useMemo(() => ({ active: false, pending: false }), [accountId, machineId])
  useEffect(() => {
    scope.active = true; setPending(false); setError('')
    return () => { scope.active = false }
  }, [scope])
  const commands = useMemo(() => createDesktopMachineDetailCommands({
    current: () => scope.active && useAuthStore.getState().user?.id === accountId,
    machine: () => latest.current, port: desktopMachinePort,
  }), [scope, accountId])
  const run = async (operation: () => Promise<void>): Promise<boolean> => {
    if (scope.pending || !scope.active) return false
    scope.pending = true
    setPending(true); setError('')
    try { await operation(); return scope.active }
    catch (error) {
      if (scope.active) setError(isRemoteAccessPauseUnsupported(error) ? t('machine_pause_upgrade_required') : error instanceof Error ? error.message : t('error_unknown'))
      return false
    }
    finally { scope.pending = false; if (scope.active) setPending(false) }
  }
  return { machine, surface: projection.surface, retry: projection.retry, commands, run, pending, error }
}
