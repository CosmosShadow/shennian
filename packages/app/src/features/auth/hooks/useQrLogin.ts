// @arch docs/architecture/app/modular-features.md#登录-feature

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import {
  createDesktopQrLogin,
  pollDesktopQrLogin,
  useAuthStore,
} from '../../../config/auth'
import { offerAccountNicknameSetup } from '../offerNicknameSetup'
import { api } from '../../../config/api'
import type { QrCreateResponse, QrStatus, QrStatusResponse } from '../types'
import { createQrLoginDataUrl, qrLoginFailureCode } from '../qrLogin'
import { DEFAULT_AUTH_REDIRECT } from '../utils/redirect'
import { getAuthDeviceMetadata } from '../utils/installation'
import { isDesktopControlSurfaceEnabled } from '../../../utils/controlSurfaceLayout'

export function useQrLogin(enabled: boolean, redirectTo = DEFAULT_AUTH_REDIRECT) {
  const { t } = useTranslation()
  const router = useRouter()
  const login = useAuthStore((s) => s.login)
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const [qrId, setQrId] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [qrStatus, setQrStatus] = useState<QrStatus>('pending')
  const [error, setError] = useState('')

  const createQr = useCallback(async () => {
    setQrStatus('pending')
    setQrUrl('')
    setQrId('')
    setError('')
    try {
      const device = await getAuthDeviceMetadata()
      const data = isDesktopControlSurfaceEnabled()
        ? await createDesktopQrLogin({ installationId: device.installationId })
        : await api<QrCreateResponse>('/auth/qr/create', {
          method: 'POST',
          body: JSON.stringify(device),
        })
      setQrId(data.qrId)
      setQrUrl(await createQrLoginDataUrl(data.qrId))
    } catch {
      setError(t('error_create_qr'))
    }
  }, [t])

  useEffect(() => {
    if (!enabled) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    void createQr()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [createQr, enabled])

  useEffect(() => {
    if (!enabled || !qrId) return
    let inFlight = false
    let completed = false

    pollRef.current = setInterval(async () => {
      if (inFlight || completed) return
      inFlight = true
      try {
        const data = isDesktopControlSurfaceEnabled()
          ? await pollDesktopQrLogin(qrId)
          : await api<QrStatusResponse>(`/auth/qr/status/${qrId}`)
        setQrStatus(data.status)

        if (data.status === 'confirmed' && data.token && data.refreshToken && data.user) {
          completed = true
          if (pollRef.current) clearInterval(pollRef.current)
          await login(data.token, data.refreshToken, data.user)
          offerAccountNicknameSetup(data.user)
          router.replace(redirectTo as never)
        }

        if (data.status === 'expired' && pollRef.current) {
          clearInterval(pollRef.current)
        }
      } catch (cause) {
        if (pollRef.current) clearInterval(pollRef.current)
        setError(t('qr_login_failed', { code: qrLoginFailureCode(cause) }))
      } finally {
        inFlight = false
      }
    }, 3000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [enabled, login, qrId, redirectTo, router, t])

  return {
    qrUrl,
    qrStatus,
    error,
    setError,
    createQr,
  }
}
