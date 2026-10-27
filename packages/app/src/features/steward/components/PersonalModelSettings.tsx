// @arch docs/features/builtin-personal-agent.md
// @test src/__tests__/steward-navigation.test.ts
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChoiceChip } from '../../../components/ChoiceChip'
import { personalModelProviders, personalModelProvider, normalizedModelUrl } from '../personalModelProviders'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { usePrimaryMachine } from '../../personal-workspace/usePrimaryMachine'
import { personalModelClient, type PersonalModelSummary } from '../personalModelClient'
import { PersonalModelAllowance } from './PersonalModelAllowance'
export function PersonalModelSettings() {
  const { t } = useTranslation(), { colors } = useTheme(), primary = usePrimaryMachine()
  const accountId = useAuthStore(s => s.user?.id)
  const [mode, setMode] = useState<'official' | 'custom'>('official')
  const [summary, setSummary] = useState<PersonalModelSummary>()
  const [baseUrl, setBaseUrl] = useState(''), [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState('aliyun')
  const [officialModel, setOfficialModel] = useState('DeepSeek V4.1 Flash')
  const [contextWindow, setContextWindow] = useState('1000000')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string>()
  const revision = primary.record?.revision, machineId = primary.record?.machine?.id
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setApiKey(''); setSummary(undefined); setMessage(undefined); setMode('official'); setBaseUrl(''); setProvider('aliyun'); setContextWindow('1000000')
    if (revision === undefined || !machineId || !accountId) { setBusy(false); return }
    setBusy(true)
    void personalModelClient.read(revision).then(value => {
      if (current !== generation.current || useAuthStore.getState().user?.id !== accountId) return
      setSummary(value); setMode(value.mode)
      if (value.mode === 'official') setOfficialModel(value.model === 'deepseek-v4.1-flash-1017' ? 'DeepSeek V4.1 Flash' : value.model)
      setBaseUrl(value.baseUrl || personalModelProviders[0].baseUrl)
      setProvider(value.baseUrl ? personalModelProvider(value.baseUrl) : 'aliyun')
      setContextWindow(String(value.mode === 'custom' ? value.contextWindow : 1000000))
    }).catch(() => { if (current === generation.current) setMessage('personal_model_unavailable') })
      .finally(() => { if (current === generation.current) setBusy(false) })
    return () => { generation.current++ }
  }, [accountId, revision, machineId])
  const save = async () => {
    if (revision === undefined || busy || !summary) return
    const current = generation.current
    if (mode === 'custom' && (!baseUrl.trim() || (!apiKey.trim() && !canKeepKey) || !Number.isSafeInteger(Number(contextWindow)) || Number(contextWindow) < 8192 || Number(contextWindow) > 2000000)) { setMessage('personal_model_invalid'); return }
    setBusy(true); setMessage(undefined)
    try {
      const value = await personalModelClient.save(revision, mode === 'official' ? { mode } : { mode, baseUrl: baseUrl.trim(), contextWindow: Number(contextWindow), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
      if (current === generation.current && useAuthStore.getState().user?.id === accountId) { setSummary(value); if (value.mode === 'official') setOfficialModel(value.model === 'deepseek-v4.1-flash-1017' ? 'DeepSeek V4.1 Flash' : value.model); setMessage('personal_model_saved') }
    } catch { if (current === generation.current) setMessage('personal_model_unavailable') }
    finally { if (current === generation.current) { setApiKey(''); setBusy(false) } }
  }
  const canKeepKey = summary?.hasApiKey && normalizedModelUrl(baseUrl) === normalizedModelUrl(summary.baseUrl)
  const field = (key: string, label: string, value: string, change: (value: string) => void, secret = false) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput testID={`personal-model-${key}`} accessibilityLabel={label} value={value} onChangeText={change}
        secureTextEntry={secret} keyboardType={key === 'context' ? 'number-pad' : key === 'url' ? 'url' : 'default'} autoCapitalize="none" autoCorrect={false} editable={!busy}
        placeholder={secret && canKeepKey ? t('personal_model_key_unchanged') : undefined}
        placeholderTextColor={colors.textMuted} style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
    </View>
  )
  return <View testID="personal-model-settings" style={styles.root}>
    <View style={styles.choices}>{(['official', 'custom'] as const).map(value => <ChoiceChip key={value} testID={`personal-model-mode-${value}`} selected={mode === value} disabled={busy || !summary} onPress={() => { setMode(value); setApiKey(''); setMessage(undefined) }}
      label={value === 'official' ? t('personal_model_official', { model: officialModel }) : t('personal_model_custom')} />)}</View>
    <PersonalModelAllowance mode={mode} />
    {mode === 'custom' ? <>
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t('personal_model_provider')}</Text>
        <View style={styles.choices}>{personalModelProviders.map(p => <ChoiceChip key={p.id} testID={`personal-model-provider-${p.id}`} selected={provider === p.id} disabled={busy || !summary} label={t(p.label)} onPress={() => { setProvider(p.id); setBaseUrl(p.baseUrl); setApiKey(''); setMessage(undefined) }} />)}</View>
      </View>
      {field('url', 'Base URL', baseUrl, value => { setBaseUrl(value); setProvider(personalModelProvider(value)); setApiKey(''); setMessage(undefined) })}
      {field('key', 'API Key', apiKey, setApiKey, true)}
      {field('context', t('personal_model_context'), contextWindow, setContextWindow)}
    </> : null}
    {busy ? <ActivityIndicator color={colors.textSecondary} /> : null}
    {message ? <Text testID="personal-model-result" style={[styles.hint, { color: message === 'personal_model_saved' ? colors.brand : colors.error }]}>{t(message)}</Text> : null}
    {!machineId && !primary.loading ? <Text style={{ color: colors.textSecondary }}>{t('personal_primary_not_configured')}</Text> : null}
    <Pressable testID="personal-model-save" accessibilityRole="button" disabled={busy || !summary || !machineId} onPress={() => void save()} style={[styles.save, { backgroundColor: colors.brand, opacity: busy || !summary ? 0.4 : 1 }]}>
      <Text style={{ color: '#fff' }}>{t('personal_model_save')}</Text>
    </Pressable>
  </View>
}
const styles = StyleSheet.create({ root: { paddingVertical: 20, gap: 16 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, hint: { ...mobileTypography.metadata, lineHeight: 20 }, field: { gap: 8 }, label: { ...mobileTypography.metadata }, input: { ...mobileTypography.body, borderWidth: 1, borderRadius: 8, padding: 12 }, save: { alignItems: 'center', padding: 14, borderRadius: 10 } })
