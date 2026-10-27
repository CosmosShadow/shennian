// @arch docs/architecture/app/modular-features.md#登录-feature

import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { loginWithDesktopPhone, requestDesktopPhoneCode, useAuthStore } from '../../../config/auth'
import { api } from '../../../config/api'
import { beginLoginServerUse } from '../../../config/server'
import { getAuthDeviceMetadata } from '../utils/installation'
import { createRequestTimeoutSignal, getSendCodeErrorTranslationKey } from '../utils/sendCodeError'
import { getVerifyCodeErrorTranslationKey } from '../utils/verifyCodeError'
import {
  offerAccountNicknameSetup,
  offerScopedNicknameSetup,
  type ScopedNicknameSetup,
} from '../offerNicknameSetup'
import type { AuthResponse } from '../types'
import { DEFAULT_AUTH_REDIRECT } from '../utils/redirect'
import { isDesktopControlSurfaceEnabled } from '../../../utils/controlSurfaceLayout'
import { isPhoneLoginCodeComplete, isPhoneLoginNumberComplete } from '../utils/phoneLoginValidation'

declare global {
  interface Window {
    TencentCaptcha?: new (
      appId: string,
      callback: (res: { ret: number; ticket: string; randstr: string }) => void,
    ) => { show: () => void }
  }
}

type Options = {
  verifyIdentity?: (phone: string, code: string, name?: string) => Promise<void>
  captchaAppId?: string
  redirectTo?: string
  verifyScopedRoom?: boolean
  scopedRoomId?: string
  scopedInviteRoomId?: string
  onScopedAttempt?: () => void
  scopedJoinMessage?: string
  deferScopedInviteJoin?: boolean
  onScopedResult?: (result: {
    scopedPath?: string
    outcome?: 'joined' | 'pending_approval' | 'needs_application' | 'join_closed'
  }) => boolean
}

export function usePhoneLogin({
  verifyIdentity,
  captchaAppId = '',
  redirectTo = DEFAULT_AUTH_REDIRECT,
  verifyScopedRoom = false,
  scopedRoomId,
  scopedJoinMessage,
  deferScopedInviteJoin = false,
  scopedInviteRoomId,
  onScopedAttempt,
  onScopedResult,
}: Options) {
  const { t } = useTranslation()
  const router = useRouter()
  const login = useAuthStore((s) => s.login)

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captchaVisible, setCaptchaVisible] = useState(false)
  const [captchaScriptReady, setCaptchaScriptReady] = useState(false)

  useEffect(() => {
    if (Platform.OS !== 'web' || !captchaAppId) {
      setCaptchaScriptReady(false)
      return
    }
    if (typeof document === 'undefined') return
    if (document.getElementById('tencent-captcha-script')) {
      setCaptchaScriptReady(true)
      return
    }
    const script = document.createElement('script')
    script.id = 'tencent-captcha-script'
    script.src = 'https://ssl.captcha.qq.com/TCaptcha.js'
    script.async = true
    script.onload = () => setCaptchaScriptReady(true)
    script.onerror = () => setCaptchaScriptReady(false)
    document.head.appendChild(script)
  }, [captchaAppId])

  const postSendCode = useCallback(
    async (ticket?: string, randstr?: string) => {
      const input = {
        phone: `+86${phone}`,
        ...(ticket && randstr ? { ticket, randstr } : {}),
      }
      if (isDesktopControlSurfaceEnabled()) {
        await requestDesktopPhoneCode(input)
      } else {
        await api('/auth/send-code', {
          method: 'POST',
          signal: createRequestTimeoutSignal(),
          body: JSON.stringify(input),
        })
      }
      setCountdown(60)
    },
    [phone],
  )

  const handleSendCode = useCallback(async () => {
    if (countdown > 0 || !isPhoneLoginNumberComplete(phone) || sendingCode) return
    setError('')

    if (captchaAppId) {
      if (Platform.OS === 'web') {
        if (!captchaScriptReady || !window.TencentCaptcha) {
          setError(t('captcha_loading'))
          return
        }
        const inst = new window.TencentCaptcha(captchaAppId, async (res) => {
          if (res.ret === 0) {
            setSendingCode(true)
            try {
              await postSendCode(res.ticket, res.randstr)
            } catch (error) {
              setError(t(getSendCodeErrorTranslationKey(error)))
            } finally {
              setSendingCode(false)
            }
          } else if (res.ret !== 2) {
            setError(t('error_send_code'))
          }
        })
        inst.show()
        return
      }

      setCaptchaVisible(true)
      return
    }

    setSendingCode(true)
    try {
      await postSendCode()
    } catch (error) {
      setError(t(getSendCodeErrorTranslationKey(error)))
    } finally {
      setSendingCode(false)
    }
  }, [captchaAppId, captchaScriptReady, countdown, phone, postSendCode, sendingCode, t])

  const handleCaptchaVerified = useCallback(
    async (ticket: string, randstr: string) => {
      setSendingCode(true)
      setError('')
      try {
        await postSendCode(ticket, randstr)
      } catch (error) {
        setError(t(getSendCodeErrorTranslationKey(error)))
      } finally {
        setSendingCode(false)
      }
    },
    [postSendCode, t],
  )

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          clearInterval(timer)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown])

  const performLogin = useCallback(async () => {
    if (!isPhoneLoginNumberComplete(phone) || !isPhoneLoginCodeComplete(code) || loading) return
    setError('')
    setLoading(true)
    let nextPath = redirectTo
    try {
      if (verifyIdentity) {
        await verifyIdentity(`+86${phone}`, code)
        setCode('')
        return
      }
      if (verifyScopedRoom) {
        const data = await api<{
          scopedPath?: string
          outcome?: 'joined' | 'pending_approval' | 'needs_application' | 'join_closed'
          nicknameSetup?: ScopedNicknameSetup
        }>(
          scopedRoomId
            ? `/room-browser/${encodeURIComponent(scopedRoomId)}/scoped/verify-phone`
            : deferScopedInviteJoin
              ? '/room-invites/scoped/verify-phone'
              : '/room-invites/scoped/verify-phone-and-join',
          {
            method: 'POST',
            credentials: 'include',
            body: JSON.stringify({
              phone: `+86${phone}`,
              code,
              rememberBrowser: false,
              ...(scopedInviteRoomId ? { roomId: scopedInviteRoomId } : {}),
              ...(scopedJoinMessage?.trim() ? { message: scopedJoinMessage.trim() } : {}),
            }),
          },
        )
        await offerScopedNicknameSetup(data.nicknameSetup)
        if (onScopedResult?.(data)) return
        nextPath =
          data.scopedPath ??
          (scopedRoomId ? `/spaces/${encodeURIComponent(scopedRoomId)}` : redirectTo)
      } else {
        const device = await getAuthDeviceMetadata()
        const data = isDesktopControlSurfaceEnabled()
          ? await loginWithDesktopPhone({
              phone: `+86${phone}`,
              code,
              deviceName: device.deviceName,
              installationId: device.installationId,
            })
          : await api<AuthResponse>('/auth/verify-code', {
              method: 'POST',
              body: JSON.stringify({
                phone: `+86${phone}`,
                code,
                ...device,
              }),
            })
        await login(data.token, data.refreshToken, data.user)
        offerAccountNicknameSetup(data.user)
      }
    } catch (error) {
      setError(t(getVerifyCodeErrorTranslationKey(error)))
      return
    } finally {
      setLoading(false)
      if (verifyScopedRoom) onScopedAttempt?.()
    }

    try {
      if (verifyScopedRoom && Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(nextPath)
      } else {
        router.replace(nextPath as never)
      }
    } catch {
      // Auth state is already persisted; the auth layout will redirect on the next render.
    } finally {
      setError('')
    }
  }, [
    deferScopedInviteJoin,
    verifyIdentity,
    scopedInviteRoomId,
    onScopedAttempt,
    code,
    loading,
    login,
    onScopedResult,
    phone,
    redirectTo,
    router,
    scopedJoinMessage,
    scopedRoomId,
    t,
    verifyScopedRoom,
  ])

  const handleLogin = useCallback(async () => {
    const release = beginLoginServerUse()
    try { await performLogin() } finally { release() }
  }, [performLogin])

  const clearError = useCallback(() => setError(''), [])

  return {
    phone,
    setPhone,
    code,
    setCode,
    countdown,
    sendingCode,
    loading,
    setLoading,
    error,
    setError,
    clearError,
    captchaVisible,
    setCaptchaVisible,
    handleSendCode,
    handleCaptchaVerified,
    handleLogin,
  }
}
