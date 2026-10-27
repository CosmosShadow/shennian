// @arch docs/features/published-agent-direct-conversations.md

import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../../src/components/AppPageHeader'
import { useAuthStore } from '../../../src/config/auth'
import { listMyPublishedConversations, type MyPublishedConversation } from '../../../src/features/published-agents/directConversationClient'
import { useTheme } from '../../../src/hooks/useTheme'

const copy = {
  zh: { title: '我聊过的智能体', empty: '还没有对外智能体对话',
    retry: '重试', more: '查看更多', loading: '正在读取…',
    failed: '对话暂时无法加载，请重试。', paused: '已暂停',
    revoked: '链接已撤销 · 历史仍可查看', unavailable: '暂不可用 · 历史仍可查看',
    offline: '创建者客户端离线 · 消息会排队' },
  en: { title: 'Agents I chatted with', empty: 'No published Agent conversations yet',
    retry: 'Retry', more: 'Load more', loading: 'Loading…',
    failed: 'Could not load conversations. Please retry.', paused: 'Paused',
    revoked: 'Link revoked · history available', unavailable: 'Unavailable · history available',
    offline: 'Creator offline · messages will queue' },
} as const

export default function MyPublishedConversations() {
  const router = useRouter()
  const { i18n } = useTranslation()
  const t = i18n.language.startsWith('zh') ? copy.zh : copy.en
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id)
  const [rows, setRows] = useState<MyPublishedConversation[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const generation = useRef(0)

  const load = useCallback(async (next?: string) => {
    const request = ++generation.current
    setLoading(true)
    try {
      const result = await listMyPublishedConversations(next)
      if (request !== generation.current) return
      setRows((current) => next ? [...current, ...result.conversations] : result.conversations)
      setCursor(result.nextCursor)
      setError(false)
    } catch {
      if (request === generation.current) setError(true)
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => {
    generation.current += 1
    setRows([])
    setCursor(null)
    setError(false)
    if (accountId) void load()
    return () => { generation.current += 1 }
  }, [accountId, load]))

  const status = (row: MyPublishedConversation) => row.publicationStatus === 'paused'
    ? t.paused : row.publicationStatus === 'revoked' ? t.revoked
      : row.publicationStatus === 'active'
        ? row.machineOnline === false ? t.offline : '' : t.unavailable

  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={t.title} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {rows.map((row) => <Pressable key={row.id} accessibilityRole="button"
        testID={`published-conversation-${row.id}`}
        onPress={() => router.navigate({ pathname: '/(main)/published-conversations/[conversationId]',
          params: { conversationId: row.id } })}
        style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.name, { color: colors.text }]}>{row.displayName}</Text>
        {row.description ? <Text numberOfLines={2} style={{ color: colors.textSecondary }}>
          {row.description}</Text> : null}
        {status(row) ? <Text style={{ color: colors.textSecondary }}>{status(row)}</Text> : null}
      </Pressable>)}
      {loading ? <ActivityIndicator style={styles.state} color={colors.brand} /> : null}
      {!loading && error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.state}>
        <Text style={{ color: colors.error }}>{t.failed} {t.retry}</Text>
      </Pressable> : null}
      {!loading && !error && rows.length === 0 ? <Text style={[styles.state, { color: colors.textSecondary }]}>
        {t.empty}</Text> : null}
      {!loading && cursor ? <Pressable accessibilityRole="button" onPress={() => void load(cursor)} style={styles.state}>
        <Text style={{ color: colors.brand }}>{t.more}</Text>
      </Pressable> : null}
    </ScrollView>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { flexGrow: 1, paddingBottom: 32 },
  row: { paddingHorizontal: 20, paddingVertical: 16, minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  name: { fontSize: 16, fontWeight: '600' }, state: { marginTop: 32, textAlign: 'center', alignSelf: 'center' },
})
