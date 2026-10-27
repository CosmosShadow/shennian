// @arch docs/features/conversation-schedules.md
import { useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { randomUUID } from 'expo-crypto'
import { ScheduleExecutionChoice } from './ScheduleExecutionChoice'
import BottomSheet from '../../components/BottomSheet'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { scheduleClient } from './scheduleClient'

export function ScheduleCreateForm({
  machines,
  initialMachineId,
  onClose,
  onCreated,
}: {
  machines: { id: string; name: string }[]
  initialMachineId?: string
  onClose: () => void
  onCreated: (machineId: string) => void
}) {
  const { t } = useTranslation(),
    { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id)
  const [machineId, setMachineId] = useState(initialMachineId ?? machines[0]?.id ?? '')
  const [prompt, setPrompt] = useState(''),
    [timeDescription, setTimeDescription] = useState('')
  const [executionMode, setExecutionMode] = useState<'main' | 'worker'>('worker')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const sending = useRef(false)
  const operation = useRef<{ signature: string; id: string } | null>(null)
  const valid =
    !!accountId &&
    machines.some((item) => item.id === machineId) &&
    !!prompt.trim() &&
    !!timeDescription.trim() &&
    !!timezone.trim()
  async function save() {
    if (!valid || sending.current) return
    const input = {
      prompt: prompt.trim(), executionMode,
      timeDescription: timeDescription.trim(),
      timezone: timezone.trim(),
    }
    const signature = JSON.stringify([machineId, input])
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: randomUUID() }
    sending.current = true
    setBusy(true)
    setError('')
    try {
      await scheduleClient.create(machineId, { ...input, operationId: operation.current.id })
      if (useAuthStore.getState().user?.id === accountId) onCreated(machineId)
    } catch (failure) {
      if (useAuthStore.getState().user?.id === accountId) {
        setError(
          failure instanceof Error && failure.message.includes('schedule_builtin_session_required')
            ? 'schedules_initialize_agent'
            : 'schedules_failed',
        )
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  const inputStyle = {
    minHeight: 48,
    padding: 12,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 8,
  }
  return (
    <BottomSheet
      isOpen
      onClose={() => {
        if (!busy) onClose()
      }}
      title={t('schedules_add')}
      headerLeft={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('save')}
          disabled={!valid || busy}
          onPress={() => void save()}
          style={{ padding: 12, opacity: !valid || busy ? 0.4 : 1 }}
        >
          <Text style={{ color: colors.brand }}>{t('save')}</Text>
        </Pressable>
      }
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 12 }}
      >
        {error ? (
          <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
            {t(error)}
          </Text>
        ) : null}
        <Text style={{ color: colors.text }}>{t('schedules_computer')}</Text>
        {machines.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="radio"
            accessibilityLabel={item.name}
            accessibilityState={{ checked: item.id === machineId }}
            disabled={busy}
            onPress={() => setMachineId(item.id)}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: item.id === machineId ? colors.brand : colors.text }}>
              {item.id === machineId ? '✓ ' : ''}
              {item.name}
            </Text>
          </Pressable>
        ))}
        {!machines.length ? (
          <Text style={{ color: colors.textSecondary }}>{t('schedules_no_machines')}</Text>
        ) : null}
        <ScheduleExecutionChoice value={executionMode} onChange={setExecutionMode} disabled={busy} />
        <Text style={{ color: colors.text }}>{t('schedules_time')}</Text>
        <TextInput
          accessibilityLabel={t('schedules_time')}
          editable={!busy}
          value={timeDescription}
          onChangeText={setTimeDescription}
          placeholder={t('schedules_time_example')}
          placeholderTextColor={colors.textSecondary}
          style={inputStyle}
        />
        <Text style={{ color: colors.text }}>{t('schedules_timezone')}</Text>
        <TextInput
          accessibilityLabel={t('schedules_timezone')}
          editable={!busy}
          autoCapitalize="none"
          value={timezone}
          onChangeText={setTimezone}
          style={inputStyle}
        />
        <Text style={{ color: colors.text }}>{t('schedules_work')}</Text>
        <TextInput
          accessibilityLabel={t('schedules_work')}
          editable={!busy}
          multiline
          value={prompt}
          onChangeText={setPrompt}
          placeholder={t('schedules_work_example')}
          placeholderTextColor={colors.textSecondary}
          style={[inputStyle, { minHeight: 100, textAlignVertical: 'top' }]}
        />
        <View>
          <Text style={{ color: colors.textSecondary }}>{t('schedules_machine_hint')}</Text>
        </View>
      </ScrollView>
    </BottomSheet>
  )
}
