import { useEffect, useRef, useCallback } from 'react'
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native'
import * as Google from 'expo-auth-session/providers/google'
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
  webClientId: string
  iosClientId?: string
  androidClientId?: string
  loading: boolean
  onLoadingChange: (v: boolean) => void
  onError: (msg: string) => void
  inviteCode?: string
  redirectTo?: string
  colors: {
    border: string
    surface: string
    text: string
  }
}

export function GoogleSignInButton({
  webClientId,
  iosClientId,
  androidClientId,
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
  const handledRef = useRef<string | null>(null)

  const [, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId,
    iosClientId,
    androidClientId,
  })

  useEffect(() => {
    if (response?.type !== 'success' || !response.params.id_token) return
    const idTok = response.params.id_token
    if (handledRef.current === idTok) return
    handledRef.current = idTok

    let cancelled = false
    void (async () => {
      onLoadingChange(true)
      onError('')
      try {
        const device = await getAuthDeviceMetadata()
        const data = await api<AuthResponse>('/auth/google', {
          method: 'POST',
          body: JSON.stringify({
            idToken: idTok,
            ...device,
            ...(inviteCode?.trim() ? { inviteCode: inviteCode.trim() } : {}),
          }),
        })
        if (!cancelled) {
          await login(data.token, data.refreshToken, data.user)
          router.replace(redirectTo as never)
        }
      } catch {
        if (!cancelled) onError(t('error_google_login'))
      } finally {
        if (!cancelled) onLoadingChange(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [response, inviteCode, login, redirectTo, router, t, onLoadingChange, onError])

  const handlePress = useCallback(() => {
    onError('')
    void promptAsync()
  }, [promptAsync, onError])

  return (
    <Pressable
      style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.surface }]}
      onPress={handlePress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : (
        <Text style={[styles.btnText, { color: colors.text }]}>
          {t('login_with_google')}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 12,
    height: 48,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
})
