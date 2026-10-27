// @arch docs/features/network-rooms/implementation-plan.md#四、登录、昵称与头像
// @test src/__tests__/login-intent-web.test.ts

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import Head from 'expo-router/head'
import { useTranslation } from 'react-i18next'
import { offerScopedNicknameSetup, type ScopedNicknameSetup } from '../../src/features/auth/offerNicknameSetup'
import { api } from '../../src/config/api'
import { getServerUrl } from '../../src/config/server'
import { useTheme } from '../../src/hooks/useTheme'
import { usePhoneLogin } from '../../src/features/auth/hooks/usePhoneLogin'
import { useAuthPublicConfig } from '../../src/features/auth/hooks/useAuthPublicConfig'
import { PhoneLoginPanel } from '../../src/features/auth/components/PhoneLoginPanel'
import { PairingQrPanel } from '../../src/features/auth/components/PairingQrPanel'
import { TencentCaptchaModal } from '../../src/components/auth/TencentCaptchaModal'

type PublicIntent = { id: string; expired: boolean }

export default function DeviceAuthorizationScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const params = useLocalSearchParams<{ intentId?: string | string[] }>()
  const intentId = Array.isArray(params.intentId) ? params.intentId[0] : params.intentId
  const [intent, setIntent] = useState<PublicIntent | null>(null)
  const [loading, setLoading] = useState(true)
  const [approved, setApproved] = useState(false)
  const [method, setMethod] = useState<'phone' | 'qr'>('phone')
  const [qrOpened, setQrOpened] = useState(false)
  const [error, setError] = useState('')
  const config = useAuthPublicConfig()
  const handleQrApproved = useCallback(() => setApproved(true), [])
  const verifyIdentity = useCallback(async (phone: string, code: string, name?: string) => {
    const result = await api<{ nicknameSetup?: ScopedNicknameSetup }>(`/auth/device-authorizations/${encodeURIComponent(intentId ?? '')}/verify-phone`, {
      method: 'POST', credentials: 'omit', body: JSON.stringify({ phone, code, ...(name ? { name } : {}) }),
    })
    setApproved(true)
    await offerScopedNicknameSetup(result.nicknameSetup)
  }, [intentId])
  const phoneLogin = usePhoneLogin({
    captchaAppId: config.tencentCaptchaAppId ?? '', verifyIdentity,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setIntent(null)
    setError('')
    if (!intentId) {
      setError(t('device_auth_invalid'))
      setLoading(false)
      return
    }
    try {
      setIntent(await api<PublicIntent>(
        `/auth/device-authorizations/${encodeURIComponent(intentId)}/public`,
        { credentials: 'omit' },
      ))
    } catch {
      setError(t('device_auth_unavailable'))
    } finally {
      setLoading(false)
    }
  }, [intentId, t])

  useEffect(() => {
    setApproved(false)
    void load()
  }, [load])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Head>
        <title>{t('device_auth_title')} · {t('app_name')}</title>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.brand, { color: colors.text }]}>{t('app_name')}</Text>
          <Text style={[styles.title, { color: colors.text }]}>{t('device_auth_title')}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('device_auth_subtitle')}</Text>
          {loading ? <ActivityIndicator style={styles.loading} color={colors.brand} /> :
            error ? <>
              <Text accessibilityRole="alert" style={[styles.notice, { color: colors.error }]}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.primaryButton}>
                <Text style={{ color: colors.brand }}>{t('retry')}</Text>
              </Pressable>
            </> : intent ? <>
              {approved ? <View style={[styles.result, { backgroundColor: colors.brandLight }]}>
                <Text accessibilityRole="alert" style={[styles.resultTitle, { color: colors.brand }]}>{t('device_auth_approved')}</Text>
                <Text style={[styles.resultBody, { color: colors.textSecondary }]}>{t('device_auth_close')}</Text>
              </View> : intent.expired ?
                <Text style={[styles.notice, { color: colors.error }]}>{t('device_auth_expired')}</Text> : <>
                  <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: colors.surfaceHover }]}>
                    {(['phone', 'qr'] as const).map((value) => (
                      <Pressable key={value} testID={`pairing-tab-${value}`} accessibilityRole="tab"
                        accessibilityState={{ selected: method === value }}
                        onPress={() => { setMethod(value); if (value === 'qr') setQrOpened(true) }}
                        style={[styles.tab, method === value && { backgroundColor: colors.bg }]}>
                        <Text style={[styles.tabText, { color: method === value ? colors.text : colors.textSecondary }]}>
                          {t(value === 'phone' ? 'device_auth_phone_tab' : 'device_auth_qr_tab')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.methodBody}>
                    <View style={{ display: method === 'phone' ? 'flex' : 'none' }}>
                      <PhoneLoginPanel {...phoneLogin} colors={colors} onSendCode={phoneLogin.handleSendCode}
                        onLogin={phoneLogin.handleLogin} submitLabel={t('device_auth_approve')} />
                      {phoneLogin.error ? <Text accessibilityRole="alert" style={[styles.notice, { color: colors.error }]}>{phoneLogin.error}</Text> : null}
                    </View>
                    {qrOpened ? <View style={{ display: method === 'qr' ? 'flex' : 'none' }}>
                      <PairingQrPanel intentId={intent.id} colors={colors} onApproved={handleQrApproved} />
                    </View> : null}
                  </View>
                </>}
            </> : null}
          <View style={[styles.downloads, { borderTopColor: colors.border }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{t('device_auth_download_app')}</Text>
            <View style={styles.downloadLinks}>
              <Pressable accessibilityRole="link" accessibilityLabel={t('device_auth_download_android')}
                onPress={() => void Linking.openURL(`${getServerUrl()}/download/android`)} style={styles.downloadLink}>
                <Text style={{ color: colors.brand, fontSize: 13 }}>Android</Text>
              </Pressable>
              <Pressable accessibilityRole="link" accessibilityLabel={t('device_auth_download_ios')}
                onPress={() => void Linking.openURL('https://apps.apple.com/app/id6761320881')} style={styles.downloadLink}>
                <Text style={{ color: colors.brand, fontSize: 13 }}>iOS</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
      <TencentCaptchaModal visible={phoneLogin.captchaVisible} appId={config.tencentCaptchaAppId ?? ''}
        onClose={() => phoneLogin.setCaptchaVisible(false)} onVerified={phoneLogin.handleCaptchaVerified} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 400, borderWidth: 1, borderRadius: 16, padding: 24 },
  brand: { fontSize: 15, lineHeight: 22, fontWeight: '600', marginBottom: 12 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 8 },
  loading: { marginVertical: 48 },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: 12, marginTop: 24 },
  tab: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  methodBody: { marginTop: 24, minHeight: 260 },
  downloads: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 16 },
  downloadLinks: { flexDirection: 'row', gap: 16 },
  downloadLink: { minHeight: 44, justifyContent: 'center' },
  primaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  result: { borderRadius: 12, padding: 16, marginTop: 24 },
  resultTitle: { fontSize: 16, fontWeight: '600' },
  resultBody: { fontSize: 15, lineHeight: 22, marginTop: 8 },
  notice: { fontSize: 15, lineHeight: 22, marginTop: 16 },
})
