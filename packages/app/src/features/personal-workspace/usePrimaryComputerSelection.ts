// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/remote-folders.test.ts
import { useState } from 'react'
import { Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { usePrimaryMachine } from './usePrimaryMachine'
import { primaryMachineClient, personalErrorKey } from './client'

export function usePrimaryComputerSelection() {
  const { t } = useTranslation()
  const primary = usePrimaryMachine()
  const userId = useAuthStore(s => s.user?.id)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const isCurrent = (machine: Machine) => primary.record?.machine?.id === machine.id
  const isEligible = (machine: Machine) => machine.paired && machine.role !== 'granted' && !machine.remoteAccessDisabledAt
  const canChoose = (machine: Machine) => isEligible(machine) && machine.online && !saving && !primary.loading && primary.record?.revision !== undefined && !isCurrent(machine)
  const choose = (machine: Machine) => {
    if (!canChoose(machine)) return
    const { id: machineId, name } = machine
    const revision = primary.record?.revision
    if (saving || revision === undefined) return
    Alert.alert(t('personal_primary_confirm_title', { name }), t('personal_primary_confirm_body'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('personal_primary_confirm'), onPress: () => {
        if (useAuthStore.getState().user?.id !== userId) return
        setSaving(true); setFailure(null)
        void primaryMachineClient.set(machineId, revision).then(() => {
          if (useAuthStore.getState().user?.id === userId) primary.refresh()
        }).catch(error => { if (useAuthStore.getState().user?.id === userId) { setFailure(personalErrorKey(error)); primary.refresh() } })
          .finally(() => { if (useAuthStore.getState().user?.id === userId) setSaving(false) })
      } },
    ])
  }
  const retry = () => { setFailure(null); primary.refresh() }
  return { primary, saving, failure, choose, isCurrent, isEligible, canChoose, retry }
}
