// @arch docs/features/codex-conversation-settings.md
// @test src/__tests__/composer-actions.test.ts
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Keyboard, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_CODEX_CONVERSATION_SETTINGS, SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION,
  type CodexConversationSettings, type CodexConversationSettingsSnapshot,
} from '@shennian/wire'
import { ensureLocalSession } from '../../sessions/ensureLocalSession'
import BottomSheet from '../../../components/BottomSheet'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'

export type ConversationSettingsProps = {
  sessionId: string
  daemonInstallationId?: string | null
  isCodex: boolean
  busy: boolean
  reasoningEfforts: Array<{ id: string; name?: string }>
  reasoningEffort?: string
  onReasoningEffort: (value: string) => void
  send: (frame: never) => Promise<{ ok: boolean; payload?: unknown; error?: string }>
  onClose: () => void
}

export function ConversationSettingsSheet(props: ConversationSettingsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const alive = useRef(true)
  const [snapshot, setSnapshot] = useState<CodexConversationSettingsSnapshot | null>(null)
  const [settings, setSettings] = useState<CodexConversationSettings>({ ...DEFAULT_CODEX_CONVERSATION_SETTINGS })
  const [effort, setEffort] = useState(props.reasoningEffort)
  const [loading, setLoading] = useState(props.isCodex)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const initialEffort = useRef(props.reasoningEffort)
  const advancedDirty = Boolean(snapshot && JSON.stringify(settings) !== JSON.stringify(snapshot.settings))
  const dirty = advancedDirty || effort !== initialEffort.current
  const disabled = loading || saving || props.busy || Boolean(snapshot?.busy) || !snapshot

  const request = async (method: 'chat.codex.settings.get' | 'chat.codex.settings.set', value?: CodexConversationSettings) => {
    let phase: 'identity' | 'promote' | 'request' = 'identity'
    try {
    if (!props.daemonInstallationId) throw new Error('codex_settings_unavailable')
    // A new mobile conversation is a local draft until explicitly promoted.
    // Settings must be saved before the first native thread locks CODEX_HOME.
    phase = 'promote'
    await ensureLocalSession(props.sessionId)
    phase = 'request'
    const result = await props.send({ type: 'req', method, params: {
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: props.daemonInstallationId, sessionId: props.sessionId,
      ...(value ? { settings: value } : {}),
    } } as never)
    if (!result.ok) throw new Error(result.error || 'codex_settings_unavailable')
    const payload = result.payload as CodexConversationSettingsSnapshot | undefined
    if (!payload?.settings || typeof payload.homeLocked !== 'boolean' || typeof payload.busy !== 'boolean') {
      throw new Error('codex_settings_unavailable')
    }
    return payload
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      console.debug('[ConversationSettings] request failed', { phase,
        code: /^[a-z_]{1,60}$/.test(message) ? message : 'request_failed' })
      throw err
    }
  }
  const friendlyError = (value: unknown) => {
    const message = value instanceof Error ? value.message : ''
    return t(message === 'machine_owner_required' ? 'codex_settings_owner_required' : ['codex_home_locked', 'codex_settings_busy', 'codex_home_absolute_required',
      'codex_home_directory_required', 'codex_home_invalid', 'machine_owner_required'].includes(message) ? message : 'codex_settings_unavailable')
  }
  const load = async () => {
    setLoading(true); setError('')
    try {
      const result = await request('chat.codex.settings.get')
      if (alive.current) { setSnapshot(result); setSettings(result.settings) }
    } catch (err) { if (alive.current) setError(friendlyError(err)) }
    finally { if (alive.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true
    if (props.isCodex) void load()
    return () => { alive.current = false }
    // The parent remounts the sheet for each session/open; no background requests.
  }, [])
  const close = () => {
    if (saving) return
    if (!dirty) { props.onClose(); return }
    Alert.alert(t('conversation_settings_discard'), '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('conversation_settings_discard_action'), style: 'destructive', onPress: props.onClose },
    ])
  }
  const save = async () => {
    if (saving || loading || props.busy || snapshot?.busy) return
    Keyboard.dismiss(); setSaving(true); setError('')
    try {
      if (advancedDirty) await request('chat.codex.settings.set', { ...settings, codexHome: settings.codexHome?.trim() || null })
      if (!alive.current) return
      if (effort && effort !== initialEffort.current) props.onReasoningEffort(effort)
      props.onClose()
    } catch (err) { if (alive.current) setError(friendlyError(err)) }
    finally { if (alive.current) setSaving(false) }
  }
  const confirmSave = () => {
    const previous = snapshot?.settings
    const increasesAccess = previous && advancedDirty && (
      (settings.sandbox === 'danger-full-access' && previous.sandbox !== 'danger-full-access') ||
      (settings.sandbox === 'workspace-write' && previous.sandbox === 'read-only') ||
      (settings.approvalPolicy === 'never' && previous.approvalPolicy !== 'never') ||
      (settings.networkAccess && !previous.networkAccess && settings.sandbox === 'workspace-write'))
    if (increasesAccess) Alert.alert(t('conversation_settings_risk_title'), t('conversation_settings_risk'), [
      { text: t('cancel'), style: 'cancel' }, { text: t('save'), onPress: () => { void save() } },
    ])
    else void save()
  }
  const section = (label: string, hint?: string) => <View style={styles.sectionTitle}>
    <Text style={[styles.heading, { color: colors.text }]}>{label}</Text>
    {hint ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text> : null}
  </View>
  const choices = (items: Array<{ id: string; label: string }>, selected: string | undefined,
    select: (id: string) => void, unavailable: boolean, prefix: string) => <View style={[styles.choices, prefix === 'settings-effort' ? styles.effortChoices : styles.optionChoices]}>
    {items.map((item) => <Pressable key={item.id} testID={`${prefix}-${item.id}`} accessibilityRole="radio"
      accessibilityState={{ selected: selected === item.id, disabled: unavailable }} disabled={unavailable}
      onPress={() => select(item.id)} style={[styles.choice, prefix === 'settings-effort' ? styles.effortChoice : styles.optionChoice, { borderColor: selected === item.id ? colors.brand : colors.border,
        backgroundColor: colors.surface, opacity: unavailable ? 0.55 : 1 }]}>
      <Text style={[styles.choiceText, { color: selected === item.id ? colors.brand : colors.text }]}>{item.label}</Text>
      {selected === item.id ? <Text style={{ color: colors.brand }}>✓</Text> : null}
    </Pressable>)}
  </View>
  return <BottomSheet isOpen onClose={close} title={t('conversation_settings_title')}
    headerRight={<Pressable testID="conversation-settings-save" accessibilityRole="button" onPress={confirmSave}
      disabled={!dirty || saving || loading || props.busy || Boolean(snapshot?.busy)} style={styles.headerButton}>
      {saving ? <ActivityIndicator color={colors.brand} /> : <Text style={{ color: dirty ? colors.brand : colors.textTertiary }}>{t('save')}</Text>}
    </Pressable>}>
    {props.reasoningEfforts.length ? <>
      {section(t('reasoning_effort'))}
      {choices(props.reasoningEfforts.map((item) => ({ id: item.id, label: item.name || item.id })), effort,
        setEffort, saving || props.busy, 'settings-effort')}
    </> : null}
    {props.isCodex ? <>
      {error ? <View style={styles.status}>
        <Text testID="conversation-settings-error" accessibilityRole="alert" style={[styles.hint, { color: colors.errorText }]}>{error}</Text>
        {!loading ? <Pressable onPress={() => { void load() }} accessibilityRole="button" style={styles.headerButton}>
          <Text style={{ color: colors.brand }}>{t('retry')}</Text>
        </Pressable> : null}
      </View> : null}
      {section('CODEX_HOME', t(snapshot?.homeLocked ? 'codex_home_locked_hint' : 'codex_home_hint'))}
      <TextInput testID="codex-home-input" accessibilityLabel="CODEX_HOME" value={settings.codexHome ?? ''}
        editable={!disabled && !snapshot?.homeLocked} autoCapitalize="none" autoCorrect={false} spellCheck={false}
        placeholder={t('codex_home_default')} placeholderTextColor={colors.textTertiary}
        onChangeText={(codexHome) => setSettings((value) => ({ ...value, codexHome: codexHome || null }))}
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface,
          opacity: disabled || snapshot?.homeLocked ? 0.55 : 1 }]} />
      {section(t('codex_sandbox'), t(`codex_sandbox_hint_${settings.sandbox}`))}
      {choices(['read-only', 'workspace-write', 'danger-full-access'].map((id) => ({ id, label: t(`codex_sandbox_${id}`) })),
        settings.sandbox, (sandbox) => setSettings((value) => ({ ...value, sandbox: sandbox as CodexConversationSettings['sandbox'] })), disabled, 'settings-sandbox')}
      {settings.sandbox === 'workspace-write' ? <View style={styles.switchRow}>
        <Text style={[styles.choiceText, { color: colors.text, flex: 1 }]}>{t('codex_network_access')}</Text>
        <Switch testID="codex-network-access" accessibilityLabel={t('codex_network_access')} disabled={disabled}
          value={settings.networkAccess} onValueChange={(networkAccess) => setSettings((value) => ({ ...value, networkAccess }))} />
      </View> : null}
      {section(t('codex_approval_policy'), t('codex_approval_hint'))}
      {choices(['on-request', 'never'].map((id) => ({ id, label: t(`codex_approval_${id}`) })), settings.approvalPolicy,
        (approvalPolicy) => setSettings((value) => ({ ...value, approvalPolicy: approvalPolicy as CodexConversationSettings['approvalPolicy'] })), disabled, 'settings-approval')}
      {loading ? <ActivityIndicator testID="codex-settings-loading" color={colors.brand} style={styles.status} /> : null}
      {snapshot?.busy || props.busy ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('codex_settings_busy')}</Text> : null}
      {snapshot?.busy && !loading ? <Pressable onPress={() => { void load() }} accessibilityRole="button" style={styles.headerButton}>
        <Text style={{ color: colors.brand }}>{t(snapshot ? 'refresh' : 'retry')}</Text>
      </Pressable> : null}
      <Text style={[styles.hint, styles.status, { color: colors.textSecondary }]}>{t('codex_settings_scope')}</Text>
    </> : null}
  </BottomSheet>
}

const styles = StyleSheet.create({
  sectionTitle: { gap: 6, marginTop: 22, marginBottom: 10 },
  heading: { ...mobileTypography.body, fontWeight: '600' },
  hint: { ...mobileTypography.metadata, lineHeight: 20 },
  choices: { gap: 8 },
  optionChoices: { flexDirection: 'row' },
  optionChoice: { flex: 1, minHeight: 52, gap: 6, paddingHorizontal: 10 },
  effortChoices: { flexDirection: 'row', flexWrap: 'wrap' },
  effortChoice: { flexGrow: 1, minWidth: 80, gap: 10 },
  choice: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choiceText: { ...mobileTypography.body, flexShrink: 1 },
  input: { ...mobileTypography.body, minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, marginTop: 8 },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  status: { marginVertical: 14 },
})
