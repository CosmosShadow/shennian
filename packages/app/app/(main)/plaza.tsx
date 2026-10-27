import { useMobileModuleBack } from '../../src/components/useMobileModuleBack'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../src/components/AppPageHeader'
import { RoomIdentityAvatar } from '../../src/features/rooms/components/RoomIdentityAvatar'
import { plazaAccountClient, type PlazaAgent } from '../../src/features/contacts/plazaAccountClient'
import { useTheme } from '../../src/hooks/useTheme'

export default function PlazaScreen() {
  const moduleBack = useMobileModuleBack()
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [query, setQuery] = useState('')
  const [agents, setAgents] = useState<PlazaAgent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const requestGeneration = useRef(0)

  const load = useCallback(async (search: string) => {
    const generation = ++requestGeneration.current
    setLoading(true)
    setFailed(false)
    try {
      const result = await plazaAccountClient.list(search)
      if (generation === requestGeneration.current) {
        setAgents(result.agents)
        setCursor(result.nextCursor)
      }
    } catch {
      if (generation === requestGeneration.current) setFailed(true)
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [])
  useFocusEffect(useCallback(() => {
    void load(query)
    return () => { requestGeneration.current += 1 }
  }, [load, query]))

  const loadMore = async () => {
    if (!cursor || moreLoading) return
    const generation = requestGeneration.current
    setMoreLoading(true)
    try {
      const result = await plazaAccountClient.list(query, cursor)
      if (generation === requestGeneration.current) {
        setAgents((current) => [...current, ...result.agents])
        setCursor(result.nextCursor)
      }
    } finally {
      setMoreLoading(false)
    }
  }

  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={t('mobile_plaza')} onBack={moduleBack} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
        <Ionicons name="search-outline" size={22} color={colors.textSecondary} />
        <TextInput value={query} onChangeText={setQuery} placeholder={t('mobile_search_ai')}
          placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]}
          clearButtonMode="while-editing" autoCorrect={false} />
      </View>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('mobile_plaza_explicit_hint')}</Text>
      {loading ? <ActivityIndicator style={styles.state} color={colors.brand} /> : failed ?
        <Pressable style={styles.state} onPress={() => void load(query)}><Text style={{ color: colors.textSecondary }}>{t('mobile_plaza_load_failed')}</Text><Text style={{ color: colors.brand }}>{t('retry')}</Text></Pressable> :
        agents.length ? <>
          {agents.map((agent) => <Pressable key={agent.publicId} accessibilityRole="button"
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => router.navigate({ pathname: '/(main)/plaza/[publicId]', params: { publicId: agent.publicId } })}>
            <RoomIdentityAvatar name={agent.displayName} avatar={agent.avatar} agent size={54} />
            <View style={styles.copy}><Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{agent.displayName}</Text>
              <Text style={[styles.description, { color: colors.textSecondary }]} numberOfLines={2}>{agent.description}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>)}
          {cursor ? <Pressable style={styles.state} onPress={() => void loadMore()} disabled={moreLoading}>
            {moreLoading ? <ActivityIndicator color={colors.brand} /> : <Text style={{ color: colors.brand }}>{t('mobile_load_more')}</Text>}
          </Pressable> : null}
        </> : <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('mobile_plaza_empty')}</Text>}
    </ScrollView>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { paddingHorizontal: 16, paddingBottom: 24 },
  search: { height: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginTop: 12 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  hint: { fontSize: 13, lineHeight: 19, marginVertical: 16 },
  row: { minHeight: 82, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  copy: { flex: 1, gap: 4 }, name: { fontSize: 16, fontWeight: '600' }, description: { fontSize: 13, lineHeight: 19 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 }, empty: { textAlign: 'center', fontSize: 14, marginTop: 55 },
})
