// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-sync.test.ts
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-native-markdown-display'
import { useTheme } from '../../hooks/useTheme'
import { AppPageHeader, HeaderIconButton } from '../../components/ConnectedAppPageHeader'
import { useMobileModuleBack } from '../../components/useMobileModuleBack'
import { useAuthStore } from '../../config/auth'
import { diaryLinkDate } from './diaryLink'
import { diaryStatus, subscribeDiary, refreshDiary, diaryDocuments, diaryDocument, diaryScope } from './diaryRuntime'
import type { DiaryDocument, DiaryEntry } from './diarySync'
import { diaryMarkdown, diaryStats } from './diaryStats'
import { DiaryImage } from './DiaryImage'
import { useContextualSteward } from '../steward/ContextualStewardContext'
import { diaryBody, diaryPresentation } from './diaryPresentation'
import { DiaryMenu } from './DiaryMenu'

export default function DiaryScreen() {
  const { t } = useTranslation(), { colors } = useTheme(), back = useMobileModuleBack(), router = useRouter()
  const params = useLocalSearchParams<{ date?: string; machineId?: string }>()
  const userId = useAuthStore(s => s.user?.id)
  const status = useSyncExternalStore(subscribeDiary, diaryStatus, diaryStatus)
  const target = status.target, wrongMachine = !!params.machineId && params.machineId !== target?.machine?.id
  const scope = target?.machine && !wrongMachine ? JSON.stringify([userId, diaryScope(target)]) : ''
  const date = params.date ? diaryLinkDate(`shennian://diary/${params.date}`) : null
  const [opened, setOpened] = useState<string | null>(date ? `${date.slice(0, 4)}/${date}.md` : null)
  const [local, setLocal] = useState<{ scope: string; entries: DiaryEntry[]; document: DiaryDocument | null }>({ scope: '', entries: [], document: null })
  const [localError, setLocalError] = useState(false)
  const setDetails = useContextualSteward()?.setDetails
  useEffect(() => {
    setDetails?.({ kind: 'diary', ...(scope && target?.machine ? { machineId: target.machine.id, path: opened ?? '' } : {}) })
  }, [setDetails, scope, target?.machine?.id, opened])

  useEffect(() => { setOpened(date ? `${date.slice(0, 4)}/${date}.md` : null) }, [date, scope])
  const load = useCallback(() => {
    let live = true
    if (target?.machine && scope) void Promise.all([diaryDocuments(target), opened ? diaryDocument(target, opened) : Promise.resolve(null)]).then(([entries, document]) => {
      if (live) { setLocal({ scope, entries, document }); setLocalError(false) }
    }).catch(() => { if (live) setLocalError(true) })
    return () => { live = false }
  }, [scope, target, opened])
  useEffect(load, [load])
  // Each replica mutation refreshes from SQLite; rendering never waits for the computer.
  useEffect(() => { let cancel = () => {}; const unsubscribe = subscribeDiary(() => { cancel(); cancel = load() }); return () => { cancel(); unsubscribe() } }, [load])
  useFocusEffect(useCallback(() => { void refreshDiary() }, []))
  const entries = local.scope === scope ? local.entries : [], document = local.scope === scope ? local.document : null
  const leave = () => { if (opened) setOpened(null); else back?.() }
  const [menuVisible, setMenuVisible] = useState(false)
  const metadata = (entry: DiaryEntry, includeDate = true) => {
    const stats = 'content' in entry ? diaryStats(String(entry.content)) : entry
    return [includeDate ? diaryPresentation(entry).date : null, t('personal_diary_characters', { count: stats.characterCount ?? 0 }),
      stats.photoCount ? t('personal_diary_photos', { count: stats.photoCount }) : null].filter(Boolean).join(' · ')
  }
  const errorKey = wrongMachine ? 'personal_diary_other_machine' : localError ? 'personal_unavailable' : status.error
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <AppPageHeader title={[t('personal_diary'), opened && document ? diaryPresentation(document).date : null].filter(Boolean).join(' ')} onBack={opened || back ? leave : undefined} trailing={!opened ? <HeaderIconButton icon="ellipsis-horizontal" label={t('personal_diary_more')} onPress={() => setMenuVisible(true)} /> : undefined} />
    <DiaryMenu visible={!opened && menuVisible} close={() => setMenuVisible(false)} status={status} />
    {errorKey || (!target?.machine && !status.busy) ? <View style={{ paddingHorizontal: 24, paddingTop: 12, gap: 8 }}>
      {errorKey ? <Text accessibilityRole="alert" style={{ color: colors.textSecondary }}>{t(errorKey)}</Text> : null}
      {!target?.machine && !status.busy ? <Pressable accessibilityRole="button" onPress={() => router.navigate('/(main)/primary-computer')}><Text style={{ color: colors.brand }}>{t('personal_primary_settings')}</Text></Pressable> : null}
    </View> : null}
    {opened ?
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 110 }}>{document ? <>
        <Markdown markdownit={diaryMarkdown} onLinkPress={() => false} rules={{ image: node => <DiaryImage key={node.key} src={(node as unknown as { attributes: { src?: string } }).attributes.src ?? ''} alt={node.content} machineId={scope ? target?.machine?.id : undefined} directory={status.directory} path={document.path} /> }} style={{
          body: { color: colors.text, fontSize: 17, lineHeight: 28 },
          heading1: { fontSize: 26, lineHeight: 38, fontWeight: '600', marginTop: 0, marginBottom: 20 },
          heading2: { fontSize: 21, lineHeight: 31, fontWeight: '600', marginTop: 20, marginBottom: 12 },
          heading3: { fontSize: 18, lineHeight: 28, fontWeight: '600', marginTop: 20, marginBottom: 10 },
          paragraph: { marginTop: 0, marginBottom: 16 },
          blockquote: { backgroundColor: colors.surface, borderColor: colors.border, borderLeftWidth: 3, marginLeft: 0, marginRight: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0, marginBottom: 8 },
        }}>{diaryBody(document)}</Markdown>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 20, marginTop: 24 }}>{metadata(document, false)}</Text>
      </> : status.busy ? <ActivityIndicator color={colors.brand} /> : <Text style={{ color: colors.textSecondary }}>{t('personal_diary_not_cached')}</Text>}</ScrollView> :
      <FlatList data={entries} keyExtractor={entry => entry.path} contentContainerStyle={{ padding: 24, paddingTop: 18, paddingBottom: 110, gap: 16 }} ListEmptyComponent={status.busy ? <ActivityIndicator color={colors.brand} /> : <Text style={{ color: colors.textSecondary }}>{t('personal_empty')}</Text>} renderItem={({ item }) => {
        const entry = diaryPresentation(item)
        return <Pressable accessibilityRole="button" testID={`personal-entry-${item.path}`} onPress={() => setOpened(item.path)} style={({ pressed }) => ({ padding: 20, borderRadius: 20, gap: 12, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 })}>
          {entry.heading ? <Text numberOfLines={2} style={{ color: colors.text, fontSize: 18, lineHeight: 27, fontWeight: '600' }}>{entry.heading}</Text> : null}
          {entry.summary ? <Text numberOfLines={3} style={{ color: entry.heading ? colors.textSecondary : colors.text, fontSize: 16, lineHeight: 25 }}>{entry.summary}</Text> : null}
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{metadata(item)}</Text>
        </Pressable>
      }} />}
  </SafeAreaView>
}
