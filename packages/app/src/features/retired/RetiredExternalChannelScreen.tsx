// @arch docs/features/network-rooms/mobile-control-and-single-room-web.md
// @test src/__tests__/retired-external-channel-ui.test.ts
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'

export function RetiredExternalChannelScreen() {
  const router = useRouter()
  const { colors } = useTheme()

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: colors.bg }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>外部连接能力已退役</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          微信、企业微信和飞书连接已从神念主产品移除。请使用神念原生对话与 Room；独立 Connector 未来只通过公开 Agent Protocol 接入。
        </Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: colors.brand }]}
          onPress={() => router.replace('/(main)')}
        >
          <Text style={styles.buttonText}>返回神念</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 560, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 28, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 25 },
  button: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
