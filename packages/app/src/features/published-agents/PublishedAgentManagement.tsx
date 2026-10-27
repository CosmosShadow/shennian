// @arch docs/features/published-agent-direct-conversations.md

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Head from 'expo-router/head'
import { useTranslation } from 'react-i18next'
import * as Clipboard from 'expo-clipboard'
import { ApiError } from '@shennian/shared/api'
import { authApi } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { getServerUrl } from '../../config/server'
import { useTheme } from '../../hooks/useTheme'
import { useAuthPublicConfig } from '../auth/hooks/useAuthPublicConfig'
import { usePhoneLogin } from '../auth/hooks/usePhoneLogin'
import { PhoneLoginPanel } from '../auth/components/PhoneLoginPanel'
import { TencentCaptchaModal } from '../../components/auth/TencentCaptchaModal'
import { PublishedAgentShareQr } from './PublishedAgentShareQr'
import { SimpleMessageMarkdown } from '../../components/chat/SimpleMessageMarkdown'

type Agent = { id: string; displayName: string; status: string }
type Publication = {
  id: string; agentIdentityId: string
  status: 'draft' | 'active' | 'paused' | 'revoked'
  generation: number; policyVersion: number
  publicId?: string; displayName: string; description: string
  suggestedQuestions?: string[]
  dailyMessageLimit: number; messagesUsedToday: number
  allowAnonymousVisitors: boolean; requireContactApproval: boolean
}
type Readiness = { machineOnline: boolean; runtimeAdapter: string | null
  executionMode?: 'native-full' | 'restricted'
  runtimeVersion: string | null; runtimePlatform: string | null
  protectionLevel: string; authState: string; runtimeEligible: boolean
  blockers: string[]; activationAvailable: boolean }
type Conversation = { id: string; visitorUserId: string; visitorName?: string;
  visitorPhoneMasked?: string | null;
  status: string; lastActivityAt: string }
type ConversationSummary = { conversationCount: number; pendingCount: number;
  runningCount: number; failedCount: number }
type Message = { id: string; authorRole: string; text: string; createdAt: string }

const copy = {
  zh: {
    title: '发布我的 AI', login: '登录后管理你的 AI 发布',
    empty: '还没有可发布的 AI。先在神念 App 或 Client 中创建 AI。',
    select: '选择 AI', draft: '创建发布草稿', save: '保存介绍与额度',
    name: '公开名称', description: '公开介绍', questions: '默认问题（最多 3 个，可留空）',
    question: '问题', invalidQuestions: '每个问题最多 80 字，且不能重复。', limit: '每日消息上限',
    status: '状态', used: '今日已用', link: '分享链接',
    pause: '暂停', revoke: '撤销链接', activate: '激活发布',
    confirmActivate: '确认发布', activateNotice: '确认后，拿到链接的已登录访客或其 AI 可以与你的 AI 开始一对一对话，并使用它当前配置的权限。创建者可以查看对话正文。',
    anonymous: '允许免登录对话', anonymousOff: '关闭免登录对话',
    anonymousNotice: '适合客服入口。访客只靠当前浏览器续聊；任何拿到链接的人都可能消耗你的模型额度。创建者可查看正文。不能与添加审核同时开启。',
    anonymousBlocked: '先关闭添加审核，才能开启免登录对话。',
    anonymousActivateNotice: '确认后，拿到链接的访客无需登录即可与你的 AI 对话并消耗模型额度；你可以查看正文。',
    fullAccessNotice: '此 AI 具有完整本机权限。访客可能通过对话驱动它运行命令、访问文件及已开放的能力；提示词不是强制隔离。请确认本机数据适合这样使用。',
    confirmRevoke: '确定撤销这个链接？旧链接将立即失效。', cancel: '取消',
    unavailable: '公开执行权限验证尚未通过，暂不能激活。',
    noPublication: '此 AI 尚未创建发布草稿。', revoked: '链接已撤销。可重新创建草稿，旧链接不会恢复。',
    invalidLimit: '每日消息上限须为 1–1000 的整数。',
    conversations: '对外对话', noConversations: '暂无对话。',
    conversationCount: '访客对话', pendingCount: '待处理消息', runningCount: '回复中',
    failedCount: '失败消息', refresh: '刷新对话',
    more: '查看更多', open: '查看正文', back: '返回列表',
    visitorPaused: '这位访客的对话已暂停', resumeVisitor: '恢复此对话',
    loading: '正在读取…', retry: '重试', failed: '操作失败，请重试。',
    share: '把这个链接发给别人，即可在网页与我的 AI 一对一对话；也可以把同一个链接发给你的 AI，让它帮你交流。',
    copyLink: '复制链接', copyInvite: '复制分享文字', copied: '已复制', qr: '分享链接二维码',
    runtime: '本机运行环境', machineOnline: '电脑在线', machineOffline: '电脑离线',
    protection: '执行保护', auth: '登录状态', runtimeEligible: '本机执行条件已满足',
    runtimeBlocked: '本机执行条件尚未满足',
    refreshReadiness: '刷新运行检查',
    reasons: { agent_unavailable: '智能体不可用', machine_unavailable: '电脑未配对',
      agent_mode_unavailable: '此智能体模式尚不能对外执行',
      machine_offline: '电脑离线', runtime_unavailable: '运行 Agent 不可用或不支持当前执行模式',
      runtime_auth_unverified: '运行 Agent 登录状态未确认',
      runtime_protection_unverified: '运行时权限配置尚未验证',
      runtime_capability_gap: '运行时无法满足当前权限配置',
      runtime_permission_unconfirmed: '完整本机权限需要 Owner 对当前智能体权限配置确认' },
  },
  en: {
    title: 'Publish my AI', login: 'Sign in to manage your AI publication',
    empty: 'No AI is ready to publish. Create one in the Shennian app or Client first.',
    select: 'Choose an AI', draft: 'Create publication draft', save: 'Save profile and limit',
    name: 'Public name', description: 'Public description', questions: 'Starter questions (up to 3, optional)',
    question: 'Question', invalidQuestions: 'Each question must be at most 80 characters and unique.', limit: 'Daily message limit',
    status: 'Status', used: 'Used today', link: 'Share link',
    pause: 'Pause', revoke: 'Revoke link', activate: 'Activate publication',
    confirmActivate: 'Confirm publication', activateNotice: 'Signed-in people with the link, or their AI, can start a one-to-one conversation with your AI using its configured permissions. You can read the messages.',
    anonymous: 'Allow chats without sign-in', anonymousOff: 'Turn off guest chats',
    anonymousNotice: 'For customer support. Guests return only with the same browser data. Anyone with the link may use your model quota, and you can read messages. Cannot be combined with contact review.',
    anonymousBlocked: 'Turn off contact review before enabling guest chats.',
    anonymousActivateNotice: 'People with the link can chat without signing in and use your model quota. You can read their messages.',
    fullAccessNotice: 'This AI has full computer access. Visitors may prompt it to run commands, access files, and use enabled capabilities. A prompt is not a security boundary. Confirm this computer is suitable for such access.',
    confirmRevoke: 'Revoke this link? The old URL will stop working immediately.', cancel: 'Cancel',
    unavailable: 'Public execution has not passed permission verification yet.',
    noPublication: 'This AI has no publication draft.', revoked: 'The link was revoked. Create a new draft without restoring the old URL.',
    invalidLimit: 'Daily message limit must be an integer from 1 to 1000.',
    conversations: 'External conversations', noConversations: 'No conversations yet.',
    conversationCount: 'Conversations', pendingCount: 'Queued messages', runningCount: 'Replying',
    failedCount: 'Failed messages', refresh: 'Refresh conversations',
    more: 'Load more', open: 'Read messages', back: 'Back to list',
    visitorPaused: 'This visitor conversation is paused', resumeVisitor: 'Resume this conversation',
    loading: 'Loading…', retry: 'Retry', failed: 'Operation failed. Please retry.',
    share: 'Send this link to someone for a one-to-one web conversation with my AI. They can also send the same link to their AI to talk on their behalf.',
    copyLink: 'Copy link', copyInvite: 'Copy share text', copied: 'Copied', qr: 'Share link QR code',
    runtime: 'Local runtime', machineOnline: 'Computer online', machineOffline: 'Computer offline',
    protection: 'Execution protection', auth: 'Sign-in status', runtimeEligible: 'Local runtime checks passed',
    runtimeBlocked: 'Local runtime checks have not passed',
    refreshReadiness: 'Refresh runtime checks',
    reasons: { agent_unavailable: 'Agent unavailable', machine_unavailable: 'Computer not paired',
      agent_mode_unavailable: 'This Agent mode cannot run publicly yet',
      machine_offline: 'Computer offline', runtime_unavailable: 'Runtime unavailable or current execution mode unsupported',
      runtime_auth_unverified: 'Runtime sign-in is unverified',
      runtime_protection_unverified: 'Runtime permission configuration unverified',
      runtime_capability_gap: 'Runtime cannot satisfy the current permission policy',
      runtime_permission_unconfirmed: 'Owner must confirm full computer access for this Agent policy' },
  },
} as const

export function PublishedAgentManagement() {
  const accountId = useAuthStore((state) => state.isAuthenticated ? state.user?.id ?? null : null)
  return <PublishedAgentManagementForAccount key={accountId ?? 'signed-out'} />
}

function PublishedAgentManagementForAccount() {
  const { i18n } = useTranslation()
  const t = i18n.language.startsWith('zh') ? copy.zh : copy.en
  const { colors } = useTheme()
  const authConfig = useAuthPublicConfig()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const phoneLogin = usePhoneLogin({ captchaAppId: authConfig.tencentCaptchaAppId ?? '', redirectTo: '/publish' })
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState('')
  const [publication, setPublication] = useState<Publication | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState(['', '', ''])
  const [dailyLimit, setDailyLimit] = useState('100')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [summary, setSummary] = useState<ConversationSummary | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [selectedConversation, setSelectedConversation] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [confirmingActivation, setConfirmingActivation] = useState(false)
  const [confirmingAnonymous, setConfirmingAnonymous] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const activeAgentId = useRef('')
  const activeConversationId = useRef('')
  const listRequestVersion = useRef(0)
  const messageRequestVersion = useRef(0)
  const mutationVersion = useRef(0)

  const loadAgents = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    try {
      const result = await authApi<{ agents: Agent[] }>('/agents')
      setAgents(result.agents)
      setError('')
    } catch { setError(t.failed) }
    finally { setLoading(false) }
  }, [isAuthenticated, t.failed])

  useEffect(() => { void loadAgents() }, [loadAgents])

  const loadPublication = useCallback(async (id: string) => {
    listRequestVersion.current += 1
    setLoading(true)
    setCopied(false)
    setSelectedConversation('')
    setConfirmingRevoke(false)
    setConfirmingActivation(false)
    setConfirmingAnonymous(false)
    setConversations([])
    setSummary(null)
    setCursor(null)
    try {
      const result = await authApi<{ publication: Publication | null }>(`/agents/${id}/publication`)
      if (activeAgentId.current !== id) return
      setPublication(result.publication)
      setName(result.publication?.displayName ?? agents.find((agent) => agent.id === id)?.displayName ?? '')
      setDescription(result.publication?.description ?? '')
      setQuestions(Array.from({ length: 3 }, (_, index) => result.publication?.suggestedQuestions?.[index] ?? ''))
      setDailyLimit(String(result.publication?.dailyMessageLimit ?? 100))
      setError('')
    } catch (cause) {
      if (activeAgentId.current !== id) return
      setPublication(null)
      setError(cause instanceof ApiError && cause.status === 404 ? t.noPublication : t.failed)
    } finally { if (activeAgentId.current === id) setLoading(false) }
  }, [agents, t.failed, t.noPublication])

  const loadReadiness = useCallback(async (id: string) => {
    setReadiness(null)
    setConfirmingActivation(false)
    setConfirmingAnonymous(false)
    try {
      const result = await authApi<{ readiness: Readiness }>(`/agents/${id}/publication/readiness`)
      if (activeAgentId.current === id) setReadiness(result.readiness)
    } catch { if (activeAgentId.current === id) setReadiness(null) }
  }, [])

  const selectAgent = useCallback((id: string) => {
    if (activeAgentId.current === id) return
    activeAgentId.current = id
    mutationVersion.current += 1
    activeConversationId.current = ''
    messageRequestVersion.current += 1
    setAgentId(id)
    setBusy(false)
    setPublication(null)
    setReadiness(null)
    setConfirmingActivation(false)
    setSelectedConversation('')
    setMessages([])
    setMessageCursor(null)
    void loadPublication(id)
    void loadReadiness(id)
  }, [loadPublication, loadReadiness])

  const mutate = useCallback(async (path: string, method: 'POST' | 'PUT', body: object) => {
    if (!agentId || busy) return
    const requestedAgentId = agentId
    const requestedMutationVersion = ++mutationVersion.current
    setBusy(true)
    setError('')
    try {
      const result = await authApi<{ publication: Publication }>(`/agents/${agentId}/publication${path}`, {
        method, body: JSON.stringify(body),
      })
      if (activeAgentId.current !== requestedAgentId
        || mutationVersion.current !== requestedMutationVersion) return
      setPublication(result.publication)
      setConfirmingActivation(false)
      setConfirmingAnonymous(false)
      setName(result.publication.displayName)
      setDescription(result.publication.description)
      setQuestions(Array.from({ length: 3 }, (_, index) => result.publication.suggestedQuestions?.[index] ?? ''))
      setDailyLimit(String(result.publication.dailyMessageLimit))
      void loadReadiness(requestedAgentId)
    } catch {
      if (activeAgentId.current === requestedAgentId
        && mutationVersion.current === requestedMutationVersion) setError(t.failed)
    } finally {
      if (activeAgentId.current === requestedAgentId
        && mutationVersion.current === requestedMutationVersion) setBusy(false)
    }
  }, [agentId, busy, loadReadiness, t.failed])

  const loadConversations = useCallback(async (nextCursor?: string) => {
    if (!agentId) return
    const requestedAgentId = agentId
    if (!nextCursor) listRequestVersion.current += 1
    const requestVersion = listRequestVersion.current
    try {
      const suffix = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ''
      const result = await authApi<{ conversations: Conversation[]; nextCursor: string | null;
        summary: ConversationSummary | null }>(
        `/agents/${agentId}/publication/conversations${suffix}`,
      )
      if (activeAgentId.current !== requestedAgentId
        || listRequestVersion.current !== requestVersion) return
      setConversations((old) => nextCursor ? [...old, ...result.conversations] : result.conversations)
      if (!nextCursor) setSummary(result.summary)
      setCursor(result.nextCursor)
      setError('')
    } catch {
      if (activeAgentId.current === requestedAgentId
        && listRequestVersion.current === requestVersion) setError(t.failed)
    }
  }, [agentId, t.failed])

  useEffect(() => {
    if (publication && agentId) void loadConversations()
  }, [publication?.id, publication?.status, publication?.generation, agentId, loadConversations])

  const openConversation = useCallback(async (id: string, before?: string) => {
    const requestedAgentId = activeAgentId.current
    if (!before) messageRequestVersion.current += 1
    const requestVersion = messageRequestVersion.current
    activeConversationId.current = id
    setSelectedConversation(id)
    if (!before) { setMessages([]); setMessageCursor(null) }
    try {
      const result = await authApi<{ messages: Message[]; nextBefore: string | null }>(
        `/agent-direct-conversations/${id}?before=${encodeURIComponent(before ?? 'latest')}`,
      )
      if (activeAgentId.current !== requestedAgentId || activeConversationId.current !== id
        || messageRequestVersion.current !== requestVersion) return
      setMessages((old) => before
        ? [...result.messages.filter((message) => !old.some((existing) => existing.id === message.id)), ...old]
        : result.messages)
      setMessageCursor(result.nextBefore)
      setError('')
    } catch {
      if (activeAgentId.current === requestedAgentId && activeConversationId.current === id
        && messageRequestVersion.current === requestVersion) setError(t.failed)
    }
  }, [t.failed])

  const shareUrl = publication?.publicId && ['active', 'paused'].includes(publication.status)
    ? `${getServerUrl()}/p/${publication.publicId}` : null
  const limitValue = Number(dailyLimit)
  const validLimit = Number.isSafeInteger(limitValue) && limitValue >= 1 && limitValue <= 1000
  const copyShare = async (includeText: boolean) => {
    if (!shareUrl) return
    try {
      await Clipboard.setStringAsync(includeText ? `${t.share}\n${shareUrl}` : shareUrl)
      setCopied(true)
      setError('')
    } catch { setError(t.failed) }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <Head><title>{t.title} · Shennian</title><meta name="robots" content="noindex,nofollow" /></Head>
      <TencentCaptchaModal
        visible={phoneLogin.captchaVisible} appId={authConfig.tencentCaptchaAppId ?? ''}
        onClose={() => phoneLogin.setCaptchaVisible(false)} onVerified={phoneLogin.handleCaptchaVerified}
      />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>{t.title}</Text>
        {!isAuthenticated ? <View style={styles.section}>
          <Text style={{ color: colors.textSecondary }}>{t.login}</Text>
          <PhoneLoginPanel phone={phoneLogin.phone} setPhone={phoneLogin.setPhone}
            code={phoneLogin.code} setCode={phoneLogin.setCode}
            countdown={phoneLogin.countdown} sendingCode={phoneLogin.sendingCode}
            loading={phoneLogin.loading} onSendCode={phoneLogin.handleSendCode}
            onLogin={phoneLogin.handleLogin} colors={colors} />
          {phoneLogin.error ? <Text style={{ color: colors.error }}>{phoneLogin.error}</Text> : null}
        </View> : <View style={styles.section}>
          {loading ? <ActivityIndicator color={colors.brand} /> : null}
          {agents.length === 0 && !loading ? <Text style={{ color: colors.textSecondary }}>{t.empty}</Text> : null}
          <Text style={{ color: colors.text }}>{t.select}</Text>
          <View style={styles.agentList}>{agents.map((agent) => (
            <Pressable key={agent.id} accessibilityRole="button" disabled={busy}
              onPress={() => selectAgent(agent.id)}
              style={[styles.chip, { borderColor: agentId === agent.id ? colors.brand : colors.border }]}>
              <Text style={{ color: colors.text }}>{agent.displayName}</Text>
            </Pressable>
          ))}</View>
          {agentId ? <View style={styles.section}>
            {publication ? <Text style={{ color: colors.textSecondary }}>{t.status}: {publication.status} · {t.used}: {publication.messagesUsedToday}/{publication.dailyMessageLimit}</Text>
              : <Text style={{ color: colors.textSecondary }}>{t.noPublication}</Text>}
            {publication?.status === 'revoked' ? <Text style={{ color: colors.textSecondary }}>{t.revoked}</Text> : null}
            {readiness ? <View style={styles.section}>
              <Text style={{ color: colors.text }}>{t.runtime}: {readiness.runtimeAdapter ?? '—'}
                {readiness.runtimeVersion ? ` · ${readiness.runtimeVersion}` : ''}
                {readiness.runtimePlatform ? ` · ${readiness.runtimePlatform}` : ''}</Text>
              <Text style={{ color: colors.textSecondary }}>
                {readiness.machineOnline ? t.machineOnline : t.machineOffline}
                {' · '}{t.protection}: {readiness.protectionLevel}
                {' · '}{t.auth}: {readiness.authState}
              </Text>
              <Text style={{ color: readiness.runtimeEligible ? colors.textSecondary : colors.error }}>
                {readiness.runtimeEligible ? t.runtimeEligible : t.runtimeBlocked}
              </Text>
              {readiness.blockers.map((reason) => <Text key={reason} style={{ color: colors.error }}>
                {t.reasons[reason as keyof typeof t.reasons] ?? reason}
              </Text>)}
              <Pressable accessibilityRole="button" onPress={() => void loadReadiness(agentId)}>
                <Text style={{ color: colors.brand }}>{t.refreshReadiness}</Text>
              </Pressable>
            </View> : null}
            <TextInput value={name} onChangeText={setName} placeholder={t.name} accessibilityLabel={t.name}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
            <TextInput value={description} onChangeText={setDescription} placeholder={t.description}
              accessibilityLabel={t.description} multiline maxLength={1000}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
            <Text style={{ color: colors.text }}>{t.questions}</Text>
            {questions.map((question, index) => <TextInput key={index} value={question}
              onChangeText={(value) => setQuestions((current) => current.map((item, i) => i === index ? value : item))}
              placeholder={`${t.question} ${index + 1}`} accessibilityLabel={`${t.question} ${index + 1}`}
              maxLength={80} style={[styles.input, { color: colors.text, borderColor: colors.border }]} />)}
            {new Set(questions.map((item) => item.trim()).filter(Boolean)).size
              !== questions.map((item) => item.trim()).filter(Boolean).length
              ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{t.invalidQuestions}</Text> : null}
            <TextInput value={dailyLimit} onChangeText={setDailyLimit} placeholder={t.limit}
              accessibilityLabel={t.limit} keyboardType="number-pad"
              style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
            {!validLimit ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{t.invalidLimit}</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy || !name.trim() || !validLimit
              || new Set(questions.map((item) => item.trim()).filter(Boolean)).size
                !== questions.map((item) => item.trim()).filter(Boolean).length}
              onPress={() => void (publication && publication.status !== 'revoked'
                ? mutate('', 'PUT', { expectedGeneration: publication.generation,
                  expectedPolicyVersion: publication.policyVersion, displayName: name,
                  description, suggestedQuestions: questions.map((item) => item.trim()).filter(Boolean),
                  dailyMessageLimit: limitValue })
                : mutate('/draft', 'POST', { displayName: name, description,
                  suggestedQuestions: questions.map((item) => item.trim()).filter(Boolean),
                  dailyMessageLimit: limitValue }))}>
              <Text style={{ color: colors.brand }}>{publication && publication.status !== 'revoked' ? t.save : t.draft}</Text>
            </Pressable>
            {publication && publication.status !== 'revoked' ? <View style={styles.section}>
              <Text style={{ color: colors.text }}>{t.anonymous}: {publication.allowAnonymousVisitors ? 'ON' : 'OFF'}</Text>
              {publication.requireContactApproval && !publication.allowAnonymousVisitors
                ? <Text style={{ color: colors.textSecondary }}>{t.anonymousBlocked}</Text> : null}
              {confirmingAnonymous ? <View style={styles.section}>
                <Text style={{ color: colors.error }}>{t.anonymousNotice}</Text>
                <View style={styles.row}>
                  <Pressable accessibilityRole="button" disabled={busy}
                    onPress={() => void mutate('/anonymous-access', 'PUT', {
                      allowed: true, expectedGeneration: publication.generation,
                      expectedPolicyVersion: publication.policyVersion,
                    })}><Text style={{ color: colors.brand }}>{t.anonymous}</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setConfirmingAnonymous(false)}>
                    <Text style={{ color: colors.textSecondary }}>{t.cancel}</Text>
                  </Pressable>
                </View>
              </View> : <Pressable accessibilityRole="button"
                disabled={busy || (publication.requireContactApproval && !publication.allowAnonymousVisitors)}
                onPress={() => publication.allowAnonymousVisitors
                  ? void mutate('/anonymous-access', 'PUT', { allowed: false,
                    expectedGeneration: publication.generation,
                    expectedPolicyVersion: publication.policyVersion })
                  : setConfirmingAnonymous(true)}>
                <Text style={{ color: colors.brand }}>
                  {publication.allowAnonymousVisitors ? t.anonymousOff : t.anonymous}
                </Text>
              </Pressable>}
            </View> : null}
            {publication?.status === 'active' ? <Pressable accessibilityRole="button" disabled={busy}
              onPress={() => void mutate('/pause', 'POST', { expectedGeneration: publication.generation,
                expectedPolicyVersion: publication.policyVersion })}>
              <Text style={{ color: colors.brand }}>{t.pause}</Text>
            </Pressable> : null}
            {publication && ['draft', 'paused'].includes(publication.status)
              && readiness?.activationAvailable ? confirmingActivation ? <View style={styles.section}>
                <Text style={{ color: colors.text }}>{t.confirmActivate}</Text>
                <Text style={{ color: colors.textSecondary }}>{publication.displayName} · {t.limit}: {publication.dailyMessageLimit}</Text>
                <Text style={{ color: colors.textSecondary }}>{t.runtime}: {readiness.runtimeAdapter ?? '—'}
                  {' · '}{readiness.machineOnline ? t.machineOnline : t.machineOffline}
                  {' · '}{t.protection}: {readiness.protectionLevel}</Text>
                <Text style={{ color: colors.textSecondary }}>
                  {publication.allowAnonymousVisitors ? t.anonymousActivateNotice : t.activateNotice}
                </Text>
                {readiness.executionMode === 'native-full'
                  ? <Text style={{ color: colors.error }}>{t.fullAccessNotice}</Text> : null}
                <View style={styles.row}>
                  <Pressable accessibilityRole="button" disabled={busy}
                    onPress={() => void mutate('/activate', 'POST', {
                      expectedGeneration: publication.generation,
                      expectedPolicyVersion: publication.policyVersion,
                    })}><Text style={{ color: colors.brand }}>{t.confirmActivate}</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmingActivation(false)}>
                    <Text style={{ color: colors.textSecondary }}>{t.cancel}</Text>
                  </Pressable>
                </View>
              </View> : <Pressable accessibilityRole="button" disabled={busy}
                onPress={() => setConfirmingActivation(true)}>
                <Text style={{ color: colors.brand }}>{t.activate}</Text>
              </Pressable> : null}
            {publication && publication.status !== 'revoked' ? confirmingRevoke ? <View style={styles.section}>
              <Text style={{ color: colors.error }}>{t.confirmRevoke}</Text>
              <Pressable accessibilityRole="button" disabled={busy}
                onPress={() => { setConfirmingRevoke(false); void mutate('/revoke', 'POST', {
                  expectedGeneration: publication.generation,
                }) }}>
                <Text style={{ color: colors.error }}>{t.revoke}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setConfirmingRevoke(false)}>
                <Text style={{ color: colors.brand }}>{t.cancel}</Text>
              </Pressable>
            </View> : <Pressable accessibilityRole="button" disabled={busy}
              onPress={() => setConfirmingRevoke(true)}>
              <Text style={{ color: colors.error }}>{t.revoke}</Text>
            </Pressable> : null}
            {publication && ['draft', 'paused'].includes(publication.status)
              && !readiness?.activationAvailable
              ? <Text style={{ color: colors.textSecondary }}>{t.unavailable}</Text> : null}
            {shareUrl ? <View style={styles.section}>
              <Text style={{ color: colors.text }}>{t.link}</Text>
              <Text selectable style={{ color: colors.brand }}>{shareUrl}</Text>
              <PublishedAgentShareQr url={shareUrl} label={t.qr} />
              <Text selectable style={{ color: colors.textSecondary }}>{t.share}</Text>
              <View style={styles.row}>
                <Pressable accessibilityRole="button" onPress={() => void copyShare(false)}>
                  <Text style={{ color: colors.brand }}>{t.copyLink}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void copyShare(true)}>
                  <Text style={{ color: colors.brand }}>{t.copyInvite}</Text>
                </Pressable>
              </View>
              {copied ? <Text accessibilityRole="alert" style={{ color: colors.textSecondary }}>{t.copied}</Text> : null}
            </View> : null}
            {publication ? <View style={styles.section}>
              <Text style={{ color: colors.text }}>{t.conversations}</Text>
              {summary ? <Text style={{ color: colors.textSecondary }}>
                {t.conversationCount}: {summary.conversationCount} · {t.pendingCount}: {summary.pendingCount}
                {' · '}{t.runningCount}: {summary.runningCount} · {t.failedCount}: {summary.failedCount}
              </Text> : null}
              <Pressable accessibilityRole="button" onPress={() => void loadConversations()}>
                <Text style={{ color: colors.brand }}>{t.refresh}</Text>
              </Pressable>
              {selectedConversation ? <>
                {conversations.find((item) => item.id === selectedConversation)?.status === 'paused'
                  ? <View style={styles.row}>
                    <Text style={{ color: colors.error }}>{t.visitorPaused}</Text>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
                      setBusy(true)
                      void authApi(`/agent-direct-conversations/${encodeURIComponent(selectedConversation)}/resume`,
                        { method: 'POST', body: '{}' })
                        .then(() => loadConversations())
                        .catch(() => setError(t.failed))
                        .finally(() => setBusy(false))
                    }}><Text style={{ color: colors.brand }}>{t.resumeVisitor}</Text></Pressable>
                  </View> : null}
                <Pressable accessibilityRole="button" onPress={() => {
                  activeConversationId.current = ''
                  messageRequestVersion.current += 1
                  setSelectedConversation('')
                }}>
                  <Text style={{ color: colors.brand }}>{t.back}</Text>
                </Pressable>
                {messages.map((message) => <View key={message.id}>
                  <Text style={{ color: colors.textSecondary }}>{message.authorRole}</Text>
                  <SimpleMessageMarkdown content={message.text ?? ''} typography={{ fontSize: 15, lineHeight: 22 }}
                    color={colors.text} linkColor={colors.brand} codeBackground={colors.surface} />
                </View>)}
                {messageCursor ? <Pressable accessibilityRole="button"
                  onPress={() => void openConversation(selectedConversation, messageCursor)}>
                  <Text style={{ color: colors.brand }}>{t.more}</Text>
                </Pressable> : null}
              </> : <>
                {conversations.length === 0 ? <Text style={{ color: colors.textSecondary }}>{t.noConversations}</Text> : null}
                {conversations.map((conversation) => <Pressable key={conversation.id} accessibilityRole="button"
                  onPress={() => void openConversation(conversation.id)}>
                  <Text style={{ color: colors.brand }}>{t.open} · {conversation.visitorName || conversation.visitorUserId}{conversation.visitorPhoneMasked ? ` · ${conversation.visitorPhoneMasked}` : ''} · {conversation.lastActivityAt}</Text>
                </Pressable>)}
                {cursor ? <Pressable accessibilityRole="button" onPress={() => void loadConversations(cursor)}>
                  <Text style={{ color: colors.brand }}>{t.more}</Text>
                </Pressable> : null}
              </>}
            </View> : null}
          </View> : null}
        </View>}
        {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingVertical: 40 },
  card: { width: '100%', maxWidth: 760, borderWidth: 1, borderRadius: 18, padding: 28, gap: 18 },
  title: { fontSize: 28, fontWeight: '700' },
  section: { gap: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  agentList: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 44 },
})
