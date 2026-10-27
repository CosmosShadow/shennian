// @arch docs/features/desktop-login-and-first-use.md
// @test ../../__tests__/desktop-login-and-first-use.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'

type Props = { colors: Colors; onAddMachine: () => void; onBrowseRooms: () => void }

export function DesktopFirstUseEmptyState({ colors, onAddMachine, onBrowseRooms }: Props) {
  const { t } = useTranslation()
  return (
    <View testID="desktop-first-use-empty" style={styles.root}>
      <View style={[styles.icon, { backgroundColor: colors.brandLight }]}>
        <Ionicons name="desktop-outline" size={32} color={colors.brand} />
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {t('desktop_first_use_title')}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {t('desktop_first_use_body')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('add_machine')}
        onPress={onAddMachine}
        style={({ pressed }) => [styles.primary, {
          backgroundColor: pressed ? colors.brandDark : colors.brand,
          borderColor: colors.brand,
        }]}
      >
        <Text style={styles.primaryText}>{t('add_machine')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('desktop_first_use_browse_rooms')}
        onPress={onBrowseRooms}
        style={({ pressed }) => [styles.secondary, {
          backgroundColor: pressed ? colors.surfaceHover : 'transparent',
          borderColor: 'transparent',
        }]}
      >
        <Text style={[styles.secondaryText, { color: colors.brand }]}>
          {t('desktop_first_use_browse_rooms')}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { minHeight: 360, paddingVertical: 56, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 20, fontSize: 22, lineHeight: 29, fontWeight: '700' },
  body: { maxWidth: 440, marginTop: 8, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  primary: { minHeight: 44, minWidth: 132, marginTop: 24, paddingHorizontal: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  secondary: { minHeight: 44, minWidth: 132, marginTop: 4, paddingHorizontal: 16, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
})
