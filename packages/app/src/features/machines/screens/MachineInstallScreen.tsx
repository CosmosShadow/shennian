// @arch docs/features/machine-onboarding.md
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import type { Machine } from '@shennian/wire'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { useGoBack } from '../../../hooks/useGoBack'
import { useTheme } from '../../../hooks/useTheme'
import { getServerUrl } from '../../../config/server'
import { parseScanPayload } from '../../../utils/scan'
import { mobileTypography } from '../../../theme/mobileTypography'
import { fetchAppDownloads, type AppDownloads } from '../../../platform/appDownloads'
import { SetupCopy, SetupRow, SetupText } from '../components/SetupControls'
import { machineAccountClient, isMachineAccountUnauthorized } from '../machineAccountClient'
import { SHENNIAN_CLI_INSTALL_COMMAND } from '../installPrompt'

export default function MachineInstallScreen() {
  const { mode: rawMode, from } = useLocalSearchParams<{ mode?: string; from?: string }>()
  const mode =
    rawMode === 'server' || rawMode === 'pair' || rawMode === 'share' ? rawMode : 'desktop'
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const router = useRouter()
  const secondaryText = Platform.OS === 'web' && !isDark ? '#4b4b4b' : colors.textSecondary
  const goBack = useGoBack()
  const [downloads, setDownloads] = useState<AppDownloads | null>(null)
  const [downloadError, setDownloadError] = useState(false)
  const [machines, setMachines] = useState<Machine[] | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [claimComplete, setClaimComplete] = useState(false)
  const claiming = useRef(false)
  const claimed = useRef<{ machineId?: string } | null>(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const website = getServerUrl().replace(/\/+$/, '')
  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const next = await machineAccountClient.listMachines()
      if (!active.current) return
      if (
        claimed.current?.machineId &&
        !next.some((machine) => machine.id === claimed.current?.machineId)
      ) {
        setError(t('setup_claim_refresh_failed'))
        return
      }
      useMachinesStore.getState().setMachines(next)
      setMachines(next)
      if (claimed.current) setClaimComplete(true)
    } catch {
      if (active.current)
        setError(t(claimed.current ? 'setup_claim_refresh_failed' : 'setup_refresh_failed'))
    } finally {
      if (active.current) setBusy(false)
    }
  }, [t])
  // Returning from the camera or another page only reads authoritative machine state.
  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )
  const loadDownloads = useCallback(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    setDownloadError(false)
    void fetchAppDownloads(controller.signal)
      .then((value) => {
        if (active.current) setDownloads(value)
      })
      .catch(() => {
        if (active.current && !controller.signal.aborted) setDownloadError(true)
      })
      .finally(() => {
        clearTimeout(timer)
        if (active.current && controller.signal.aborted) setDownloadError(true)
      })
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [])
  useEffect(() => (mode === 'desktop' ? loadDownloads() : undefined), [mode, loadDownloads])
  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => setError(t('setup_open_failed')))
  }
  const openPair = () =>
    router.navigate({
      pathname: '/(main)/machine-install',
      params: { mode: 'pair', ...(from === 'create-project' ? { from } : {}) },
    })
  const submit = async () => {
    if (claiming.current || claimed.current) return
    const parsed = parseScanPayload(input, getServerUrl())
    if (parsed?.kind === 'room') {
      Alert.alert(t('setup_room_link'), t('setup_room_link_hint'), [
        {text:t('cancel'),style:'cancel'},
        {text:t('confirm'),onPress:() => router.navigate({pathname:'/(main)/room-join',params:{roomId:parsed.roomId,invite:parsed.inviteToken}})},
      ])
      return
    }
    if (parsed?.kind === 'login' || parsed?.kind === 'roomAccess') {
      setError(t('setup_authorization_code'))
      return
    }

    if (parsed?.kind === 'share') {
      router.navigate(`/machine-invites/${encodeURIComponent(parsed.token)}`)
      return
    }
    if (
      mode === 'share' ||
      parsed?.kind !== 'pair' ||
      !/^(?:sn-[a-z]{4}-[a-z]{4}-[a-z]{4}|auth-[A-Za-z0-9_-]+)$/.test(parsed.token)
    ) {
      setError(t(mode === 'share' ? 'setup_invite_invalid' : 'machine_code_failed'))
      return
    }
    claiming.current = true
    setBusy(true)
    setError('')
    try {
      const result = await machineAccountClient.claimPair(parsed.token)
      if (!active.current) return
      // Older login approvals may not return an ID. Show a list for explicit selection.
      claimed.current = { machineId: result?.machineId }
      await refresh()
    } catch (cause) {
      if (active.current)
        setError(
          t(isMachineAccountUnauthorized(cause) ? 'pair_auth_expired' : 'machine_code_failed'),
        )
    } finally {
      claiming.current = false
      if (active.current) setBusy(false)
    }
  }
  const title =
    mode === 'desktop'
      ? 'setup_desktop_title'
      : mode === 'server'
        ? 'setup_server'
        : mode === 'pair'
          ? 'setup_pair'
          : 'setup_invite'
  const visibleMachines = claimed.current?.machineId
    ? machines?.filter((machine) => machine.id === claimed.current?.machineId)
    : machines
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <AppPageHeader title={t(title)} onBack={goBack} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}
      >
        {mode === 'desktop' ? (
          <>
            <SetupText>{t('setup_desktop_instructions')}</SetupText>
            <SetupCopy value={`${website}/#downloads`} label={t('setup_copy_computer_address')} />
            <View style={{ gap: 12 }}>
              {(['macos', 'windows'] as const).map((platform) => {
                const info = downloads?.[platform]
                return (
                  <SetupText key={platform}>
                    {`${platform === 'macos' ? 'macOS' : 'Windows'} · ${info ? [info.version, info.arch, info.minimumSystem, info.status === 'preview' ? t('setup_preview') : '', `${Math.round(info.size / 1024 / 1024)} MB`].filter(Boolean).join(' · ') : t(downloads ? 'setup_download_not_published' : downloadError ? 'setup_download_failed' : 'loading')}`}
                    {info?.notes ? `\n${info.notes}` : ''}
                  </SetupText>
                )
              })}
              {downloadError ? (
                <SetupRow title={t('retry')} icon="refresh" onPress={loadDownloads} />
              ) : null}
            </View>
            <SetupText>{t('setup_desktop_sign_in')}</SetupText>
            <SetupText>{t('setup_desktop_trouble')}</SetupText>
          </>
        ) : null}
        {mode === 'server' ? (
          <>
            <SetupText>{t('setup_server_intro')}</SetupText>
            <SetupText title>{t('setup_manual_install')}</SetupText>
            <SetupText>{t('setup_terminal_hint')}</SetupText>
            <SetupCopy value={SHENNIAN_CLI_INSTALL_COMMAND} label={t('copy')} />
            <SetupRow
              title={t('setup_environment_guide')}
              icon="open-outline"
              onPress={() => openLink(`${website}/install.md`)}
            />
            <SetupText title>{t('setup_ai_install')}</SetupText>
            <SetupCopy
              value={t('setup_ai_prompt', { url: `${website}/install.md` })}
              label={t('copy_agent_install_prompt')}
            />
            <SetupText title>{t('setup_sign_in_choices')}</SetupText>
            <SetupText>{t('setup_browser_login')}</SetupText>
            <SetupText>{t('setup_code_login')}</SetupText>
            <SetupRow title={t('setup_have_code')} onPress={openPair} />
          </>
        ) : null}
        {mode === 'pair' || mode === 'share' ? (
          <>
            <SetupText>
              {t(mode === 'pair' ? 'setup_pair_instructions' : 'setup_invite_summary')}
            </SetupText>
            <SetupRow
              title={t(mode === 'pair' ? 'scan_machine_cta' : 'setup_scan_invite')}
              icon="scan-outline"
              onPress={() => router.navigate('/(main)/scan')}
            />
            <SetupText>{t('or')}</SetupText>
            <TextInput
              testID="first-machine-pair-code"
              value={input}
              onChangeText={setInput}
              editable={!busy && !claimed.current}
              accessibilityLabel={t(mode === 'pair' ? 'setup_pair_input' : 'setup_invite_input')}
              placeholder={t(mode === 'pair' ? 'setup_pair_input' : 'setup_invite_input')}
              placeholderTextColor={secondaryText}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={{
                minHeight: 56,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 14,
                color: colors.text,
                ...mobileTypography.body,
              }}
            />
            <SetupRow
              title={t(
                claimed.current
                  ? 'setup_check_connection'
                  : mode === 'share'
                    ? 'setup_preview_invite'
                    : 'confirm_add_machine',
              )}
              icon={claimed.current ? 'refresh' : 'chevron-forward'}
              disabled={busy || (!claimed.current && !input.trim())}
              onPress={() => void (claimed.current ? refresh() : submit())}
            />
            {claimComplete ? <SetupText>{t('setup_claim_success')}</SetupText> : null}
          </>
        ) : null}
        {busy ? <ActivityIndicator accessibilityLabel={t('loading')} color={colors.brand} /> : null}
        {error ? (
          <Text
            accessibilityRole="alert"
            style={{ ...mobileTypography.secondary, color: colors.errorText }}
          >
            {error}
          </Text>
        ) : null}
        {mode !== 'share' ? (
          <>
            {mode !== 'pair' ? (
              <SetupRow
                title={t('setup_check_connection')}
                icon="refresh"
                disabled={busy}
                onPress={() => void refresh()}
              />
            ) : null}
            <SetupText>{t('setup_confirm_machine')}</SetupText>
            {visibleMachines?.map((machine) => (
              <SetupRow
                key={machine.id}
                title={machine.name}
                detail={`${machine.os} · ${t(machine.online ? 'online' : 'offline')} · ${t('setup_view_ai')}`}
                onPress={() =>
                  router.navigate({
                    pathname: '/(main)/machine-agents',
                    params: { machineId: machine.id },
                  })
                }
              />
            ))}
            {machines?.length === 0 ? <SetupText>{t('setup_no_machine')}</SetupText> : null}
            {from === 'create-project' ? (
              <SetupRow
                title={t('setup_return_project')}
                onPress={() => router.dismissTo('/(main)/create-project')}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
