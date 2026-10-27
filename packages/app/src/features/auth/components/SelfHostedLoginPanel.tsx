// @arch docs/features/self-hosted-instances.md
// @test src/__tests__/self-hosted-login.test.ts
// @test src/__tests__/login-server-tabs.test.ts
import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../../hooks/useTheme'
import { getServerUrl, isSelfHostedSelection, selectLoginServer, beginLoginServerUse } from '../../../config/server'
import { useAuthStore } from '../../../config/auth'
import { api } from '../../../config/api'
import { getAuthDeviceMetadata } from '../utils/installation'
import type { AuthResponse } from '../types'

export type LoginServerMode = 'cloud' | 'self-hosted'

export function ServerSelector({ colors, disabled, mode, onModeChange, onReadyChange }: {
  colors: Colors
  disabled?: boolean
  mode: LoginServerMode
  onModeChange: (mode: LoginServerMode) => void
  onReadyChange: (ready: boolean) => void
}) {
  const { t } = useTranslation()
  const [address, setAddress] = useState(isSelfHostedSelection() ? getServerUrl() : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function select(value: string | null) {
    if (busy || disabled) return
    if (useAuthStore.getState().token || useAuthStore.getState().refreshToken) { setError(t('selfhost_bound')); return }
    setBusy(true); setError('')
    try {
      await selectLoginServer(value)
      onModeChange(value === null ? 'cloud' : 'self-hosted')
      onReadyChange(value !== null)
    } catch { setError(t('selfhost_connection_error')) }
    finally { setBusy(false) }
  }
  function changeTab(next: LoginServerMode) {
    if (busy || disabled || next === mode) return
    setError('')
    if (next === 'cloud' && isSelfHostedSelection()) { void select(null); return }
    onModeChange(next)
  }
  return <View style={{ marginBottom: 26, gap: 16 }}>
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: colors.surfaceHover, gap: 4 }}>
      {(['cloud', 'self-hosted'] as const).map(value => <Pressable
        key={value}
        testID={value === 'cloud' ? 'server-tab-cloud' : 'server-tab-self-hosted'}
        accessibilityRole="tab"
        accessibilityState={{ selected: mode === value, disabled: busy || disabled }}
        disabled={busy || disabled}
        onPress={() => changeTab(value)}
        style={{ flex: 1, minHeight: 46, paddingHorizontal: 8, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === value ? colors.surface : 'transparent', opacity: disabled ? 0.5 : 1 }}
      ><Text style={{ fontSize: 14, lineHeight: 20, fontWeight: mode === value ? '600' : '500', color: mode === value ? colors.brand : colors.textSecondary }}>{t(value === 'cloud' ? 'selfhost_cloud' : 'selfhost_server')}</Text></Pressable>)}
    </View>
    {mode === 'self-hosted' && <View style={{ gap: 12 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{t('selfhost_server_intro')}</Text>
      <TextInput testID="server-address-input" accessibilityLabel={t('selfhost_address')} value={address}
        onChangeText={value => { setAddress(value); setError(''); onReadyChange(false) }}
        editable={!busy && !disabled} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        placeholder={t('selfhost_address')} placeholderTextColor={colors.textTertiary}
        style={{ color: colors.text, backgroundColor: colors.surfaceHover, borderColor: colors.border, borderWidth: 1, borderRadius: 14, minHeight: 52, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15 }} />
      <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 18 }}>{t('selfhost_tls_hint')}</Text>
      <Pressable accessibilityRole="button" testID="server-connect" disabled={busy || disabled || !address.trim()}
        onPress={() => void select(address)}
        style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.brandLight, alignItems: 'center', justifyContent: 'center', opacity: busy || disabled || !address.trim() ? 0.5 : 1 }}>
        {busy ? <ActivityIndicator color={colors.brand} /> : <Text style={{ color: colors.brand, fontSize: 15, fontWeight: '600' }}>{t('selfhost_connect')}</Text>}
      </Pressable>
    </View>}
    {busy && mode === 'cloud' && <ActivityIndicator color={colors.brand} />}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13, lineHeight: 20 }}>{error}</Text>}
  </View>
}

export function SelfHostedLoginPanel({ colors, redirectTo, onBusyChange }: { colors: Colors; redirectTo: string; onBusyChange: (busy: boolean) => void }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [register, setRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    if (busy) return
    setBusy(true); onBusyChange(true); setError('')
    const release = beginLoginServerUse()
    try {
      const result = await api<AuthResponse>(`/auth/local/${register ? 'register' : 'login'}`, {
        method: 'POST', body: JSON.stringify({ username, password, ...(register ? { invite } : {}), ...await getAuthDeviceMetadata() }),
      })
      await useAuthStore.getState().login(result.token, result.refreshToken, result.user)
      setPassword(''); router.replace(redirectTo as never)
    } catch { setError(t('selfhost_login_error')) }
    finally { release(); setBusy(false); onBusyChange(false) }
  }
  const submitDisabled = busy || username.trim().length < 3 || password.length < 12
  const field = { color: colors.text, backgroundColor: colors.surfaceHover, borderColor: colors.border, borderWidth: 1, borderRadius: 14, minHeight: 50, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15 }
  return <View style={{ gap: 14 }}>
    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{t(register ? 'selfhost_register' : 'selfhost_login')}</Text>
    <TextInput testID="local-username" accessibilityLabel={t('selfhost_username')} placeholder={t('selfhost_username')} placeholderTextColor={colors.textTertiary} style={field} autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} editable={!busy} />
    <TextInput testID="local-password" accessibilityLabel={t('selfhost_password')} placeholder={t('selfhost_password')} placeholderTextColor={colors.textTertiary} style={field} secureTextEntry value={password} onChangeText={setPassword} editable={!busy} />
    {register && <TextInput testID="local-invite" accessibilityLabel={t('selfhost_invite')} placeholder={t('selfhost_invite')} placeholderTextColor={colors.textTertiary} style={field} autoCapitalize="none" value={invite} onChangeText={setInvite} editable={!busy} />}
    <Pressable testID="local-submit" accessibilityRole="button" disabled={submitDisabled} onPress={() => void submit()} style={{ backgroundColor: colors.brand, minHeight: 50, justifyContent: 'center', padding: 14, borderRadius: 14, opacity: submitDisabled ? 0.45 : 1 }}><Text style={{ color: '#fff', textAlign: 'center', fontSize: 15, fontWeight: '600' }}>{t(register ? 'selfhost_register' : 'selfhost_login')}</Text></Pressable>
    <Pressable accessibilityRole="button" testID="local-switch-mode" disabled={busy} onPress={() => setRegister(!register)}><Text style={{ color: colors.brand }}>{t(register ? 'selfhost_login' : 'selfhost_register')}</Text></Pressable>
    {busy && <ActivityIndicator color={colors.brand} />}
    {!!error && <Text testID="local-login-error" accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
  </View>
}
