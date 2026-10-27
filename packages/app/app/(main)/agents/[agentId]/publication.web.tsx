// @arch docs/features/published-agent-direct-conversations.md

import { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { managedAgentExecutionMode, resolveManagedAgentPermissionPolicy } from '@shennian/wire'
import { useAuthStore } from '../../../../src/config/auth'
import { getServerUrl } from '../../../../src/config/server'
import { DesktopAgentDetailHeader } from '../../../../src/features/desktop-agents/DesktopAgentDetailLayout'
import { useDesktopAgentDetailModel } from '../../../../src/features/desktop-agents/useDesktopAgentDetailModel'
import { publicationBlockerLabel } from '../../../../src/features/published-agents/publicationBlockers'
import { PublishedAgentShareQr } from '../../../../src/features/published-agents/PublishedAgentShareQr'
import { desktopPublicationPort, type OwnedPublication, type OwnedConversation,
  type OwnedMessage, type PublicationReadiness } from '../../../../src/features/desktop-agents/desktopPublicationPort'
import { useTheme } from '../../../../src/hooks/useTheme'

const copy = {
  zh: { title: '发布本机智能体', name: '公开名称', description: '公开介绍', limit: '每日消息上限（UTC 零点重置）',
    save: '保存资料与额度', draft: '创建发布草稿', pause: '暂停发布', revoke: '撤销链接',
    confirm: '撤销后旧链接立即失效，访客仍可查看自己的历史。', share: '复制分享文字',
    copied: '已复制', qr: '分享链接二维码', status: '状态', generation: '链接世代', used: '今日已用',
    draftStatus: '草稿', activeStatus: '已发布', pausedStatus: '已暂停', revokedStatus: '已撤销',
    machine: '运行机器', online: '在线', offline: '离线', unknown: '状态未知',
    full: '完整本机权限', restricted: '受限权限', permission: '当前智能体工作权限',
    isolation: '对外对话继承此智能体当前权限；请核对允许访客使用的能力。', activate: '激活发布',
    fullAccessNotice: '此智能体具有完整本机权限。发布后，已登录访客可通过对话驱动它运行命令、访问本机文件和已开放的能力；提示词不是强制隔离。请确认本机数据适合这样使用。',
    confirmActivate: '确认发布', cancel: '取消', activateNotice: '拿到链接的真人或其 AI 可以与本机智能体建立独立对话；创建者可以查看对话正文。',
    readiness: '运行检查', refreshReadiness: '刷新运行检查', protection: '执行保护', auth: '登录状态',
    unavailable: '当前尚不能激活，请查看运行检查。',
    conversations: '对外对话', empty: '暂无对外对话', more: '查看更多', older: '更早消息',
    plaza: '在广场展示', plazaHint: '公开资料会出现在广场搜索中。只有激活发布的 AI 可以上架。',
    plazaListed: '已上架', plazaHidden: '未上架',
    back: '返回列表', refresh: '刷新', loading: '正在读取…', failed: '操作失败，请重试。',
    invalid: '名称为 1–80 字；介绍不超过 1000 字；每日额度为 1–1000 的整数。',
    queued: '待处理', running: '回复中', failedMessage: '失败', cancelled: '已停止',
    creatorReads: '发布者可以查看这些独立对话的正文。',
    shareBody: '打开这个链接即可在网页与我的本机智能体交流；也可以把同一个链接发给你的 AI，让它帮你交流。' },
  en: { title: 'Publish a local agent', name: 'Public name', description: 'Public introduction',
    limit: 'Daily message limit (resets at 00:00 UTC)', save: 'Save profile and limit', draft: 'Create publication draft',
    pause: 'Pause publication', revoke: 'Revoke link',
    confirm: 'The old link stops working immediately. Visitors can still read their own history.', share: 'Copy sharing text',
    copied: 'Copied', qr: 'Share link QR code', status: 'Status', generation: 'Link generation', used: 'Used today',
    draftStatus: 'Draft', activeStatus: 'Published', pausedStatus: 'Paused', revokedStatus: 'Revoked',
    machine: 'Host computer', online: 'Online', offline: 'Offline', unknown: 'Status unknown',
    full: 'Full computer access', restricted: 'Restricted', permission: 'Current Agent work permission',
    isolation: 'External conversations inherit this Agent’s current permissions. Review what visitors may use.', activate: 'Activate publication',
    fullAccessNotice: 'This Agent has full computer access. After publication, signed-in visitors can prompt it to run commands, access local files, and use enabled capabilities. A prompt is not a security boundary. Confirm this computer is suitable for such access.',
    confirmActivate: 'Confirm publication', cancel: 'Cancel', activateNotice: 'People with the link, or their AI, can start a separate conversation with your local agent. You can read the conversation.',
    readiness: 'Runtime checks', refreshReadiness: 'Refresh runtime checks', protection: 'Execution protection', auth: 'Sign-in status',
    unavailable: 'Activation is unavailable. Check the runtime status.',
    conversations: 'External conversations', empty: 'No external conversations yet', more: 'Load more', older: 'Earlier messages',
    plaza: 'Show in Discover', plazaHint: 'The public profile appears in discovery search. Only active AI can be listed.',
    plazaListed: 'Listed', plazaHidden: 'Not listed',
    back: 'Back to list', refresh: 'Refresh', loading: 'Loading…', failed: 'Operation failed. Please retry.',
    invalid: 'Name must be 1–80 characters, introduction at most 1000, and daily limit an integer from 1 to 1000.',
    queued: 'Queued', running: 'Replying', failedMessage: 'Failed', cancelled: 'Stopped',
    creatorReads: 'The publisher can read each separate conversation.',
    shareBody: 'Open this link to chat with my local agent on the web, or send it to your AI to talk on your behalf.' },
} as const

export default function DesktopPublicationRoute() {
  const { agentId = '' } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const { i18n } = useTranslation()
  const t = i18n.language.startsWith('zh') ? copy.zh : copy.en
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const machines = useMachinesStore((state) => state.machines)
  const onUnavailable = useCallback(() => router.back(), [router])
  const agent = useDesktopAgentDetailModel({ accountId, agentId, onUnavailable }).agent
  const machine = machines.find((item) => item.id === agent?.machineId)
  const permission = agent
    ? managedAgentExecutionMode(resolveManagedAgentPermissionPolicy(agent.permissionPolicy, 'legacy')) : null
  const [publication, setPublication] = useState<OwnedPublication | null>(null)
  const [readiness, setReadiness] = useState<PublicationReadiness | null>(null)
  const [confirmingActivation, setConfirmingActivation] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [limit, setLimit] = useState('100')
  const [conversations, setConversations] = useState<OwnedConversation[]>([])
  const [summary, setSummary] = useState<{ conversationCount: number; pendingCount: number;
    runningCount: number; failedCount: number } | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<OwnedConversation | null>(null)
  const [messages, setMessages] = useState<OwnedMessage[]>([])
  const [before, setBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const generation = useRef(0)
  const listGeneration = useRef(0)
  const messageGeneration = useRef(0)

  const loadReadiness = useCallback(async () => {
    const scope = generation.current
    setConfirmingActivation(false)
    try {
      const result = await desktopPublicationPort.readiness(agentId)
      if (scope === generation.current) setReadiness(result.readiness)
    } catch { if (scope === generation.current) setError(t.failed) }
  }, [agentId, t.failed])

  const loadConversations = useCallback(async (next?: string) => {
    const scope = generation.current
    const request = ++listGeneration.current
    try {
      const result = await desktopPublicationPort.conversations(agentId, next)
      if (scope !== generation.current || request !== listGeneration.current) return
      setConversations((current) => next ? [...current, ...result.conversations] : result.conversations)
      if (!next) setSummary(result.summary)
      setCursor(result.nextCursor)
    } catch { if (scope === generation.current && request === listGeneration.current) setError(t.failed) }
  }, [agentId, t.failed])

  const load = useCallback(async () => {
    const request = ++generation.current
    listGeneration.current += 1
    messageGeneration.current += 1
    setLoading(true)
    setPublication(null)
    setReadiness(null)
    setConfirmingActivation(false)
    setConversations([])
    setSummary(null)
    setCursor(null)
    setSelected(null)
    setMessages([])
    setError('')
    try {
      const result = await desktopPublicationPort.get(agentId)
      if (request !== generation.current) return
      setPublication(result.publication)
      setName(result.publication?.displayName ?? agent?.displayName ?? '')
      setDescription(result.publication?.description ?? '')
      setLimit(String(result.publication?.dailyMessageLimit ?? 100))
      void loadReadiness()
      if (result.publication) void loadConversations()
    } catch { if (request === generation.current) setError(t.failed) }
    finally { if (request === generation.current) setLoading(false) }
  }, [agentId, agent?.displayName, loadConversations, loadReadiness, t.failed])

  useFocusEffect(useCallback(() => {
    setBusy(false)
    setCopied(false)
    if (accountId && agentId) void load()
    return () => { generation.current += 1; listGeneration.current += 1; messageGeneration.current += 1 }
  }, [accountId, agentId, load]))

  const mutate = async (action: () => Promise<{ publication: OwnedPublication }>) => {
    if (busy) return
    const scope = generation.current
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (scope !== generation.current) return
      setPublication(result.publication)
      setName(result.publication.displayName)
      setDescription(result.publication.description)
      setLimit(String(result.publication.dailyMessageLimit))
      void loadReadiness()
      void loadConversations()
    } catch { if (scope === generation.current) setError(t.failed) }
    finally { if (scope === generation.current) setBusy(false) }
  }

  const save = () => {
    const dailyMessageLimit = Number(limit)
    const displayName = name.trim()
    if (!displayName || displayName.length > 80 || description.length > 1000
      || !Number.isSafeInteger(dailyMessageLimit) || dailyMessageLimit < 1 || dailyMessageLimit > 1000) {
      setError(t.invalid); return
    }
    void mutate(() => publication && publication.status !== 'revoked'
      ? desktopPublicationPort.update(agentId, publication, displayName, description, dailyMessageLimit)
      : desktopPublicationPort.draft(agentId, displayName, description, dailyMessageLimit))
  }

  const togglePlaza = async () => {
    if (busy || !publication || publication.status !== 'active') return
    const scope = generation.current
    const current = publication
    setBusy(true); setError('')
    try {
      const result = await desktopPublicationPort.plaza(agentId, current, !current.plazaListed)
      if (scope !== generation.current) return
      setPublication(value => value?.id === current.id ? { ...value,
        plazaListed: result.listing.plazaListed, generation: result.listing.generation,
        policyVersion: result.listing.policyVersion } : value)
    } catch { if (scope === generation.current) setError(t.failed) }
    finally { if (scope === generation.current) setBusy(false) }
  }

  const openConversation = async (item: OwnedConversation, older?: string) => {
    const scope = generation.current
    const request = ++messageGeneration.current
    setError('')
    try {
      const result = await desktopPublicationPort.conversation(item.id, older)
      if (scope !== generation.current || request !== messageGeneration.current) return
      setSelected(item)
      setMessages((current) => older ? [...result.messages, ...current] : result.messages)
      setBefore(result.nextBefore)
    } catch { if (scope === generation.current && request === messageGeneration.current) setError(t.failed) }
  }

  const shareUrl = publication?.publicId && ['active', 'paused'].includes(publication.status)
    ? `${getServerUrl()}/p/${publication.publicId}` : null
  const status = publication?.status === 'draft' ? t.draftStatus
    : publication?.status === 'active' ? t.activeStatus
      : publication?.status === 'paused' ? t.pausedStatus : t.revokedStatus
  return <View style={[styles.root, { backgroundColor: colors.bg }]}>
    <DesktopAgentDetailHeader title={t.title} backLabel={t.back} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {loading ? <Text style={{ color: colors.textSecondary }}>{t.loading}</Text> : null}
      <Text style={{ color: colors.textSecondary }}>{t.creatorReads}</Text>
      {agent ? <Text style={{ color: colors.textSecondary }}>
        {t.machine}: {agent.machineName ?? machine?.name ?? '—'} · {machine ? machine.online ? t.online : t.offline : t.unknown}
        {'\n'}{agent.runtimeAdapter} · {t.permission}: {permission === 'native-full' ? t.full : t.restricted}
        {'\n'}{t.isolation}
      </Text> : null}
      {publication ? <Text style={{ color: colors.textSecondary }}>
        {t.status}: {status} · {t.generation}: {publication.generation}
        {'\n'}{t.used}: {publication.messagesUsedToday}/{publication.dailyMessageLimit}
      </Text> : null}
      {publication && publication.status !== 'revoked' ? <View style={styles.section}>
        <Text style={[styles.heading, { color: colors.text }]}>{t.plaza}</Text>
        <Text style={{ color: colors.textSecondary }}>{t.plazaHint}</Text>
        <Pressable testID="desktop-publication-plaza-toggle" accessibilityRole="switch"
          accessibilityState={{ checked: publication.plazaListed, disabled: busy || publication.status !== 'active' }}
          disabled={busy || publication.status !== 'active'} onPress={() => void togglePlaza()}
          style={[styles.action, { opacity: publication.status === 'active' ? 1 : 0.5 }]}>
          <Text style={{ color: colors.brand }}>{publication.plazaListed ? t.plazaListed : t.plazaHidden}</Text>
        </Pressable>
      </View> : null}
      {readiness ? <View style={styles.section}>
        <Text style={[styles.heading, { color: colors.text }]}>{t.readiness}</Text>
        <Text style={{ color: colors.textSecondary }}>
          {readiness.runtimeAdapter ?? '—'}{readiness.runtimeVersion ? ` · ${readiness.runtimeVersion}` : ''}
          {readiness.runtimePlatform ? ` · ${readiness.runtimePlatform}` : ''}
          {'\n'}{t.machine}: {readiness.machineOnline ? t.online : t.offline}
          {' · '}{t.protection}: {readiness.protectionLevel} · {t.auth}: {readiness.authState}
        </Text>
        {readiness.blockers.map((reason) => <Text key={reason} style={{ color: colors.error }}>
          {publicationBlockerLabel(reason, i18n.language)}
        </Text>)}
        <Pressable accessibilityRole="button" onPress={() => void loadReadiness()} style={styles.action}>
          <Text style={{ color: colors.brand }}>{t.refreshReadiness}</Text>
        </Pressable>
      </View> : null}
      <TextInput value={name} onChangeText={setName} placeholder={t.name} accessibilityLabel={t.name}
        maxLength={80} style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
      <TextInput value={description} onChangeText={setDescription} placeholder={t.description}
        accessibilityLabel={t.description} multiline maxLength={1000}
        style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
      <TextInput value={limit} onChangeText={setLimit} placeholder={t.limit} accessibilityLabel={t.limit}
        style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
      <Pressable accessibilityRole="button" disabled={busy || loading} onPress={save} style={styles.action}>
        <Text style={{ color: colors.brand }}>{publication && publication.status !== 'revoked' ? t.save : t.draft}</Text>
      </Pressable>
      {publication && ['draft', 'paused'].includes(publication.status)
        ? readiness?.activationAvailable ? confirmingActivation ? <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.text }]}>{t.confirmActivate}</Text>
          <Text style={{ color: colors.textSecondary }}>{publication.displayName} · {t.limit}: {publication.dailyMessageLimit}</Text>
          <Text style={{ color: colors.textSecondary }}>{t.machine}: {readiness.machineOnline ? t.online : t.offline}
            {' · '}{readiness.runtimeAdapter ?? '—'} · {t.protection}: {readiness.protectionLevel}</Text>
          <Text style={{ color: colors.textSecondary }}>{t.activateNotice}</Text>
          {readiness.executionMode === 'native-full'
            ? <Text style={{ color: colors.error }}>{t.fullAccessNotice}</Text> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={busy}
              onPress={() => void mutate(() => desktopPublicationPort.activate(agentId, publication))} style={styles.action}>
              <Text style={{ color: colors.brand }}>{t.confirmActivate}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmingActivation(false)}
              style={styles.action}><Text style={{ color: colors.textSecondary }}>{t.cancel}</Text></Pressable>
          </View>
        </View> : <Pressable accessibilityRole="button" disabled={busy}
          onPress={() => setConfirmingActivation(true)} style={styles.action}>
          <Text style={{ color: colors.brand }}>{t.activate}</Text>
        </Pressable> : <Text style={{ color: colors.textSecondary }}>{t.unavailable}</Text> : null}
      {publication?.status === 'active' ? <Pressable accessibilityRole="button" disabled={busy}
        onPress={() => void mutate(() => desktopPublicationPort.pause(agentId, publication))} style={styles.action}>
        <Text style={{ color: colors.brand }}>{t.pause}</Text>
      </Pressable> : null}
      {publication && publication.status !== 'revoked' ? <Pressable accessibilityRole="button" disabled={busy}
        onPress={() => { if (window.confirm(t.confirm)) void mutate(() => desktopPublicationPort.revoke(agentId, publication)) }}
        style={styles.action}><Text style={{ color: colors.error }}>{t.revoke}</Text></Pressable> : null}
      {shareUrl ? <View style={styles.section}>
        <Text selectable style={{ color: colors.brand }}>{shareUrl}</Text>
        <PublishedAgentShareQr url={shareUrl} label={t.qr} />
        <Pressable accessibilityRole="button" onPress={() => void navigator.clipboard.writeText(`${t.shareBody}\n${shareUrl}`)
          .then(() => setCopied(true)).catch(() => setError(t.failed))} style={styles.action}>
          <Text style={{ color: colors.brand }}>{t.share}</Text>
        </Pressable>
        {copied ? <Text style={{ color: colors.textSecondary }}>{t.copied}</Text> : null}
      </View> : null}
      {publication ? <View style={styles.section}>
        <Text style={[styles.heading, { color: colors.text }]}>{t.conversations}</Text>
        {selected ? <>
          <Pressable accessibilityRole="button" onPress={() => {
            messageGeneration.current += 1; setSelected(null); setMessages([]); setBefore(null)
          }}>
            <Text style={{ color: colors.brand }}>{t.back}</Text>
          </Pressable>
          <Text style={{ color: colors.text }}>{selected.visitorName || selected.visitorUserId}{selected.visitorPhoneMasked ? ` · ${selected.visitorPhoneMasked}` : ''}</Text>
          <Pressable accessibilityRole="button" onPress={() => void openConversation(selected)}>
            <Text style={{ color: colors.brand }}>{t.refresh}</Text>
          </Pressable>
          {before ? <Pressable accessibilityRole="button" onPress={() => void openConversation(selected, before)}>
            <Text style={{ color: colors.brand }}>{t.older}</Text>
          </Pressable> : null}
          {messages.map((message) => <View key={message.id} style={styles.message}>
            <Text style={{ color: colors.textSecondary }}>{message.authorRole === 'visitor'
              ? selected.visitorName || selected.visitorUserId : agent?.displayName}</Text>
            <Text style={{ color: colors.text }}>{message.text}</Text>
            {['pending', 'running', 'failed', 'cancelled'].includes(message.status)
              ? <Text style={{ color: colors.textSecondary }}>
                {message.status === 'pending' ? t.queued : message.status === 'running' ? t.running
                  : message.status === 'failed' ? t.failedMessage : t.cancelled}
              </Text> : null}
          </View>)}
        </> : <>
          {summary ? <Text style={{ color: colors.textSecondary }}>
            {summary.conversationCount} · {summary.pendingCount} {t.queued}
            {' · '}{summary.runningCount} {t.running} · {summary.failedCount} {t.failedMessage}
          </Text> : null}
          <Pressable accessibilityRole="button" onPress={() => void loadConversations()}>
            <Text style={{ color: colors.brand }}>{t.refresh}</Text>
          </Pressable>
          {conversations.length === 0 ? <Text style={{ color: colors.textSecondary }}>{t.empty}</Text> : null}
          {conversations.map((item) => <Pressable key={item.id} accessibilityRole="button"
            onPress={() => void openConversation(item)} style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={{ color: colors.text }}>{item.visitorName || item.visitorUserId}{item.visitorPhoneMasked ? ` · ${item.visitorPhoneMasked}` : ''}</Text>
            <Text style={{ color: colors.textSecondary }}>{new Date(item.lastActivityAt).toLocaleString()}</Text>
          </Pressable>)}
          {cursor ? <Pressable accessibilityRole="button" onPress={() => void loadConversations(cursor)}>
            <Text style={{ color: colors.brand }}>{t.more}</Text>
          </Pressable> : null}
        </>}
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { padding: 24, gap: 14, maxWidth: 760, width: '100%' },
  input: { minHeight: 42, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  action: { minHeight: 40, justifyContent: 'center' }, section: { paddingTop: 18, gap: 10 },
  actions: { flexDirection: 'row', gap: 22, alignItems: 'center' },
  heading: { fontSize: 18, fontWeight: '600' },
  row: { minHeight: 54, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
  message: { paddingVertical: 8, gap: 4 },
})
