import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { api } from '../../config/api'
import { getAuthDeviceMetadata } from '../../features/auth/utils/installation'

type AuthResponse = {
  token: string
  refreshToken: string
  user: { id: string; phone: string; email: string | null; name: string }
}

type Props = {
  loading: boolean
  onLoadingChange: (v: boolean) => void
  onError: (msg: string) => void
  inviteCode?: string
  redirectTo?: string
  colors: { border: string; surface: string; text: string }
}

function loadAppleSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).AppleID) return resolve()
    const s = document.createElement('script')
    s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
}

export function AppleSignInButton({
  loading,
  onLoadingChange,
  onError,
  inviteCode,
  redirectTo = '/(main)',
  colors,
}: Props) {
  const { t } = useTranslation()
  const router = useRouter()
  const login = useAuthStore((s) => s.login)
  const [serviceId, setServiceId] = useState<string | null>(null)

  useEffect(() => {
    void api<{ appleServiceId: string | null }>('/auth/public-config')
      .then((cfg) => setServiceId(cfg.appleServiceId))
      .catch(() => {})
  }, [])

  const handlePress = useCallback(async () => {
    if (loading || !serviceId) return
    onLoadingChange(true)
    onError('')

    try {
      await loadAppleSDK()
      const AppleID = (window as any).AppleID
      AppleID.auth.init({
        clientId: serviceId,
        scope: 'name email',
        redirectURI: `${window.location.origin}/auth/apple/callback`,
        usePopup: true,
      })
      const res = await AppleID.auth.signIn()
      const idToken = res.authorization?.id_token
      if (!idToken) throw new Error('no id_token')

      const device = await getAuthDeviceMetadata()
      const data = await api<AuthResponse>('/auth/apple', {
        method: 'POST',
        body: JSON.stringify({
          identityToken: idToken,
          fullName: res.user ? `${res.user.name?.firstName ?? ''} ${res.user.name?.lastName ?? ''}`.trim() : undefined,
          email: res.user?.email,
          ...device,
          ...(inviteCode?.trim() ? { inviteCode: inviteCode.trim() } : {}),
        }),
      })
      await login(data.token, data.refreshToken, data.user)
      router.replace(redirectTo as never)
    } catch (e: any) {
      if (e?.error === 'popup_closed_by_user') return
      onError(t('error_apple_login'))
    } finally {
      onLoadingChange(false)
    }
  }, [loading, serviceId, inviteCode, login, onError, onLoadingChange, redirectTo, router, t])

  if (!serviceId) return null

  return (
    <Pressable
      style={[styles.button, { borderColor: colors.border }]}
      onPress={() => void handlePress()}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={styles.buttonText}> Sign in with Apple</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
