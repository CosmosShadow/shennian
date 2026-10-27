// @arch docs/features/agent-provider-config.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, BackHandler, Linking, Platform, ScrollView, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@shennian/wire'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { useTheme } from '../../../hooks/useTheme'
import { getServerUrl } from '../../../config/server'
import { SetupCopy, SetupRow, SetupText } from './SetupControls'
import { getAgentPreparationLinks, getAgentPreparationState, needsWindowsCodexHint } from '../utils/agentPreparation'
import { AgentPreparationTest } from './AgentPreparationTest'

export function AgentPreparationGuide({
  machine,
  agentType,
  name,
  onBack,
  onRefresh,
}: {
  machine: Machine
  agentType: string
  name: string
  onBack: () => void
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const waitingForReturn = useRef(false)
  const inFlight = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const type = agentType.replace(/^builtin:/, '').replace(/^catalog:/, 'acp:')
  const info = machine.agents?.find((agent) => agent.type === type)
  const state = getAgentPreparationState(machine, type, info)
  const guide = getAgentPreparationLinks(type)
  const installUrl = guide?.install ?? `${getServerUrl().replace(/\/+$/, '')}/#agents`
  const loginUrl = guide?.login ?? `${getServerUrl().replace(/\/+$/, '')}/docs#ai-setup`
  const check = useCallback(async () => {
    if (inFlight.current || !machine.online || machine.role === 'granted') return
    inFlight.current = true
    setChecking(true)
    setError(false)
    try {
      await onRefresh()
      if (active.current) setRefreshRevision((value) => value + 1)
    } catch {
      if (active.current) setError(true)
    } finally {
      inFlight.current = false
      if (active.current) setChecking(false)
    }
  }, [machine.online, machine.role, onRefresh])
  useEffect(() => {
    const resume = () => {
      if (waitingForReturn.current) {
        waitingForReturn.current = false
        void check()
      }
    }
    const app = AppState.addEventListener('change', (value) => {
      if (value === 'active') resume()
    })
    const visible = () => {
      if (document.visibilityState === 'visible') resume()
    }
    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', visible)
      window.addEventListener('focus', resume)
    }
    return () => {
      app.remove()
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', visible)
        window.removeEventListener('focus', resume)
      }
    }
  }, [check])
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack()
      return true
    })
    return () => back.remove()
  }, [onBack])
  const open = (url: string) => {
    waitingForReturn.current = true
    void Linking.openURL(url).catch(() => {
      waitingForReturn.current = false
      setError(true)
    })
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="agent-preparation-guide">
      <AppPageHeader title={name} onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: 40,
          gap: 20,
          width: '100%',
          maxWidth: 760,
          alignSelf: 'center',
        }}
      >
        <SetupText title>{t(checking ? 'ai_setup_checking' : `ai_setup_state_${state}`)}</SetupText>
        <SetupText>{t('ai_setup_target', { name: machine.name, os: machine.os })}</SetupText>
        {info?.runtime?.cliVersion ? (
          <SetupText>{t('ai_setup_tool_version', { version: info.runtime.cliVersion })}</SetupText>
        ) : null}
        <SetupText>{t(`ai_setup_help_${state}`)}</SetupText>
        {state !== 'owner' && state !== 'offline' ? (
          <>
            <SetupText title>{t('ai_setup_step_install')}</SetupText>
            <SetupText>
              {t(/win/i.test(machine.os) ? 'ai_setup_windows' : 'ai_setup_unix')}
            </SetupText>
            {needsWindowsCodexHint(machine.os, type, state) ? (
              <>
                <SetupText>{t('ai_setup_codex_windows')}</SetupText>
                <SetupText>{t('ai_setup_codex_wsl')}</SetupText>
              </>
            ) : null}
            <SetupRow
              title={t('ai_setup_official_install', { agent: name })}
              icon="open-outline"
              onPress={() => open(installUrl)}
            />
            <SetupText title>{t('ai_setup_step_login')}</SetupText>
            <SetupText>{t('ai_setup_login_hint', { agent: name })}</SetupText>
            {guide?.command ? <SetupCopy value={guide.command} label={t('copy')} /> : null}
            <SetupRow
              title={t('ai_setup_official_login')}
              icon="open-outline"
              onPress={() => open(loginUrl)}
            />
            <SetupText>{t('ai_setup_account_limits')}</SetupText>
            <SetupRow
              title={t(checking ? 'ai_setup_checking' : 'ai_setup_check_again')}
              icon="refresh"
              disabled={checking}
              onPress={() => void check()}
            />
            <SetupText>{t('ai_setup_first_task')}</SetupText>
            {state !== 'missing' && state !== 'version' ? (
              <AgentPreparationTest key={`${machine.id}:${type}`} machine={machine} agentType={type}
                refreshRevision={refreshRevision} refreshing={checking} />
            ) : null}
            <SetupText title>{t('ai_setup_optional_ai')}</SetupText>
            <SetupText>{t('ai_setup_optional_hint')}</SetupText>
            <SetupCopy
              label={t('ai_setup_copy_prompt')}
              collapsible
              value={t('ai_setup_prompt', {
                agent: name,
                machine: machine.name,
                os: machine.os,
                install: installUrl,
                login: loginUrl,
                type,
              })}
            />
          </>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
            {t('ai_setup_check_failed')}
          </Text>
        ) : null}
        <SetupRow title={t('ai_setup_continue')} onPress={onBack} />
      </ScrollView>
    </View>
  )
}
