// @arch docs/architecture/mobile-navigation.md
import { Tabs } from 'expo-router'
import { useAuthStore } from '../../../src/config/auth'
import { useTheme } from '../../../src/hooks/useTheme'
import { MobileRootTabBar } from '../../../src/components/MobileRootTabBar'
import { MobileTabEntryContext } from '../../../src/components/useMobileModuleBack'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

export default function MobileTabsLayout() {
  const accountId = useAuthStore(state => state.user?.id)
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return <MobileTabEntryContext.Provider value>
    <Tabs key={accountId} initialRouteName="home" backBehavior="none" detachInactiveScreens={false}
      tabBar={props => <MobileRootTabBar {...props} />}
      screenLayout={({ children }) => <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>{children}</SafeAreaInsetsContext.Provider>}
      screenOptions={{ headerShown: false, lazy: true, animation: 'none', sceneStyle: { backgroundColor: colors.bg }, tabBarHideOnKeyboard: true }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="people" />
      <Tabs.Screen name="projects" />
      <Tabs.Screen name="settings" />
    </Tabs>
  </MobileTabEntryContext.Provider>
}
