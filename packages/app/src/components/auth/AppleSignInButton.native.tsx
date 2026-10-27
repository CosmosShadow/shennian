import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
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
  colors: {
    border: string
    surface: string
    text: string
  }
}

function formatFullName(fullName: AppleAuthentication.AppleAuthenticationFullName | null): string {
  return [
    fullName?.givenName,
    fullName?.middleName,
    fullName?.familyName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
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
  const [available, setAvailable] = useState(false)
  const [availabilityChecked, setAvailabilityChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (Platform.OS !== 'ios') {
      setAvailable(false)
      setAvailabilityChecked(true)
      return
    }

    void AppleAuthentication.isAvailableAsync()
      .then((next) => {
        if (!cancelled) {
          setAvailable(next)
          setAvailabilityChecked(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailable(false)
          setAvailabilityChecked(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const fallbackStyle = useMemo(
    () => [
      styles.fallback,
      {
        borderColor: colors.border,
        backgroundColor: colors.surface,
      },
    ],
    [colors.border, colors.surface],
  )

  const handlePress = useCallback(async () => {
    if (loading || Platform.OS !== 'ios') return

    const nonce = Crypto.randomUUID()
    onLoadingChange(true)
    onError('')

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce,
      })

      if (!credential.identityToken) {
        throw new Error('missing identity token')
      }

      const device = await getAuthDeviceMetadata()
      const data = await api<AuthResponse>('/auth/apple', {
        method: 'POST',
        body: JSON.stringify({
          identityToken: credential.identityToken,
          nonce,
          fullName: formatFullName(credential.fullName) || undefined,
          email: credential.email ?? undefined,
          ...device,
          ...(inviteCode?.trim() ? { inviteCode: inviteCode.trim() } : {}),
        }),
      })

      await login(data.token, data.refreshToken, data.user)
      router.replace(redirectTo as never)
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_REQUEST_CANCELED'
      ) {
        return
      }
      onError(t('error_apple_login'))
    } finally {
      onLoadingChange(false)
    }
  }, [loading, inviteCode, login, onError, onLoadingChange, redirectTo, router, t])

  if (!availabilityChecked) return null

  if (loading) {
    return (
      <View style={fallbackStyle}>
        <ActivityIndicator color={colors.text} size="small" />
      </View>
    )
  }

  if (!available) {
    return (
      <View style={styles.unavailableWrap}>
        <View style={fallbackStyle}>
          <Text style={[styles.unavailableTitle, { color: colors.text }]}>
            {t('login_with_apple')}
          </Text>
        </View>
        <Text style={[styles.unavailableHint, { color: colors.text }]}>
          {t('apple_sign_in_unavailable_hint')}
        </Text>
      </View>
    )
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={12}
      style={styles.button}
      onPress={() => void handlePress()}
    />
  )
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    height: 48,
  },
  fallback: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unavailableWrap: {
    gap: 8,
  },
  unavailableTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  unavailableHint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    opacity: 0.72,
  },
})
