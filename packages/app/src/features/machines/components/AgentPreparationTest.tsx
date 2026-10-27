// @arch docs/features/agent-provider-config.md#client-与-skill-的接入检查
// @test src/__tests__/acp-agent-presentation.test.ts
import { useEffect, useRef, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { isAvailableAgentType, type Machine } from '@shennian/wire'
import { DirBrowser } from '../../../components/DirBrowser'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { getMachineAgentModels } from '../../../utils/models'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { agentValidationMessageKey } from '../../agents/agentWorkspaceValidation'
import { testAgentPreparationReply } from '../utils/agentPreparation'
import { LaunchModelSelector } from './LaunchModelSelector'
import { SetupRow, SetupText } from './SetupControls'

export function AgentPreparationTest({ machine, agentType, refreshRevision, refreshing }: {
  machine: Machine; agentType: string; refreshRevision: number; refreshing: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id)
  const [workDir, setWorkDir] = useState('')
  const [modelId, setModelId] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ key: string; error?: string } | null>(null)
  const inFlight = useRef(false)
  const active = useRef(true)
  const key = JSON.stringify([accountId, machine.id, agentType, workDir, modelId, refreshRevision,
    machine.online, machine.role, machine.agents?.find((info) => info.type === agentType)])
  const currentKey = useRef(key)
  currentKey.current = key
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  if (!isAvailableAgentType(agentType)) return null
  const result = outcome?.key === key ? outcome : null
  const run = async () => {
    if (inFlight.current || refreshing) return
    inFlight.current = true
    setBusy(true)
    setOutcome(null)
    try {
      await testAgentPreparationReply(machine, agentType, workDir, modelId,
        (id, method, params, options) => accountRuntime.requestMachine(id, method, params, options))
      if (active.current && currentKey.current === key && useAuthStore.getState().user?.id === accountId)
        setOutcome({ key })
    } catch (error) {
      if (active.current && currentKey.current === key && useAuthStore.getState().user?.id === accountId)
        setOutcome({ key, error: agentValidationMessageKey(error, 'agents_validation_response_failed') })
    } finally {
      inFlight.current = false
      if (active.current) setBusy(false)
    }
  }
  return (
    <View style={{ gap: 12 }} testID="agent-preparation-test">
      <SetupText title>{t('ai_setup_test_title')}</SetupText>
      <SetupText>{t('ai_setup_test_hint')}</SetupText>
      <SetupText>{t('agents_work_directory')}</SetupText>
      <TextInput
        accessibilityLabel={t('agents_work_directory')}
        placeholder={t('agents_start_directory_placeholder')}
        placeholderTextColor={colors.textTertiary}
        value={workDir} onChangeText={setWorkDir} editable={!busy && !refreshing}
        autoCapitalize="none" autoCorrect={false}
        style={{ ...mobileTypography.body, minHeight: 48, padding: 12, borderWidth: 1,
          borderRadius: 10, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }}
      />
      <SetupRow title={t('agents_browse_work_directory')} icon="folder-outline"
        disabled={busy || refreshing} onPress={() => setBrowsing(true)} />
      <SetupText>{t('model')}</SetupText>
      <LaunchModelSelector agentType={agentType} models={getMachineAgentModels(machine, agentType)}
        selectedModel={modelId} onSelectModel={setModelId} allowDefaultSelection
        defaultOptionLabel={t('agents_default_model')} disabled={busy || refreshing} />
      <SetupRow title={t(busy ? 'ai_setup_test_running' : 'ai_setup_test_action')}
        icon="chatbubble-outline" onPress={() => void run()}
        disabled={busy || refreshing || !workDir.trim() || !machine.online || machine.role === 'granted'} />
      {result ? <Text accessibilityRole="alert" style={{ ...mobileTypography.body,
        color: result.error ? colors.errorText : colors.text }}>{t(result.error ?? 'ai_setup_test_passed')}</Text> : null}
      {result?.error ? <SetupText>{t('ai_setup_test_failed_hint')}</SetupText> : null}
      {browsing ? <DirBrowser machineId={machine.id} initialPath={workDir} mode="workDirPicker"
        onSelect={setWorkDir} onClose={() => setBrowsing(false)} /> : null}
    </View>
  )
}
