// @arch docs/features/desktop-local-first-client.md#81-信息架构
// @test ../../__tests__/desktop-route-registry.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'

/** Desktop Room root: the sidebar owns the Room collection and this pane owns selection state. */
export default function DesktopSpacesScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()

  return (
    <View
      testID="desktop-spaces-root"
      style={[styles.root, { backgroundColor: colors.bg }]}
    >
      <Ionicons name="people-outline" size={42} color={colors.textTertiary} />
      <Text style={[styles.title, { color: colors.text }]}>
        {t('spaces_select_title')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
})
