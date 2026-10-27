// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/personal-worker-settings.test.ts
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChoiceChip } from '../../../components/ChoiceChip'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { usePrimaryMachine } from '../../personal-workspace/usePrimaryMachine'
import { personalWorkerClient, type PersonalWorkerSummary } from '../personalWorkerClient'

export function PersonalWorkerSettings() {
  const { t } = useTranslation(), { colors } = useTheme(), primary = usePrimaryMachine()
  const accountId = useAuthStore(s => s.user?.id), generation = useRef(0)
  const [custom, setCustom] = useState(false)
  const [value, setValue] = useState<PersonalWorkerSummary>()
  const [agent, setAgent] = useState<string | null>(null), [model, setModel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string>()
  const revision = primary.record?.revision, machineId = primary.record?.machine?.id
  useEffect(() => {
    const current = ++generation.current
    setValue(undefined); setAgent(null); setModel(null); setMessage(undefined); setBusy(false)
    if (!accountId || !machineId || revision === undefined) return
    setBusy(true)
    void personalWorkerClient.read(revision).then(result => {
      if (current !== generation.current || useAuthStore.getState().user?.id !== accountId) return
      if (!Array.isArray(result.agents) || !result.defaultWorkDir) throw new Error('upgrade_required')
      setValue(result); setAgent(result.agentType ?? 'shennian'); setModel(result.modelId); setCustom(!!result.agentType && result.agentType !== 'shennian')
    }).catch(() => { if (current === generation.current) setMessage('personal_worker_unavailable') })
      .finally(() => { if (current === generation.current) setBusy(false) })
    return () => { generation.current++ }
  }, [accountId, machineId, revision])
  const save = async () => {
    if (busy || !value || revision === undefined) return
    const current = generation.current
    setBusy(true); setMessage(undefined)
    try {
      const result = await personalWorkerClient.save(revision, { agentType: custom ? agent : 'shennian', modelId: custom ? model : null, workDir: null })
      if (current === generation.current && useAuthStore.getState().user?.id === accountId) { setValue({ ...value, ...result }); setMessage('personal_worker_saved') }
    } catch { if (current === generation.current) setMessage('personal_worker_unavailable') }
    finally { if (current === generation.current) setBusy(false) }
  }
  const models = value?.agents.find(a => a.type === agent)?.models ?? []
  const choose = (id: string | null) => { setAgent(id); setModel(null); setMessage(undefined) }
  const unavailable = busy || !value || (custom && !agent)
  const alternatives = value?.agents.filter(a => a.type !== 'shennian') ?? []
  return <View testID="personal-worker-settings" style={styles.root}>
    <View style={styles.details}>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('personal_worker_role')}</Text>
      <View style={styles.choices}>
        <ChoiceChip testID="personal-worker-official" selected={!custom} disabled={busy || !value} label={t('personal_worker_official')} onPress={() => { setCustom(false); choose('shennian') }} />
        <ChoiceChip testID="personal-worker-custom" selected={custom} disabled={busy || !value} label={t('personal_worker_custom')} onPress={() => { setCustom(true); choose(alternatives[0]?.type ?? null) }} />
      </View>
      {custom ? <View style={styles.choices}>
        {alternatives.map(a => <ChoiceChip key={a.type} testID={`personal-worker-${a.type}`} selected={agent === a.type} disabled={busy} label={a.type} onPress={() => choose(a.type)} />)}
        {agent ? <ChoiceChip selected={!model} disabled={busy || !value} label={t('personal_worker_default_model')} onPress={() => setModel(null)} /> : null}
        {models.map(m => <ChoiceChip key={m.id} selected={model === m.id} disabled={busy} label={m.name || m.id} onPress={() => setModel(m.id)} />)}
      </View> : null}
      {custom && agent && value && !value.agents.some(a => a.type === agent) ? <Text style={{ color: colors.error }}>{t('personal_worker_missing', { agent })}</Text> : null}
      {busy ? <ActivityIndicator color={colors.textSecondary} /> : null}
      {message ? <Text testID="personal-worker-result" style={{ color: message === 'personal_worker_saved' ? colors.brand : colors.error }}>{t(message)}</Text> : null}
      <Pressable testID="personal-worker-save" accessibilityRole="button" disabled={unavailable} onPress={() => void save()} style={[styles.save, { backgroundColor: colors.brand, opacity: unavailable ? 0.4 : 1 }]}>
        <Text style={{ color: '#fff' }}>{t('personal_model_save')}</Text>
      </Pressable>
    </View>
  </View>
}

const styles = StyleSheet.create({ root: { paddingVertical: 20 }, details: { gap: 12, paddingTop: 12 }, hint: { ...mobileTypography.metadata, lineHeight: 20 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, save: { alignItems: 'center', padding: 14, borderRadius: 10 } })
