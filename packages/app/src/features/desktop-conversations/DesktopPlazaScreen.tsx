// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界

import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { DesktopAgentPlaza } from './DesktopAgentPlaza'
import { DesktopSocialIdentity } from './DesktopSocialIdentity'
import { desktopSocialAccountPort, type PlazaAgent } from './desktopSocialAccountPort'

export default function DesktopPlazaScreen() {
  const accountId = useAuthStore(state => state.user?.id ?? '')
  return accountId ? <DesktopAccountPlaza key={accountId} accountId={accountId} /> : null
}

function DesktopAccountPlaza({ accountId }: { accountId: string }) {
  const router = useRouter()
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [query, setQuery] = useState('')
  const [agents, setAgents] = useState<PlazaAgent[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<PlazaAgent | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [revision, setRevision] = useState(0)
  const queryRef = useRef(query)
  queryRef.current = query
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  useEffect(() => {
    let current = true
    setAgents([]); setNextCursor(null); setState('loading')
    const timer = setTimeout(() => {
      void desktopSocialAccountPort.plaza(query.trim()).then(result => {
        if (!current || useAuthStore.getState().user?.id !== accountId) return
        setAgents(result.agents); setNextCursor(result.nextCursor); setState('ready')
      }).catch(() => { if (current) setState('failed') })
    }, query ? 200 : 0)
    return () => { current = false; clearTimeout(timer) }
  }, [accountId, query, revision])
  useEffect(() => {
    let current = true
    setSelected(null); setSaved(false)
    if (selectedId) void desktopSocialAccountPort.plazaDetail(selectedId).then(agent => {
      if (current && useAuthStore.getState().user?.id === accountId) setSelected(agent)
    }).catch(() => { if (current) setSelectedId(null) })
    return () => { current = false }
  }, [accountId, selectedId])
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    const cursor = nextCursor
    try {
      const result = await desktopSocialAccountPort.plaza(query.trim(), cursor)
      if (useAuthStore.getState().user?.id !== accountId || queryRef.current !== query) return
      setAgents(current => [...new Map([...current, ...result.agents].map(agent => [agent.publicId, agent])).values()])
      setNextCursor(result.nextCursor)
    } catch { if (queryRef.current === query) Alert.alert(zh ? '加载更多失败' : 'Could not load more AI') }
    finally { if (useAuthStore.getState().user?.id === accountId) setLoadingMore(false) }
  }
  const save = async () => {
    if (!selectedId || saving || saved) return
    setSaving(true)
    try {
      await desktopSocialAccountPort.saveAgent(selectedId)
      if (useAuthStore.getState().user?.id === accountId && selectedIdRef.current === selectedId) setSaved(true)
    } catch { if (selectedIdRef.current === selectedId) Alert.alert(zh ? '添加联系人失败' : 'Could not add contact') }
    finally { if (useAuthStore.getState().user?.id === accountId) setSaving(false) }
  }
  if (selectedId) return selected ? <DesktopSocialIdentity identity={{ id: selected.publicId,
    displayName: selected.displayName, description: selected.description, kind: 'agent', avatar: selected.avatar,
    availability: selected.status === 'active' && selected.machineOnline ? 'available' : 'offline',
    canOpenConversation: false }} saved={saved} saving={saving} onSaveContact={() => void save()}
    onBack={() => setSelectedId(null)} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>
  return <DesktopAgentPlaza agents={agents.map(agent => ({ id: agent.publicId,
    displayName: agent.displayName, summary: agent.description, avatar: agent.avatar }))}
    query={query} state={state} nextCursor={nextCursor} loadingMore={loadingMore}
    onQueryChange={setQuery} onRetry={() => setRevision(value => value + 1)}
    onOpen={setSelectedId} onLoadMore={() => void loadMore()}
    onBack={() => router.navigate('/(main)/contacts' as never)} />
}
