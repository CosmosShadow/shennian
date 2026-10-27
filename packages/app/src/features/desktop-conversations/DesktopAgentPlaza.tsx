// @arch docs/product/ui-design/README.md
// Discovery presentation only; the server decides visibility and ordering.

import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import type { SocialAvatar } from './desktopSocialAccountPort'

export type DesktopPublicAgentView = {
  id: string
  displayName: string
  summary: string
  ownerName?: string
  avatar?: SocialAvatar
}

export function DesktopAgentPlaza({ agents, query, state, nextCursor, loadingMore = false, onQueryChange, onOpen, onRetry, onBack, onLoadMore }: {
  agents: DesktopPublicAgentView[]
  query: string
  state: 'loading' | 'ready' | 'failed'
  nextCursor?: string | null
  loadingMore?: boolean
  onQueryChange(value: string): void
  onOpen(id: string): void
  onRetry(): void
  onBack(): void
  onLoadMore?(): void
}) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const copy = zh ? { title: '广场', back: '联系人', search: '搜索公开的 AI', discover: '发现公开的 AI',
    hint: '了解 AI 的身份与能力后，再决定是否添加和开始对话。', owner: '创建者',
    detail: '查看详情', empty: '暂无公开的 AI', failed: '暂时无法读取广场', retry: '重试', more: '加载更多' }
    : { title: 'Discover', back: 'Contacts', search: 'Search public AI', discover: 'Discover public AI',
      hint: 'Explore an AI identity before adding it or starting a conversation.', owner: 'Created by',
      detail: 'View details', empty: 'No public AI yet', failed: 'Could not load discovery', retry: 'Retry', more: 'Load more' }
  const { colors } = useTheme()
  const wide = useWindowDimensions().width >= 1100
  return <View testID="desktop-agent-plaza" style={[styles.root, { backgroundColor: colors.bg }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.back} onPress={onBack} style={styles.back}>
        <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary }}>{copy.back}</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{copy.title}</Text>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
        <Ionicons name="search-outline" size={19} color={colors.textSecondary} />
        <TextInput value={query} onChangeText={onQueryChange} placeholder={copy.search}
          placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]} />
      </View>
      <View style={styles.intro}>
        <Text style={[styles.introTitle, { color: colors.text }]}>{copy.discover}</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{copy.hint}</Text>
      </View>
      {state === 'loading' ? <View style={styles.empty}><ActivityIndicator color={colors.brand} /></View>
        : state === 'failed' ? <View style={styles.empty} accessibilityRole="alert">
          <Text style={{ color: colors.textSecondary }}>{copy.failed}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={{ color: colors.brand }}>{copy.retry}</Text></Pressable>
        </View> : agents.length === 0 ? <View style={styles.empty}>
          <Ionicons name="compass-outline" size={34} color={colors.textTertiary} />
          <Text style={{ color: colors.textSecondary }}>{copy.empty}</Text>
        </View> : <View style={styles.cards}>{agents.map(agent => <Pressable key={agent.id}
          testID={`desktop-plaza-agent-${agent.id}`} accessibilityRole="button"
          accessibilityLabel={`${agent.displayName}, ${copy.detail}`} onPress={() => onOpen(agent.id)}
          style={({ pressed }) => [styles.card, wide && styles.wideCard,
            { backgroundColor: pressed ? colors.surfaceHover : colors.surface, borderColor: colors.border }]}>
          <RoomIdentityAvatar name={agent.displayName} avatar={agent.avatar} agent size={64} />
          <View style={styles.cardContent}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{agent.displayName}</Text>
            <Text numberOfLines={2} style={[styles.summary, { color: colors.textSecondary }]}>{agent.summary}</Text>
            {agent.ownerName ? <Text numberOfLines={1} style={[styles.owner, { color: colors.textTertiary }]}>{copy.owner} · {agent.ownerName}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
        </Pressable>)}</View>}
      {state === 'ready' && nextCursor && onLoadMore ? <Pressable accessibilityRole="button" disabled={loadingMore}
        onPress={onLoadMore} style={styles.retry}><Text style={{ color: colors.brand }}>{loadingMore ? '…' : copy.more}</Text></Pressable> : null}
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 }, header: { minHeight: 76, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', gap: 24 },
  back: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4 }, title: desktopTypography.windowTitle,
  scroll: { flex: 1 }, content: { width: '100%', maxWidth: 1080, alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 24, gap: 24 },
  search: { height: 42, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14 }, intro: { gap: 5 },
  introTitle: { fontSize: 22, lineHeight: 28, fontWeight: '700' }, hint: { fontSize: 13, lineHeight: 20 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, card: { width: '100%', minHeight: 112, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 15 },
  wideCard: { width: '49%' }, avatar: { width: 64, height: 64, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1, minWidth: 0, gap: 4 }, name: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  summary: { fontSize: 13, lineHeight: 19 }, owner: { fontSize: 11, lineHeight: 16 },
  empty: { minHeight: 250, alignItems: 'center', justifyContent: 'center', gap: 12 }, retry: { minHeight: 36, minWidth: 54, alignItems: 'center', justifyContent: 'center' },
})
