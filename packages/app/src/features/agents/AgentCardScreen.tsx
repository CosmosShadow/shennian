import { useOwnerDirectUnread } from '../published-agents/useOwnerDirectUnread'
import { UnreadCountBadge } from '../../features/unread/UnreadCountBadge'
// @arch docs/product/ui-design/AI详情与名片_设计说明.md
// @test src/__tests__/agent-card-screen.test.ts
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../components/AppPageHeader'
import { authApi } from '../../config/api'
import { getServerUrl } from '../../config/server'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useAgentDetailModel } from './useAgentDetailModel'
import { AgentCardQr } from './AgentCardQr'
import { recoverAgentCardFailure } from './agentCardFailure'

type Publication = {
  id: string
  status: 'draft' | 'active' | 'paused' | 'revoked'
  publicId?: string
  generation: number
  policyVersion: number
  plazaListed: boolean
  allowNewContacts: boolean
  requireContactApproval: boolean
  allowAnonymousVisitors: boolean
  displayName: string
  description: string
  dailyMessageLimit: number
  suggestedQuestions?: string[]
}

type ContactRequest = { id: string; requesterName: string; createdAt: string }
type VisitorConversation = { id: string; visitorName?: string; unreadCount?: number; lastActivityAt: string; status: string }

export default function AgentCardScreen() {
  const { agentId = '' } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const onUnavailable = useCallback(() => router.back(), [router])
  const agent = useAgentDetailModel({ accountId, agentId, onUnavailable }).agent
  const [publication, setPublication] = useState<Publication | null>(null)
  const [questions, setQuestions] = useState(['', '', ''])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ownerDirectUnread = useOwnerDirectUnread()
  const [requests, setRequests] = useState<ContactRequest[]>([])
  const [conversations, setConversations] = useState<VisitorConversation[]>([])
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    if (!agent || !accountId) return
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    try {
      const result = await authApi<{ publication: Publication | null }>(
        `/agents/${encodeURIComponent(agentId)}/publication`,
      )
      let card = result.publication
      // The card is an identity, not a separate public name or introduction.
      // First opening idempotently allocates its stable link without enabling execution.
      if (!card || card.status === 'revoked') {
        const created = await authApi<{ publication: Publication }>(
          `/agents/${encodeURIComponent(agentId)}/publication/draft`, {
            method: 'POST', body: JSON.stringify({
              displayName: agent.displayName,
              description: agent.description ?? '',
            }),
          },
        )
        card = created.publication
      }
      if (version === requestVersion.current) {
        setPublication(card)
        setQuestions(Array.from({ length: 3 }, (_, index) => card?.suggestedQuestions?.[index] ?? ''))
        if (!card?.publicId) setError(zh ? '暂时无法获取邀请链接' : 'Invite link unavailable')
      }
      try {
        const pending = await authApi<{ requests: ContactRequest[] }>(
          `/agents/${encodeURIComponent(agentId)}/publication/contact-requests`,
        )
        if (version === requestVersion.current) setRequests(pending.requests)
      } catch {
        if (version === requestVersion.current) {
          setRequests([])
          setError(zh ? '添加申请加载失败，请刷新' : 'Could not load contact requests. Refresh.')
        }
      }
      try {
        const result = await authApi<{ conversations: VisitorConversation[]; nextCursor: string | null }>(
          `/agents/${encodeURIComponent(agentId)}/publication/conversations`,
        )
        if (version === requestVersion.current) {
          setConversations(result.conversations)
          setConversationCursor(result.nextCursor)
        }
      } catch {
        if (version === requestVersion.current) setError(zh ? '访客对话加载失败，请刷新' : 'Could not load visitor chats. Refresh.')
      }
    } catch {
      if (version === requestVersion.current) setError(zh ? '名片加载失败，请重试' : 'Could not load the card. Retry.')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [accountId, agent, agentId, zh])

  useFocusEffect(useCallback(() => {
    void load()
    return () => { requestVersion.current += 1 }
  }, [load]))

  useFocusEffect(useCallback(() => {
    if (!accountId || !agentId) return
    let active = true
    const timer = setInterval(() => {
      void authApi<{ conversations: VisitorConversation[] }>(
        `/agents/${encodeURIComponent(agentId)}/publication/conversations`,
      ).then((result) => {
        if (!active) return
        setConversations((current) => {
          const fresh = new Map(result.conversations.map((row) => [row.id, row]))
          return [...result.conversations, ...current.filter((row) => !fresh.has(row.id))]
        })
      }).catch(() => {})
    }, 10_000)
    return () => { active = false; clearInterval(timer) }
  }, [accountId, agentId]))

  const recoverSetting = async (failure: unknown, current: Publication, activating: boolean, version: number) => {
    const result = await recoverAgentCardFailure({
      error: failure, current, zh, activating,
      readPublication: () => authApi<{ publication: Publication | null }>(
        `/agents/${encodeURIComponent(agentId)}/publication`),
      readReadiness: () => authApi<{ readiness: { blockers: string[]; activationAvailable?: boolean } }>(
        `/agents/${encodeURIComponent(agentId)}/publication/readiness`),
    })
    if (version === requestVersion.current) {
      setPublication(result.publication)
      setError(result.message)
    }
  }

  const updateContacts = async (allowed: boolean) => {
    if (!publication || busy) return
    const version = requestVersion.current
    setBusy(true)
    setError('')
    let current = publication
    try {
      if (allowed && current.status !== 'active') {
        const activated = await authApi<{ publication: Publication }>(
          `/agents/${encodeURIComponent(agentId)}/publication/activate`, {
            method: 'POST', body: JSON.stringify({
              expectedGeneration: current.generation,
              expectedPolicyVersion: current.policyVersion,
            }),
          },
        )
        current = activated.publication
      }
      const result = await authApi<{ publication: Publication }>(
        `/agents/${encodeURIComponent(agentId)}/publication/contact-adding`, {
          method: 'PUT', body: JSON.stringify({
            allowed,
            expectedGeneration: current.generation,
            expectedPolicyVersion: current.policyVersion,
          }),
        },
      )
      if (version === requestVersion.current) setPublication(result.publication)
    } catch (failure) {
      await recoverSetting(failure, current, allowed && current.status !== 'active', version)
    } finally { if (version === requestVersion.current) setBusy(false) }
  }

  const toggleContacts = (allowed: boolean) => {
    if (!allowed || publication?.status === 'active') { void updateContacts(allowed); return }
    Alert.alert(
      zh ? '启用对外对话？' : 'Enable external conversations?',
      zh
        ? publication?.allowAnonymousVisitors
          ? '启用后，任何拿到链接的人无需登录即可发消息驱动这台电脑上的 AI，沿用它当前的工作权限并消耗模型额度。你可以查看对话正文。'
          : '启用后，已添加或之后添加的人可以发消息驱动这台电脑上的 AI，沿用它当前的工作权限。创建者可以查看对话正文。'
        : publication?.allowAnonymousVisitors
          ? 'Anyone with the link can chat without signing in, using this AI’s current computer permissions and your model quota. You can read the conversations.'
          : 'People who add this AI can then send messages to it using its current permissions on this computer. You can read the conversations.',
      [
        { text: zh ? '取消' : 'Cancel', style: 'cancel' },
        { text: zh ? '确认' : 'Confirm', onPress: () => void updateContacts(true) },
      ],
    )
  }

  const togglePlaza = async (listed: boolean) => {
    if (!publication || busy) return
    const version = requestVersion.current
    setBusy(true)
    setError('')
    let current = publication
    try {
      // Listing in Discover must imply people can actually talk to it; activate
      // first so a card is never publicly visible yet unusable (mirrors updateContacts).
      if (listed && current.status !== 'active') {
        const activated = await authApi<{ publication: Publication }>(
          `/agents/${encodeURIComponent(agentId)}/publication/activate`, {
            method: 'POST', body: JSON.stringify({
              expectedGeneration: current.generation,
              expectedPolicyVersion: current.policyVersion,
            }),
          },
        )
        current = activated.publication
      }
      const result = await authApi<{ listing: { plazaListed: boolean; generation: number; policyVersion: number } }>(
        `/agents/${encodeURIComponent(agentId)}/publication/plaza`, {
          method: 'PUT', body: JSON.stringify({
            listed,
            expectedGeneration: current.generation,
            expectedPolicyVersion: current.policyVersion,
          }),
        },
      )
      if (version === requestVersion.current) setPublication({ ...current, ...result.listing })
    } catch (failure) {
      await recoverSetting(failure, current, listed && current.status !== 'active', version)
    } finally { if (version === requestVersion.current) setBusy(false) }
  }

  const toggleApproval = async (required: boolean) => {
    if (!publication || busy || !publication.allowNewContacts) return
    const version = requestVersion.current
    setBusy(true)
    setError('')
    try {
      const result = await authApi<{ publication: Publication }>(
        `/agents/${encodeURIComponent(agentId)}/publication/contact-approval`, {
          method: 'PUT', body: JSON.stringify({ required,
            expectedGeneration: publication.generation,
            expectedPolicyVersion: publication.policyVersion }),
        },
      )
      if (version === requestVersion.current) setPublication(result.publication)
    } catch (failure) {
      await recoverSetting(failure, publication, false, version)
    } finally { if (version === requestVersion.current) setBusy(false) }
  }

  const updateAnonymous = async (allowed: boolean) => {
    if (!publication || busy || (allowed && publication.requireContactApproval)) return
    const version = requestVersion.current
    setBusy(true)
    setError('')
    let current = publication
    try {
      if (allowed && current.status !== 'active') {
        const activated = await authApi<{ publication: Publication }>(
          `/agents/${encodeURIComponent(agentId)}/publication/activate`, {
            method: 'POST', body: JSON.stringify({
              expectedGeneration: current.generation,
              expectedPolicyVersion: current.policyVersion,
            }),
          },
        )
        current = activated.publication
      }
      const result = await authApi<{ publication: Publication }>(
        `/agents/${encodeURIComponent(agentId)}/publication/anonymous-access`, {
          method: 'PUT', body: JSON.stringify({ allowed,
            expectedGeneration: current.generation,
            expectedPolicyVersion: current.policyVersion }),
        },
      )
      if (version === requestVersion.current) setPublication(result.publication)
    } catch (failure) {
      await recoverSetting(failure, current, allowed && current.status !== 'active', version)
    } finally { if (version === requestVersion.current) setBusy(false) }
  }

  const toggleAnonymous = (allowed: boolean) => {
    if (!allowed) { void updateAnonymous(false); return }
    Alert.alert(
      zh ? '允许直接使用？' : 'Allow direct use?',
      zh
        ? '拿到链接的人无需账号即可驱动此 AI，并消耗你的模型额度。访客只凭当前浏览器找回对话，清除浏览器数据后可能无法找回；你可以查看对话正文。请确认 AI 的本机权限适合公开使用。'
        : 'Anyone with the link can use this AI and consume your model quota. Guests can return only with the same browser data. You can read their messages. Confirm this AI’s computer permissions are suitable for public use.',
      [
        { text: zh ? '取消' : 'Cancel', style: 'cancel' },
        { text: zh ? '开启' : 'Enable', onPress: () => void updateAnonymous(true) },
      ],
    )
  }

  const review = async (request: ContactRequest, approved: boolean) => {
    if (busy) return
    const version = requestVersion.current
    setBusy(true)
    setError('')
    try {
      await authApi(`/agents/${encodeURIComponent(agentId)}/publication/contact-requests/${encodeURIComponent(request.id)}/review`, {
        method: 'POST', body: JSON.stringify({ approved }),
      })
      if (version === requestVersion.current) setRequests((current) => current.filter((item) => item.id !== request.id))
    } catch {
      if (version === requestVersion.current) setError(zh ? '处理申请失败，请重试' : 'Could not review the request. Retry.')
    } finally { if (version === requestVersion.current) setBusy(false) }
  }

  const loadMoreConversations = async () => {
    if (!conversationCursor || conversationsLoading) return
    setConversationsLoading(true)
    try {
      const result = await authApi<{ conversations: VisitorConversation[]; nextCursor: string | null }>(
        `/agents/${encodeURIComponent(agentId)}/publication/conversations?cursor=${encodeURIComponent(conversationCursor)}`,
      )
      setConversations((old) => [...old, ...result.conversations.filter((item) =>
        !old.some((existing) => existing.id === item.id))])
      setConversationCursor(result.nextCursor)
    } catch { setError(zh ? '访客对话加载失败，请刷新' : 'Could not load visitor chats. Refresh.') }
    finally { setConversationsLoading(false) }
  }

  const saveQuestions = async () => {
    if (!publication || busy) return
    const normalized = questions.map((question) => question.trim()).filter(Boolean)
    if (normalized.some((question) => question.length > 80)
      || new Set(normalized).size !== normalized.length) {
      setError(zh ? '默认问题不能重复，每条最多 80 字' : 'Starter questions must be unique and at most 80 characters')
      return
    }
    const version = requestVersion.current
    setBusy(true)
    setError('')
    try {
      const result = await authApi<{ publication: Publication }>(
        `/agents/${encodeURIComponent(agentId)}/publication`, {
          method: 'PUT', body: JSON.stringify({
            expectedGeneration: publication.generation,
            expectedPolicyVersion: publication.policyVersion,
            displayName: publication.displayName,
            description: publication.description,
            dailyMessageLimit: publication.dailyMessageLimit,
            suggestedQuestions: normalized,
          }),
        })
      if (version === requestVersion.current) {
        setPublication(result.publication)
        setQuestions(Array.from({ length: 3 }, (_, index) => result.publication.suggestedQuestions?.[index] ?? ''))
      }
    } catch (failure) {
      await recoverSetting(failure, publication, false, version)
    } finally { if (version === requestVersion.current) setBusy(false) }
  }

  const url = publication?.status === 'active' && publication.publicId
    ? `${getServerUrl()}/p/${publication.publicId}` : null
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={agent?.displayName ?? (zh ? '我的 AI' : 'My AI')}
      onBack={() => router.back()} />
    <ScrollView style={{ backgroundColor: colors.groupedBackground }} contentContainerStyle={styles.content}>
      {loading ? <ActivityIndicator color={colors.brand} /> : null}
      {url && agent ? <AgentCardQr name={agent.displayName} url={url} /> : null}
      {!loading && !publication ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}>
        <Text style={{ color: colors.brand }}>{zh ? '重试' : 'Retry'}</Text>
      </Pressable> : null}
      {publication ? <>
        {publication.status !== 'active' ? <Pressable style={[styles.activation, { backgroundColor: colors.groupedSurface }]}
          accessibilityRole="button" disabled={busy} onPress={() => toggleContacts(true)}>
          <Text style={{ color: colors.brand, fontWeight: '600' }}>
            {zh ? '启用对外对话' : 'Enable external conversations'}
          </Text>
          <Text style={[styles.settingHint, { color: colors.textSecondary }]}>
            {zh ? '名片可被添加；启用前，别人暂不能与这个 AI 对话' : 'People can add this card, but cannot chat until it is enabled'}
          </Text>
        </Pressable> : null}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{zh ? '名片设置' : 'Card settings'}</Text>
        <View style={[styles.settings, { backgroundColor: colors.groupedSurface }]}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingName, { color: colors.text }]}>{zh ? '在广场展示' : 'Show in Discover'}</Text>
            </View>
            <View style={styles.switchControl}>
              <Switch testID="agent-card-plaza-listing" value={publication.plazaListed}
                style={styles.settingSwitch} disabled={busy} onValueChange={(value) => void togglePlaza(value)} />
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingName, { color: colors.text }]}>{zh ? '允许别人添加' : 'Allow others to add'}</Text>
            </View>
            <View style={styles.switchControl}>
              <Switch testID="agent-card-allow-adding" value={publication.allowNewContacts}
                style={styles.settingSwitch} disabled={busy} onValueChange={toggleContacts} />
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingName, { color: publication.allowNewContacts ? colors.text : colors.textTertiary }]}>
                {zh ? '添加时需审核' : 'Review new contacts'}
              </Text>
            </View>
            <View style={styles.switchControl}>
              <Switch testID="agent-card-contact-approval" value={publication.requireContactApproval}
                style={styles.settingSwitch} disabled={busy || !publication.allowNewContacts
                  || publication.allowAnonymousVisitors}
                onValueChange={(value) => void toggleApproval(value)} />
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingName, { color: colors.text }]}>
                {zh ? '直接使用（无需登录）' : 'Use directly (no sign-in)'}
              </Text>
            </View>
            <View style={styles.switchControl}>
              <Switch testID="agent-card-anonymous-access" value={publication.allowAnonymousVisitors}
                style={styles.settingSwitch} disabled={busy || publication.requireContactApproval}
                onValueChange={toggleAnonymous} />
            </View>
          </View>
        </View>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {zh ? '默认问题' : 'Starter questions'}
        </Text>
        <View style={[styles.questionSettings, { backgroundColor: colors.groupedSurface }]}>
          <Text style={[styles.settingHint, { color: colors.textSecondary }]}>
            {zh ? '最多 3 个；全部留空时，访客页不显示问题。' : 'Up to 3; leave all blank to hide this section.'}
          </Text>
          {questions.map((question, index) => <TextInput key={index}
            value={question} maxLength={80}
            onChangeText={(value) => setQuestions((current) => current.map((item, i) => i === index ? value : item))}
            placeholder={zh ? `问题 ${index + 1}（可留空）` : `Question ${index + 1} (optional)`}
            accessibilityLabel={zh ? `默认问题 ${index + 1}` : `Starter question ${index + 1}`}
            style={[styles.questionInput, { color: colors.text, borderColor: colors.border }]} />)}
          <Pressable accessibilityRole="button" disabled={busy} style={styles.questionSave}
            onPress={() => void saveQuestions()}>
            <Text style={{ color: colors.brand, fontWeight: '600' }}>{zh ? '保存默认问题' : 'Save questions'}</Text>
          </Pressable>
        </View>
        {requests.length ? <>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{zh ? '添加申请' : 'Contact requests'}</Text>
          <View style={[styles.settings, { backgroundColor: colors.groupedSurface }]}>
            {requests.map((request) => <View key={request.id} style={styles.requestRow}>
              <Text style={[styles.requestName, { color: colors.text }]} numberOfLines={1}>{request.requesterName}</Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void review(request, false)}>
                <Text style={{ color: colors.textSecondary }}>{zh ? '拒绝' : 'Reject'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy || !publication.allowNewContacts}
                onPress={() => void review(request, true)}>
                <Text style={{ color: colors.brand }}>{zh ? '同意' : 'Approve'}</Text>
              </Pressable>
            </View>)}
          </View>
        </> : null}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {zh ? '访客对话' : 'Visitor chats'}{conversations.length ? ` (${conversations.length}${conversationCursor ? '+' : ''})` : ''}
        </Text>
        <View style={[styles.settings, { backgroundColor: colors.groupedSurface }]}>
          {conversations.length ? conversations.map((conversation, index) => <View key={conversation.id}>
            {index ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
            <Pressable accessibilityRole="button" style={styles.visitorRow}
              onPress={() => router.navigate({ pathname: '/(main)/published-conversations/[conversationId]',
                params: { conversationId: conversation.id, perspective: 'owner' } })}>
              <Text style={[styles.requestName, { color: colors.text }]} numberOfLines={1}>
                {conversation.visitorName || (zh ? '访客' : 'Visitor')}
                {conversation.status === 'paused' ? (zh ? ' · 已暂停' : ' · Paused') : ''}
              </Text>
              <UnreadCountBadge count={conversation.unreadCount ?? 0} />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {new Date(conversation.lastActivityAt).toLocaleDateString(i18n.language)}
              </Text>
            </Pressable>
          </View>) : <Text style={[styles.visitorEmpty, { color: colors.textSecondary }]}>
            {zh ? '还没有访客对话' : 'No visitor chats yet'}
          </Text>}
          {conversationCursor ? <Pressable accessibilityRole="button" disabled={conversationsLoading}
            style={styles.visitorRow} onPress={() => void loadMoreConversations()}>
            <Text style={{ color: colors.brand }}>{zh ? '查看更多' : 'Load more'}</Text>
            <UnreadCountBadge count={Math.max(0, (ownerDirectUnread[agentId] ?? 0) - conversations.filter((row) => (row.unreadCount ?? 0) > 0).length)} />
          </Pressable> : null}
        </View>
      </> : null}
      {error ? <Pressable accessibilityRole="button" accessibilityLabel={zh ? '刷新名片设置' : 'Refresh card settings'}
        disabled={busy || loading} onPress={() => void load()}><Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {error} {zh ? '点击刷新' : 'Tap to refresh'}
        </Text></Pressable> : null}
    </ScrollView>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { padding: 16, paddingBottom: 36 },
  sectionTitle: { fontSize: 14, marginTop: 22, marginBottom: 10, paddingHorizontal: 4 },
  settings: { borderRadius: 18, paddingHorizontal: 16 },
  settingRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingCopy: { flex: 1, minWidth: 0 },
  settingName: { fontSize: 17, fontWeight: '600' },
  settingHint: { fontSize: 12, lineHeight: 17 },
  switchControl: { width: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  settingSwitch: Platform.OS === 'ios' ? { width: 51, height: 31 } : {},
  questionSettings: { borderRadius: 18, padding: 16, gap: 10 },
  questionInput: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  questionSave: { minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  requestRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 20 },
  requestName: { flex: 1, fontSize: 15 },
  visitorRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8 },
  visitorEmpty: { paddingVertical: 16, fontSize: 14 },
  activation: { borderRadius: 14, padding: 16, gap: 5, marginTop: 16 },
  divider: { height: StyleSheet.hairlineWidth },
  retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  error: { marginTop: 14, fontSize: 13, lineHeight: 18 },
})
