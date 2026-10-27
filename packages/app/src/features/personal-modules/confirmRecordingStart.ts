// @arch docs/features/personal-modules.md
// @test src/__tests__/recording-start-consent.test.ts
import { Alert } from 'react-native'
import { useAuthStore } from '../../config/auth'
import i18n from '../../config/i18n'
import { requestAiDataConsent } from '../privacy/aiDataConsent'
import { currentRecordingTarget } from './audioArchive'
import { moduleStore, startRecording, useRecordingState } from './runtime'

export async function confirmRecordingStart() {
  const accountId = useAuthStore.getState().user?.id
  if (!accountId) return
  const store = await moduleStore()
  const target = await currentRecordingTarget().catch(() =>
    store.cached<{ machineId: string; revision: number }>('recording-target'),
  )
  if (useAuthStore.getState().user?.id !== accountId) return
  if (!target) {
    Alert.alert(i18n.t('personal_start'), i18n.t('personal_error_primary_machine_required'))
    return
  }
  const approved = await requestAiDataConsent({
    accountId,
    kind: 'recording',
    title: i18n.t('personal_start'),
    message: i18n.t('personal_recording_consent'),
    allowLabel: i18n.t('personal_start'),
    declineLabel: i18n.t('cancel'),
    privacyLabel: i18n.t('ai_consent_privacy'),
  })
  if (!approved || useAuthStore.getState().user?.id !== accountId) return
  await startRecording(target)
  const state = useRecordingState.getState()
  if (state.error && !state.active)
    Alert.alert(
      i18n.t('personal_action_failed'),
      i18n.t(`personal_error_${state.error}`, {
        defaultValue: i18n.t('personal_action_failed'),
      }),
    )
}
