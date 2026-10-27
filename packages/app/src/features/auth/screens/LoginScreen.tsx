import { ActionIconButton } from '../../../components/ActionIconButton'
// @arch docs/architecture/app/modular-features.md#登录-feature
// @test src/__tests__/auth-providers.test.ts

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TencentCaptchaModal } from '../../../components/auth/TencentCaptchaModal'
import { AccessibleButton } from '../../../components/AccessibleButton'
import { useTheme } from '../../../hooks/useTheme'
import {
  retryDesktopAccountRecovery,
  startDesktopFreshLogin,
  useAuthStore,
} from '../../../config/auth'
import { useAuthPublicConfig } from '../hooks/useAuthPublicConfig'
import { usePhoneLogin } from '../hooks/usePhoneLogin'
import { useQrLogin } from '../hooks/useQrLogin'
import { persistLang } from '../utils/lang'
import type { PublicAuthConfig, TabKey } from '../types'
import { PhoneLoginPanel } from '../components/PhoneLoginPanel'
import { QrLoginPanel } from '../components/QrLoginPanel'
import { getDesktopControlBridge } from '../../desktop-control/bridge'
import { sanitizeAuthRedirect } from '../utils/redirect'
import { canShowQrLogin } from '../utils/qrLoginAvailability'
import { getPublicSiteUrl, getServerSelectionKey, subscribeServerSelection, isSelfHostedSelection } from '../../../config/server'
import { SelfHostedLoginPanel, ServerSelector, type LoginServerMode } from '../components/SelfHostedLoginPanel'
import {
  getDesktopAuthRecoveryIssue,
  getDesktopAuthRecoveryServerSnapshot,
  subscribeDesktopAuthRecoveryIssue,
} from '../desktopAuthRecovery'
import { DesktopLoginFrame } from '../../desktop-onboarding/DesktopLoginFrame'
import { DesktopRecoveryNotice } from '../../desktop-onboarding/DesktopRecoveryNotice'
import {
  desktopRecoveryAction,
  getLoginFormTitleKey,
} from '../../desktop-onboarding/desktopEntryState'

const isWeb = Platform.OS === 'web'
const logoSource = require('../../../../public/logo-192.png')

export default function LoginScreen({
  defaultRedirect,
}: {
  defaultRedirect?: string
} = {}) {
  const serverKey = useSyncExternalStore(subscribeServerSelection, getServerSelectionKey, getServerSelectionKey)
  return <SelectedServerLogin key={serverKey} defaultRedirect={defaultRedirect} />
}
function SelectedServerLogin({ defaultRedirect }: { defaultRedirect?: string }) {
  const config = useAuthPublicConfig()
  return <LoginScreenBody config={config} defaultRedirect={defaultRedirect} />
}

function LoginScreenBody({
  config,
  defaultRedirect,
}: {
  config: PublicAuthConfig
  defaultRedirect?: string
}) {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const { colors } = useTheme()
  const { width, height } = useWindowDimensions()
  const params = useLocalSearchParams<{ mode?: string; desktop?: string; redirect?: string }>()
  const [tab, setTab] = useState<TabKey>('phone')
  const [serverMode, setServerMode] = useState<LoginServerMode>(isSelfHostedSelection() ? 'self-hosted' : 'cloud')
  const [selfHostReady, setSelfHostReady] = useState(isSelfHostedSelection())
  const [localLoginBusy, setLocalLoginBusy] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)
  const [recoveryPending, setRecoveryPending] = useState(false)
  const recoveryIssue = useSyncExternalStore(
    subscribeDesktopAuthRecoveryIssue,
    getDesktopAuthRecoveryIssue,
    getDesktopAuthRecoveryServerSnapshot,
  )
  const hasDesktopBridge = hasMounted && Boolean(getDesktopControlBridge())
  const isDesktopShell = isWeb && (params.desktop === '1' || hasDesktopBridge)
  const isWideWeb = hasMounted && width >= 768
  const showQrLogin = canShowQrLogin(Platform.OS, hasMounted ? width : 0, isDesktopShell)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const redirectTo = sanitizeAuthRedirect(
    params.redirect,
    defaultRedirect ?? (isWeb ? undefined : '/'),
  )

  const formTitleKey = getLoginFormTitleKey(isDesktopShell, params.mode)

  const phoneLogin = usePhoneLogin({
    captchaAppId: config.tencentCaptchaAppId ?? '',
    redirectTo,
  })
  const qrLogin = useQrLogin(showQrLogin && tab === 'qr', redirectTo)

  const toggleLang = useCallback(async () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh'
    await i18n.changeLanguage(next)
    await persistLang(next)
  }, [i18n])

  const openPublicHome = useCallback(() => {
    if (isWeb && typeof window !== 'undefined') {
      window.location.assign(getPublicSiteUrl())
      return
    }
    void Linking.openURL(getPublicSiteUrl())
  }, [])

  const openPrivacy = useCallback(() => {
    const publicSiteUrl = getPublicSiteUrl().replace(/\/+$/, '')
    void Linking.openURL(`${publicSiteUrl}/privacy`)
  }, [])

  const error = !showQrLogin || tab === 'phone' ? phoneLogin.error : qrLogin.error
  const handleRecoveryAction = useCallback(async () => {
    if (!recoveryIssue || recoveryPending) return
    if (desktopRecoveryAction(recoveryIssue) === 'fresh-login') {
      startDesktopFreshLogin()
      return
    }
    setRecoveryPending(true)
    try {
      await retryDesktopAccountRecovery()
    } finally {
      setRecoveryPending(false)
    }
  }, [recoveryIssue, recoveryPending])
  const selectLoginTab = useCallback(
    (nextTab: TabKey) => {
      setTab(nextTab)
      phoneLogin.clearError()
      qrLogin.setError('')
    },
    [phoneLogin, qrLogin],
  )
  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    if (!showQrLogin && tab === 'qr') {
      setTab('phone')
    }
  }, [showQrLogin, tab])

  useEffect(() => {
    if (isDesktopShell && isAuthenticated) {
      router.replace(redirectTo as never)
    }
  }, [isAuthenticated, isDesktopShell, redirectTo, router])

  const phonePanel = !isWeb && serverMode === 'self-hosted' ? (
    selfHostReady && isSelfHostedSelection() ? <SelfHostedLoginPanel colors={colors} redirectTo={redirectTo} onBusyChange={setLocalLoginBusy} /> : null
  ) : (
    <PhoneLoginPanel
      presentation={isDesktopShell ? 'desktop' : 'default'}
      phone={phoneLogin.phone}
      setPhone={phoneLogin.setPhone}
      code={phoneLogin.code}
      setCode={phoneLogin.setCode}
      countdown={phoneLogin.countdown}
      sendingCode={phoneLogin.sendingCode}
      loading={phoneLogin.loading}
      onSendCode={phoneLogin.handleSendCode}
      onLogin={phoneLogin.handleLogin}
      colors={colors}
    />
  )

  const formContent = (
    <>
      <TencentCaptchaModal
        visible={phoneLogin.captchaVisible}
        appId={config.tencentCaptchaAppId ?? ''}
        onClose={() => phoneLogin.setCaptchaVisible(false)}
        onVerified={phoneLogin.handleCaptchaVerified}
      />

      <View
        style={[
          isDesktopShell ? desktopStyles.formContent : isWeb ? styles.card : styles.nativeForm,
          {
            backgroundColor: isWeb && !isDesktopShell ? colors.surface : 'transparent',
            shadowColor: colors.text,
          },
          isWeb && !isDesktopShell && webStyles.card,
        ]}
      >
        {!isWeb && <ServerSelector colors={colors} mode={serverMode} onModeChange={setServerMode} onReadyChange={setSelfHostReady} disabled={localLoginBusy || phoneLogin.loading || phoneLogin.sendingCode} />}
        {isDesktopShell && recoveryIssue ? (
          <DesktopRecoveryNotice
            issue={recoveryIssue}
            pending={recoveryPending}
            colors={colors}
            onAction={handleRecoveryAction}
          />
        ) : null}
        {showQrLogin ? (
          <>
            <View
              accessibilityRole="tablist"
              style={[
                styles.tabBar,
                isDesktopShell && desktopStyles.tabBar,
                { backgroundColor: colors.surfaceHover },
              ]}
            >
              {(['phone', 'qr'] as const).map((key) => (
                <Pressable
                  key={key}
                  nativeID={`login-tab-${key}`}
                  testID={`login-tab-${key}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === key }}
                  style={[
                    styles.tab,
                    isDesktopShell && desktopStyles.tab,
                    tab === key && styles.tabActive,
                    tab === key && { backgroundColor: colors.surface },
                  ]}
                  onPress={() => selectLoginTab(key)}
                >
                  <Text
                    style={[
                      styles.tabText,
                      isDesktopShell && desktopStyles.tabText,
                      tab === key ? styles.tabTextActive : { color: colors.textTertiary },
                      tab === key && { color: colors.text },
                    ]}
                  >
                    {key === 'phone' ? t('phone_login') : t('qr_login')}
                  </Text>
                </Pressable>
              ))}
            </View>

            {tab === 'phone' ? (
              phonePanel
            ) : (
              <QrLoginPanel
                qrUrl={qrLogin.qrUrl}
                qrStatus={qrLogin.qrStatus}
                error={qrLogin.error}
                onRefresh={qrLogin.createQr}
                colors={colors}
                compact={isDesktopShell && (height < 700 || width < 620)}
              />
            )}
          </>
        ) : (
          phonePanel
        )}

        {!!error && tab === 'phone' && (
          <Text
            testID="login-error"
            style={[styles.error, !isWeb && styles.nativeError, { color: colors.error }]}
          >
            {error}
          </Text>
        )}
      </View>
    </>
  )

  if (isDesktopShell) {
    return (
      <DesktopLoginFrame
        colors={colors}
        height={height}
        redirectTo={redirectTo}
        title={t(formTitleKey)}
        onToggleLanguage={toggleLang}
        onOpenPrivacy={openPrivacy}
      >
        {formContent}
      </DesktopLoginFrame>
    )
  }

  if (isWeb) {
    return (
      <View style={[webStyles.root, { backgroundColor: colors.bg }]}>
        <View pointerEvents="none" style={webStyles.ambientTop} />
        <View pointerEvents="none" style={webStyles.ambientBottom} />

        <View style={webStyles.topBar}>
          <ActionIconButton icon="back" label={t('back_to_home')} style={webStyles.topBarBtn} onPress={openPublicHome}>
            <Text style={[webStyles.topBarBtnText, { color: colors.textTertiary }]}>
              {t('back_to_home')}
            </Text>
          </ActionIconButton>
          <AccessibleButton
            accessibilityLabel={i18n.language === 'zh' ? '切换为英文' : 'Switch to Chinese'}
            style={[webStyles.langBtn, { borderColor: colors.border }]}
            onPress={() => void toggleLang()}
          >
            <Text style={[webStyles.langBtnText, { color: colors.text }]}>
              {i18n.language === 'zh' ? '中文 / EN' : 'EN / 中文'}
            </Text>
          </AccessibleButton>
        </View>

        <ScrollView
          style={webStyles.pageScroll}
          contentContainerStyle={webStyles.pageContent}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              webStyles.authShell,
              { backgroundColor: colors.surface, shadowColor: colors.text },
              !isWideWeb && webStyles.authShellMobile,
            ]}
          >
            {isWideWeb ? (
              <Pressable style={webStyles.brandPanel} onPress={openPublicHome}>
                <View pointerEvents="none" style={webStyles.brandGlow} />
                <View pointerEvents="none" style={webStyles.brandRing} />
                <View style={webStyles.brandInner}>
                  <Image source={logoSource} style={webStyles.brandMark} />
                  <Text style={webStyles.brandLogo}>{t('app_name')}</Text>
                  <Text style={webStyles.brandSubtitle}>{t('landing_simple_intro')}</Text>
                </View>
              </Pressable>
            ) : null}

            <View style={[webStyles.formPanel, !isWideWeb && webStyles.formPanelMobile]}>
              <View style={webStyles.formInner}>
                {!isWideWeb ? (
                  <Pressable style={webStyles.mobileBrand} onPress={openPublicHome}>
                    <Image source={logoSource} style={webStyles.mobileBrandMark} />
                    <Text style={[webStyles.mobileBrandName, { color: colors.text }]}>
                      {t('app_name')}
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={[webStyles.formTitle, { color: colors.text }]}>{t(formTitleKey)}</Text>
                {formContent}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    )
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.nativePageContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.nativeMain}>
            <View style={styles.nativeBrandRow}>
              <View style={[styles.nativeLogoFrame, { borderColor: colors.border }]}>
                <Image source={logoSource} style={styles.nativeLogo} />
              </View>
              <Text style={[styles.nativeBrandName, { color: colors.text }]}>{t('app_name')}</Text>
            </View>

            <Text testID="native-login-title" style={[styles.title, { color: colors.text }]}>
              {t('login_form_title_default')}
            </Text>

            <View style={styles.nativeFormWrap}>{formContent}</View>
          </View>

          <Text style={[styles.nativeLegal, { color: colors.textSecondary }]}>
            {t('login_legal_prefix')}
            <Text accessibilityRole="link" style={{ color: colors.brand }} onPress={openPrivacy}>
              {t('privacy_title')}
            </Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const webStyles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  ambientTop: {
    position: 'absolute',
    width: 620,
    height: 620,
    borderRadius: 310,
    top: -330,
    right: -170,
    backgroundColor: 'rgba(164, 211, 255, 0.23)',
  },
  ambientBottom: {
    position: 'absolute',
    width: 560,
    height: 560,
    borderRadius: 280,
    bottom: -350,
    left: -170,
    backgroundColor: 'rgba(185, 190, 255, 0.18)',
  },
  topBar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    zIndex: 2,
  },
  topBarBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  topBarBtnText: {
    fontSize: 14,
  },
  langBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  langBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  pageScroll: {
    flex: 1,
  },
  pageContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 64,
  },
  authShell: {
    width: '100%',
    maxWidth: 980,
    minHeight: 560,
    flexDirection: 'row',
    borderRadius: 30,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.12,
    shadowRadius: 50,
    elevation: 8,
  },
  authShellMobile: {
    maxWidth: 440,
    minHeight: 0,
    borderRadius: 24,
  },
  brandPanel: {
    width: '40%',
    minWidth: 320,
    backgroundColor: '#edf4ff',
    justifyContent: 'center',
    overflow: 'hidden',
    cursor: 'pointer',
  },
  brandGlow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    top: -150,
    right: -210,
    backgroundColor: 'rgba(104, 174, 255, 0.22)',
  },
  brandRing: {
    position: 'absolute',
    width: 420,
    height: 190,
    borderRadius: 210,
    left: -160,
    bottom: -50,
    borderWidth: 1,
    borderColor: 'rgba(81, 113, 194, 0.16)',
    transform: [{ rotate: '-12deg' }],
  },
  brandInner: {
    paddingHorizontal: 46,
  },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    backgroundColor: '#3f5fc4',
    shadowColor: '#3f5fc4',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
  },
  brandLogo: {
    fontSize: 46,
    lineHeight: 56,
    fontWeight: '900',
    color: '#17233f',
    letterSpacing: 4,
  },
  brandSubtitle: {
    maxWidth: 250,
    marginTop: 14,
    color: '#5c6f91',
    fontSize: 15,
    lineHeight: 25,
    fontWeight: '500',
  },
  formPanel: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 54,
    paddingHorizontal: 58,
  },
  formPanelMobile: {
    paddingVertical: 34,
    paddingHorizontal: 20,
  },
  formInner: {
    width: '100%',
    maxWidth: 420,
  },
  mobileBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 30,
    alignSelf: 'flex-start',
  },
  mobileBrandMark: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3f5fc4',
  },
  mobileBrandName: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
  },
  formTitle: {
    fontSize: 30,
    lineHeight: 39,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 28,
  },
  card: {
    shadowOpacity: 0,
    padding: 0,
  },
})

const desktopStyles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  topBar: {
    height: 64,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  langBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 72,
  },
  contentCompact: {
    justifyContent: 'flex-start',
    paddingTop: 16,
    paddingBottom: 32,
  },
  shell: {
    width: '100%',
    maxWidth: 420,
  },
  loginPanel: {
    width: '100%',
  },
  logoFrame: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignSelf: 'center',
    overflow: 'hidden',
    marginBottom: 20,
  },
  logo: {
    width: 64,
    height: 64,
  },
  loginTitle: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    textAlign: 'center',
  },
  formContent: {
    width: '100%',
    marginTop: 32,
  },
  tabBar: {
    height: 48,
    marginBottom: 24,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    minHeight: 40,
    borderRadius: 8,
  },
  tabText: {
    fontSize: 15,
    lineHeight: 22,
  },
  recoveryNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  recoveryCopy: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  recoveryTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  recoveryBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  recoveryAction: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  recoveryActionText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  legal: {
    marginTop: 24,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
})

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
  },
  nativePageContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 20,
  },
  nativeMain: {
    width: '100%',
  },
  nativeBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 28,
  },
  nativeLogoFrame: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  nativeLogo: {
    width: 52,
    height: 52,
  },
  nativeBrandName: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
  nativeFormWrap: {
    marginTop: 28,
  },
  nativeLegal: {
    marginTop: 'auto',
    paddingTop: 40,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    textAlign: 'left',
  },
  card: {
    borderRadius: 18,
    padding: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  nativeForm: {
    padding: 0,
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  tab: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabActive: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
  },
  tabTextActive: {
    fontWeight: '600',
  },
  error: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
  },
  nativeError: {
    textAlign: 'left',
  },
})
