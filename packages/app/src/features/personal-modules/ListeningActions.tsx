// @arch docs/features/listening.md
// @test src/__tests__/listening-controls.test.ts
import { useEffect, useRef, useState } from 'react'
import { AppState, Pressable, Text, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { authApi } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { useContextualSteward } from '../steward/ContextualStewardContext'
import type { ListeningAction } from './types'
export function ListeningActions({
  revision,
  active,
  day,
  preview,
  openDay,
}: {
  revision: number
  active: boolean
  day?: string
  preview?: boolean
  openDay?: (day?: string) => void
}) {
  const { t } = useTranslation(),
    { colors } = useTheme(),
    steward = useContextualSteward()
  const account = useAuthStore((s) => s.user?.id),
    focused = useIsFocused()
  const [items, setItems] = useState<ListeningAction[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false)
  const [itemsAccount, setItemsAccount] = useState(account)
  const [prepared, setPrepared] = useState<string | null>(null),
    epoch = useRef(0)
  useEffect(() => {
    if (!account || !focused) return
    const generation = ++epoch.current
    let loading = false
    const refresh = async () => {
      if (loading || AppState.currentState !== 'active') return
      loading = true
      try {
        const result = await authApi<{ items: ListeningAction[] }>(
          '/personal-modules/recording/actions',
        )
        if (epoch.current === generation && useAuthStore.getState().user?.id === account) {
          setItems(result.items)
          setItemsAccount(account)
          setError(false)
        }
      } catch {
        if (epoch.current === generation) setError(true)
      } finally {
        loading = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), active ? 5000 : 15000)
    return () => {
      epoch.current++
      clearInterval(timer)
    }
  }, [account, focused, active, revision])
  const act = async (item: ListeningAction, confirm: boolean) => {
    setBusy(true)
    setError(false)
    try {
      const result = await authApi<{ draft?: string }>(
        '/personal-modules/recording/actions/' + item.key + (confirm ? '/confirm' : '/dismiss'),
        { method: 'POST', body: '{}' },
      )
      if (useAuthStore.getState().user?.id !== account) return
      if (result.draft) {
        if (!steward) throw new Error('composer_unavailable')
        steward.draft(result.draft)
        setPrepared(item.key)
      } else setItems((previous) => previous.filter((row) => row.key !== item.key))
    } catch {
      if (useAuthStore.getState().user?.id === account) setError(true)
    } finally {
      setBusy(false)
    }
  }
  const button = (text: string, onPress: () => void, disabled = busy) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 12,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: colors.brand }}>{text}</Text>
    </Pressable>
  )
  const visible = (itemsAccount === account ? items : []).filter((item) => !day || item.day === day)
  if (preview)
    return visible.length ? (
      <Pressable
        accessibilityRole="button"
        onPress={() => openDay?.(visible[0]?.day)}
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: colors.text }}>
          {t('listening_actions')} · {visible.length}
        </Text>
        <Text style={{ color: colors.textSecondary }}>›</Text>
      </Pressable>
    ) : null
  if (!error && !visible.length) return null
  return (
    <View style={{ marginVertical: 12, gap: 10 }}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
        {t('listening_actions')}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
          {t('listening_actions_error')}
        </Text>
      ) : null}
      {visible.map((item) => (
        <View
          key={item.key}
          style={{ backgroundColor: colors.surface, padding: 14, borderRadius: 14, gap: 8 }}
        >
          <Text style={{ color: colors.textSecondary }}>
            {t(`listening_action_${item.payload.type}`)}
          </Text>
          <Text style={{ color: colors.text }}>{item.payload.content}</Text>
          {item.payload.eventTime ? (
            <Text style={{ color: colors.text }}>
              {new Date(item.payload.eventTime).toLocaleString()}
            </Text>
          ) : null}
          {item.payload.targetContent ? (
            <Text style={{ color: colors.text }}>
              {t('listening_target')}: {item.payload.targetContent} · {item.payload.targetWhen}
            </Text>
          ) : null}
          <Text selectable style={{ color: colors.textSecondary }}>
            {t('listening_source')}: {item.payload.sourceText}
          </Text>
          {prepared === item.key ? (
            <Text style={{ color: colors.textSecondary }}>{t('listening_draft_ready')}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {button(
              t(
                item.payload.type === 'agent_task'
                  ? 'listening_prepare_task'
                  : 'listening_confirm_action',
              ),
              () => void act(item, true),
              busy || (item.payload.type === 'agent_task' && (!steward || prepared === item.key)),
            )}
            {button(t('personal_dismiss'), () => void act(item, false))}
          </View>
        </View>
      ))}
    </View>
  )
}
