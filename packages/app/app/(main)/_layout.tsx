import { mountDiarySync } from '../../src/features/personal-workspace/diaryRuntime'
import { mountPersonalModules } from '../../src/features/personal-modules/runtime'
import { RecoverableSection } from '../../src/components/RecoverableSection'
import { mobileRootScreenOptions } from '../../src/components/mobileFeatureRegistry'
import { renderMobileRootScreen } from '../../src/components/MobileRootScreenFrame'
import { useEffect, useState } from 'react'
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../src/__tests__/main-layout-hooks.test.ts
import { Redirect, usePathname, useRouter } from 'expo-router'
import { Stack } from '../../src/components/MainStack'
import { View, Platform, Alert } from 'react-native'
import { useAuthStore } from '../../src/config/auth'
import { useSync } from '../../src/config/sync'
import { sessionAccountClient } from '../../src/features/sessions/sessionAccountClient'
import { ensureDetected } from '../../src/config/server'
import {
  getChatGestureOptions,
  getRoomWorkspaceBackGestureOptions,
} from '../../src/features/chat/utils/navigation'
import { useSessionsStore, useSheetsStore } from '@shennian/shared'
import {
  MachinePickerSheet,
  AddMachineSheet,
  AttachSheet,
  ProjectLaunchSheet,
} from '../../src/components/sheets'
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../src/hooks/useTheme'
import { getNativeStatusBarOptions } from '../../src/theme/nativeStatusBar'
import { useKeyboardShortcut } from '../../src/hooks/useKeyboardShortcut'
import { KeyboardShortcutsSheet } from '../../src/components/KeyboardShortcutsSheet'
import { QuickSwitcherSheet } from '../../src/components/QuickSwitcherSheet'
import { handleContextNewSessionShortcut } from '../../src/features/sessions/contextNewSession'
import { VoiceChiefCallProvider } from '../../src/features/voice-chief/VoiceChiefCallContext'
import { VoiceChiefFloatingHost } from '../../src/features/voice-chief/VoiceChiefFloatingHost'
import { roomAuthRedirectPathname } from '../../src/features/rooms/roomWebDeepLink'
import { accountRuntime } from '../../src/features/account-runtime/accountRuntime'

export default function MainLayout() {
  return <ActiveMainLayout />
}

function ActiveMainLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const personalAccountId = useAuthStore(s => s.user?.id ?? null)
  useEffect(() => {
    if (!personalAccountId || !isAuthenticated) return
    const stopModules = mountPersonalModules(), stopDiary = mountDiarySync()
    return () => { stopDiary(); stopModules() }
  }, [personalAccountId, isAuthenticated])
  useSync()
  const { colors, isDark } = useTheme()
  const { t } = useTranslation()
  const networkStatus = useNetworkStatus()

  useEffect(() => {
    if (isAuthenticated) ensureDetected().catch(() => {})
  }, [isAuthenticated])

  const pathname = usePathname()
  const router = useRouter()
  const upsertSession = useSessionsStore((s) => s.upsertSession)
  const openMachinePicker = useSheetsStore((s) => s.openMachinePicker)
  const hasOpenSheet = useSheetsStore(
    (s) =>
      s.machinePickerOpen ||
      s.addMachineOpen ||
      s.attachOpen ||
      s.projectLaunchOpen ||
      s.fileDrawerOpen ||
      s.fileRefPickerOpen,
  )
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  useKeyboardShortcut(
    { key: 'k', metaOrCtrl: true },
    true,
    () => setQuickSwitcherOpen(true),
  )
  useKeyboardShortcut(
    { key: '/', metaOrCtrl: true },
    true,
    () => setShortcutsOpen(true),
  )
  useKeyboardShortcut({ key: 'n', metaOrCtrl: true, allowEditable: true }, true, () => {
    void handleContextNewSessionShortcut({
      pathname,
      sessions: useSessionsStore.getState().sessions,
      hasOpenModal: hasOpenSheet || shortcutsOpen || quickSwitcherOpen,
      desktopControlSurface: false,
      createSession: sessionAccountClient.createSession,
      openFullFlow: openMachinePicker,
      persistSession: (session) =>
        accountRuntime.persistSession(session).catch(() => {}),
      upsertSession,
      navigateToSession: (sessionId) => router.navigate(`/(main)/chat/${sessionId}`),
    }).catch((err) => {
      Alert.alert(t('error_unknown'), err instanceof Error ? err.message : String(err))
    })
  })

  useEffect(() => {
    if (!isAuthenticated || networkStatus !== 'online') return
    accountRuntime.reconnect('network-restored').catch(() => {})
  }, [isAuthenticated, networkStatus])

  if (!isAuthenticated) {
    const browserPathname =
      Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.pathname : undefined
    const redirect = roomAuthRedirectPathname(pathname, browserPathname)
    return <Redirect href={{ pathname: '/(auth)/login', params: { redirect } }} />
  }

  return (
    <VoiceChiefCallProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack
          screenLayout={renderMobileRootScreen}
          screenOptions={{
            ...getNativeStatusBarOptions(isDark),
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ animation: 'none', gestureEnabled: false }} />
          <Stack.Screen name="index" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="content" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="personal-workspace" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="personal-modules" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="primary-computer" />
          <Stack.Screen name="steward" />
          <Stack.Screen name="folders" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="features" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="bottom-navigation" />
          <Stack.Screen name="spaces/index" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="agents/index" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="contacts" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="contacts/[contactId]" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="contacts/new-conversation" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="plaza" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="plaza/[publicId]" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="published-conversations/new" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="agents/new" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen
            name="agents/[agentId]/index"
            options={getChatGestureOptions(Platform.OS)}
          />
          <Stack.Screen name="agents/[agentId]/publication" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="published-conversations/index" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="published-conversations/[conversationId]" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="profile" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="personal-profile" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="account-settings" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="login-devices" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen
            name="voice-chief"
            options={{ animation: 'fade_from_bottom', gestureEnabled: false }}
          />
          <Stack.Screen name="machine-folder" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="remote-folder" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="project" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="create-project" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="project-coordination" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen
            name="room-workspace"
            options={getRoomWorkspaceBackGestureOptions(Platform.OS, null)}
          />
          <Stack.Screen name="spaces/details" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="spaces/agent-settings" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="spaces/agent-settings-mode" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="spaces/manage" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="spaces/invite" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen
            name="spaces/open-on-computer"
            options={getChatGestureOptions(Platform.OS)}
          />
          <Stack.Screen name="spaces/members" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="spaces/member-add" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="spaces/browser-sessions" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="spaces/agents" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="spaces/agent-add" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="machine/[machineId]" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="machines" options={({ route }) => mobileRootScreenOptions(route.name, route.params)} />
          <Stack.Screen name="machine-agents" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen name="wechat-rpa" options={getChatGestureOptions(Platform.OS)} />
          <Stack.Screen
            name="chat/[sessionId]/index"
            options={getChatGestureOptions(Platform.OS)}
          />
          <Stack.Screen
            name="chat/[sessionId]/preview"
            options={getChatGestureOptions(Platform.OS)}
          />
          <Stack.Screen
            name="chat/[sessionId]/external-channel/index"
            options={getChatGestureOptions(Platform.OS)}
          />
          <Stack.Screen
            name="chat/[sessionId]/external-channel/conversation"
            options={getChatGestureOptions(Platform.OS)}
          />
          <Stack.Screen
            name="chat/[sessionId]/external-channel/prompt"
            options={getChatGestureOptions(Platform.OS)}
          />
          <Stack.Screen
            name="chat/[sessionId]/external-channel/wechat-rpa"
            options={getChatGestureOptions(Platform.OS)}
          />
        </Stack>
        <RecoverableSection scope="overlays" resetKey={String(hasOpenSheet)} onLeave={() => useSheetsStore.getState().closeMachinePicker()}><MachinePickerSheet /></RecoverableSection>
        <RecoverableSection scope="overlays" resetKey={String(hasOpenSheet)} onLeave={() => useSheetsStore.getState().closeAddMachine()}><AddMachineSheet /></RecoverableSection>
        <RecoverableSection scope="overlays" resetKey={String(hasOpenSheet)} onLeave={() => useSheetsStore.getState().closeAttach()}><AttachSheet /></RecoverableSection>
        <RecoverableSection scope="overlays" resetKey={String(hasOpenSheet)} onLeave={() => useSheetsStore.getState().closeProjectLaunch()}><ProjectLaunchSheet /></RecoverableSection>
        <RecoverableSection scope="overlays" resetKey={String(quickSwitcherOpen)} onLeave={() => setQuickSwitcherOpen(false)}>{quickSwitcherOpen ? <QuickSwitcherSheet
          visible={quickSwitcherOpen}
          onClose={() => setQuickSwitcherOpen(false)}
        /> : null}</RecoverableSection>
        <RecoverableSection scope="overlays" resetKey={String(shortcutsOpen)} onLeave={() => setShortcutsOpen(false)}><KeyboardShortcutsSheet visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} /></RecoverableSection>
        <RecoverableSection scope="overlays"><VoiceChiefFloatingHost /></RecoverableSection>
      </View>
    </VoiceChiefCallProvider>
  )
}
