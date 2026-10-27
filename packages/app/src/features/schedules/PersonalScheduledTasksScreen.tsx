// @arch docs/features/conversation-schedules.md
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { AppPageHeader, HeaderIconButton } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { machineAccountClient } from '../machines/machineAccountClient'
import { useContextualSteward, useContextualStewardDraft } from '../steward/ContextualStewardContext'
import { StewardScreen } from '../steward/StewardScreen'
import { ConversationSchedules } from './ConversationSchedules'
import { scheduleClient } from './scheduleClient'

export default function PersonalScheduledTasksScreen() {
  const router = useRouter(),
    { t } = useTranslation(),
    { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id)
  const machines = useMachinesStore((state) => state.machines)
  const contextual = useContextualSteward()
  const localComposer = useContextualStewardDraft(accountId ?? '')
  const composer = contextual ?? localComposer
  const [readyAccount, setReadyAccount] = useState<string>()
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0),
    [revision, setRevision] = useState(0)
  useFocusEffect(
    useCallback(() => {
      let live = true
      setLoading(true)
      setError('')
      setReadyAccount(undefined)
      const current = () => live && useAuthStore.getState().user?.id === accountId
      if (!accountId) {
        setLoading(false)
        return () => {
          live = false
        }
      }
      void Promise.allSettled([
        machineAccountClient.listMachines(),
        scheduleClient.ensureDefaultDiary(Intl.DateTimeFormat().resolvedOptions().timeZone),
      ]).then(([list, seed]) => {
        if (!current()) return
        if (list.status === 'fulfilled') {
          useMachinesStore.getState().setMachines(list.value)
          setReadyAccount(accountId)
        }
        const failure =
          seed.status === 'rejected' ? seed.reason : list.status === 'rejected' ? list.reason : null
        if (failure) {
          const text = failure instanceof Error ? failure.message : ''
          setError(
            text.includes('schedule_builtin_session_required')
              ? 'schedules_initialize_agent'
              : text.includes('personal_primary_not_configured')
                ? 'personal_primary_not_configured'
                : 'schedules_failed',
          )
        }
        setLoading(false)
        setRevision((value) => value + 1)
      })
      return () => {
        live = false
      }
    }, [accountId, attempt]),
  )
  const available = readyAccount === accountId && accountId ? machines : []
  const header = (
    <AppPageHeader
        title={t('schedules_title')}
        onBack={() => router.back()}
        trailing={
          <HeaderIconButton
            icon="add"
            label={t('schedules_add')}
            onPress={() => composer.draft(t('inspiration_ai_schedule_prompt'))}
          />
        }
      />
  )
  const content = (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {error ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((value) => value + 1)}
            style={{ paddingVertical: 16 }}
          >
            <Text style={{ color: colors.errorText }}>
              {t(error)} · {t('retry')}
            </Text>
          </Pressable>
        ) : null}
        {loading ? (
          <ActivityIndicator color={colors.textSecondary} />
        ) : accountId ? (
          <ConversationSchedules
            key={`${accountId}:${revision}`}
            stewardAllMachines
            personalPresentation
            alwaysShow
            showHeading={false}
            machineNames={Object.fromEntries(
              available.map((machine) => [machine.id, machine.name]),
            )}
          />
        ) : null}
      </ScrollView>
  )
  return contextual ? (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {header}
      {content}
    </SafeAreaView>
  ) : (
    <StewardScreen moduleHeader={header} moduleContent={content} composerDraft={localComposer.request} />
  )
}
