import { ActionIconButton } from '../../components/ActionIconButton'
// @arch docs/product/ui-design/互动内容流_极简交互与分发_设计说明.md
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ContentCanvas } from './ContentCanvas'
import { contentClient, type ContentCard as Card } from './contentClient'
import type { ContentDocument } from './contentSession'
import { useTheme } from '../../hooks/useTheme'

export function ContentCard({ card, width, onOpen, onMore }: { card: Card; width: number; onOpen(): void; onMore?(): void }) {
  const { colors } = useTheme(), { t } = useTranslation()
  const [document, setDocument] = useState<ContentDocument | null>(null)
  useEffect(() => {
    let active = true
    if (card.versionId) void contentClient.document(card.workId, card.versionId).then((result) => { if (active) setDocument(result) }).catch(() => {})
    return () => { active = false }
  }, [card.workId, card.versionId, card.headRevision])
  return <View style={{ width }}>
    <Pressable accessibilityRole="button" accessibilityLabel={card.title || t('content_creating')} onPress={onOpen} disabled={!card.versionId}>
      <View pointerEvents="none" style={[styles.preview, { height: width * 1.32, backgroundColor: colors.surface }]}>
        {document ? <View style={{ width: 375, height: 495, transform: [{ scale: width / 375 }], transformOrigin: 'top left' }}>
          <ContentCanvas document={document} />
        </View> : <ActivityIndicator style={styles.loading} color={colors.textMuted} />}
      </View>
    </Pressable>
    {onMore ? <ActionIconButton icon="more" color={colors.textMuted} label={t('content_manage')} onPress={onMore} surface
      style={styles.more} /> : null}
    <View style={styles.footer}>
      <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{card.title || t('content_creating')}</Text>
    </View>
    {!card.versionId || !card.published ? <Text style={[styles.status, { color: colors.textMuted }]}>{t(card.versionId ? 'content_unpublished' : 'content_creating')}</Text> : null}
  </View>
}
const styles = StyleSheet.create({
  preview: { borderRadius: 14, overflow: 'hidden' }, loading: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', paddingTop: 8 },
  title: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  more: { position: 'absolute', top: 4, right: 4 },
  status: { fontSize: 12, marginTop: 3 },
})
