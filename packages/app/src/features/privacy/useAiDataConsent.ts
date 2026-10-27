// @arch docs/features/ai-data-sharing-consent.md
// @test src/__tests__/ai-data-consent.test.ts

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { requestAiDataConsent } from './aiDataConsent'

export function usePersonalAiDataConsent(): () => Promise<boolean> {
  const { t } = useTranslation()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  return useCallback(() => requestAiDataConsent({
    accountId,
    kind: 'personal',
    title: t('ai_consent_personal_title'),
    message: t('ai_consent_personal_body'),
    allowLabel: t('ai_consent_allow_connect'),
    declineLabel: t('ai_consent_not_now'),
    privacyLabel: t('ai_consent_privacy'),
  }), [accountId, t])
}
