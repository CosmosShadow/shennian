// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/mobile-root-tab-bar.test.ts
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useEffect } from 'react'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { DirectoryBookIcon } from './DirectoryBookIcon'
import { useTheme } from '../hooks/useTheme'
import { useMobileUpgradeBadges } from '../features/mobile-navigation/useMobileUpgradeBadges'
import { useUnreadNavigation } from '../features/unread/useUnreadNavigation'
import { UnreadCountBadge } from '../features/unread/UnreadCountBadge'
import { RoomApprovalDot } from '../features/rooms/components/RoomApprovalDot'
import { mobileRootTabAction, type MobileRootTab } from './mobileRootTabNavigation'
import { DEFAULT_MOBILE_TABS, MOBILE_TAB_ROUTES, mobileDestinations } from './mobileFeatureRegistry'
import { rememberMobileRootTab } from './mobileRootTabPreference'
import { useAuthStore } from '../config/auth'
export type { MobileRootTab } from './mobileRootTabNavigation'

export function MobileRootTabBar({ state, navigation }: BottomTabBarProps) {
  const accountId = useAuthStore(state => state.user?.id ?? null)
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const selectedColor = colors.navigationSelected
  const settingsBadges = useMobileUpgradeBadges()
  const unread = useUnreadNavigation()
  const activeRoute = state.routes[state.index]?.name
  useEffect(() => {
    const active = (Object.keys(MOBILE_TAB_ROUTES) as MobileRootTab[])
      .find(key => MOBILE_TAB_ROUTES[key] === activeRoute)
    if (active) rememberMobileRootTab(accountId, active)
  }, [accountId, activeRoute])
  return <View testID="mobile-root-tab-bar" style={[styles.bar, {
    paddingBottom: Math.max(insets.bottom, 6), backgroundColor: colors.surface, borderTopColor: colors.separator,
  }]}>
    {DEFAULT_MOBILE_TABS.map(key => {
      const tabKey = key as MobileRootTab
      const tab = mobileDestinations.find(item => item.key === key)!
      const selected = activeRoute === MOBILE_TAB_ROUTES[tabKey]
      const color = selected ? selectedColor : colors.textSecondary
      const count = key === 'shennian' ? unread.tabs.rooms + unread.tabs.agents
        : key === 'projects' ? unread.tabs.projects : 0
      return <Pressable key={key} testID={`mobile-root-tab-${key}`} accessibilityRole="tab"
        accessibilityState={{ selected }} accessibilityLabel={t(tab.label)} style={styles.tab}
        onPress={() => {
          if ((useAuthStore.getState().user?.id ?? null) !== accountId) return
          const route = state.routes.find(item => item.name === MOBILE_TAB_ROUTES[tabKey])
          if (!route) return
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (event.defaultPrevented) return
          const action = mobileRootTabAction(navigation.getState(), tabKey)
          if (action) navigation.dispatch(action)
        }}>
        <View style={styles.iconWrap}>
          {key === 'contacts' ? <DirectoryBookIcon color={color} selected={selected} size={23} /> : <Ionicons name={selected ? tab.selectedIcon : tab.icon} size={23} color={color} />}
          {key === 'shennian' ? <View style={styles.approvalBadgePosition}><RoomApprovalDot /></View> : null}
          {key === 'settings' && settingsBadges.any ? <View style={[styles.badge, { backgroundColor: colors.error }]} /> : null}
          <View style={styles.unreadBadgePosition}><UnreadCountBadge count={count} testID={`mobile-root-tab-${key}-unread`} /></View>
        </View>
        <Text style={[styles.label, { color }]}>{t(tab.label)}</Text>
      </Pressable>
    })}
  </View>
}
const styles = StyleSheet.create({
  bar: { flexDirection: 'row', minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  tab: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', gap: 1 },
  iconWrap: { position: 'relative' },
  label: { fontSize: 11.5, lineHeight: 15 },
  approvalBadgePosition: { position: 'absolute', left: -5, top: 0 },
  badge: { position: 'absolute', right: -5, top: -2, width: 7, height: 7, borderRadius: 4 },
  unreadBadgePosition: { position: 'absolute', right: -13, top: -7 },
})
