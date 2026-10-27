// @arch docs/product/ui-design/互动内容流_极简交互与分发_设计说明.md
import { useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { contentClient, type CollectionKind, type ContentCard as Card } from './contentClient'
import { ContentCard } from './ContentCard'
export function ContentCollection({ kind, onBack, onOpen, onMore, refreshKey }: {
  kind: CollectionKind; onBack(): void; onOpen(workId: string): void; onMore(card: Card): void; refreshKey: number
}) {
  const { colors } = useTheme(), { t } = useTranslation(), { width } = useWindowDimensions()
  const [cards, setCards] = useState<Card[]>([]), [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  const busy = useRef(false), epoch = useRef(0)
  const load = async (offset = 0) => {
    if (busy.current) return
    busy.current = true
    const started = epoch.current
    setLoading(true); setFailed(false)
    try {
      const result = await contentClient.collection(kind, offset)
      if (started !== epoch.current) return
      setCards((old) => offset ? [...new Map([...old, ...result.works].map((item) => [item.workId, item])).values()] : result.works)
      setNext(result.nextOffset)
    } catch { if (started === epoch.current) setFailed(true) }
    finally { if (started === epoch.current) { busy.current = false; setLoading(false) } }
  }
  useEffect(() => { epoch.current++; busy.current = false; setCards([]); setNext(null); void load(); return () => { epoch.current++ } }, [kind, refreshKey])
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <AppPageHeader title={t(`content_${kind}`)} onBack={onBack} />
    <FlatList data={cards} numColumns={2} keyExtractor={(item) => item.workId}
      contentContainerStyle={{ padding: 18, gap: 22 }} columnWrapperStyle={{ gap: 14 }}
      initialNumToRender={4} maxToRenderPerBatch={2} windowSize={3}
      refreshing={loading} onRefresh={() => { void load().catch(() => {}) }}
      onEndReached={() => { if (next !== null) void load(next).catch(() => {}) }}
      ListEmptyComponent={failed ? <Pressable accessibilityRole="button" onPress={() => { void load() }} style={{ paddingTop: 48 }}><Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('content_load_retry')}</Text></Pressable> : !loading ? <Text style={{ color: colors.textMuted, paddingTop: 48, textAlign: 'center' }}>{t('content_no_items')}</Text> : <View />}
      renderItem={({ item }) => <ContentCard card={item} width={(width - 50) / 2}
        onOpen={() => onOpen(item.workId)} onMore={kind === 'works' ? () => onMore(item) : undefined} />} />
  </SafeAreaView>
}
