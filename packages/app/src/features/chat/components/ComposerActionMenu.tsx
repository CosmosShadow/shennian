// @arch docs/architecture/app/chat-composer-keyboard.md
// @test src/__tests__/room-conversation-screen.test.ts

import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'

type MenuColors = {
  brand: string
  border: string
  surface: string
  text: string
  textSecondary: string
}

export type ComposerMenuItem = {
  toggle?: { value: boolean; onChange: (value: boolean) => void }
  id: string
  icon?: keyof typeof Feather.glyphMap
  label: string
  onPress: () => void
  disabled?: boolean
  active?: boolean
  testID?: string
}

export function ComposerActionMenu({
  colors,
  items,
  vertical = false,
}: {
  colors: MenuColors
  items: ComposerMenuItem[]
  vertical?: boolean
}) {
  const web = Platform.OS === 'web'
  return (
    <View style={[
      vertical ? styles.verticalMenu : web ? styles.webMenu : styles.menu,
      { backgroundColor: colors.surface, borderColor: colors.border },
    ]}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          style={[vertical ? styles.verticalAction : web ? styles.webAction : styles.action, web && { backgroundColor: `${colors.brand}08` }, item.disabled && { opacity: 0.45 }]}
          disabled={item.disabled}
          accessibilityState={{ disabled: item.disabled, ...(item.toggle ? { checked: item.toggle.value } : {}) }}
          onPress={item.toggle ? () => item.toggle?.onChange(!item.toggle.value) : item.onPress}
          testID={item.testID}
          accessibilityRole={item.toggle ? "switch" : "button"}
          accessibilityLabel={item.label}
        >
          {item.icon ? web ? (
            <View style={[styles.webIcon, { backgroundColor: item.active ? `${colors.brand}18` : `${colors.brand}14` }]}>
              <Feather name={item.icon} size={16} color={colors.brand} />
            </View>
          ) : (
            <Feather name={item.icon} size={22} color={vertical ? colors.text : colors.brand} />
          ) : null}
          <Text style={[vertical ? styles.verticalLabel : web ? styles.webLabel : styles.label, { color: web ? colors.text : colors.textSecondary }, vertical && { color: colors.text }]} numberOfLines={web ? 1 : undefined}>
            {item.label}
          </Text>
          {item.toggle ? <Switch accessibilityLabel={item.label} disabled={item.disabled} value={item.toggle.value} onValueChange={item.toggle.onChange} /> : null}
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  verticalMenu: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 7, alignSelf: 'flex-start', minWidth: 240, maxWidth: '100%', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 12, marginLeft: 16 },
  verticalAction: { flexDirection: 'row', minHeight: 52, alignItems: 'center', gap: 16, paddingHorizontal: 12 },
  verticalLabel: { flexShrink: 1, fontSize: 17, lineHeight: 24 },
  menu: {
    alignSelf: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    flexDirection: 'row',
  },
  action: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 72,
    paddingHorizontal: 2,
    paddingVertical: 8,
    gap: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    width: '100%',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    textAlign: 'center',
  },
  webMenu: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 8,
    flexDirection: 'row',
    gap: 8,
  },
  webAction: {
    flex: 1,
    minWidth: 68,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
    alignItems: 'center',
  },
  webIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webLabel: { fontSize: 12, fontWeight: '500' },
})
