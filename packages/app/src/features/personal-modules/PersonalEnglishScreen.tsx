// @arch docs/features/english-learning.md
// @test src/__tests__/english-screen.test.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useIsFocused } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AppPageHeader, HeaderIconButton } from '../../components/AppPageHeader'
import { useMobileModuleBack } from '../../components/useMobileModuleBack'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { useAuthStore } from '../../config/auth'
import { authApi } from '../../config/api'
import { useContextualSteward } from '../steward/ContextualStewardContext'
import { clearEnglishFeedback, moduleStore, useRecordingState } from './runtime'
import type { EnglishItem } from './types'
import { rememberEnglishPreference } from './englishPreference'

type Snapshot = { words: EnglishItem[]; enabled: boolean; intervalMinutes: number }
const base = '/personal-modules/english'
export default function PersonalEnglishScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const back = useMobileModuleBack()
  const steward = useContextualSteward()
  useEffect(() => {
    steward?.setDetails((previous) => ({ ...previous, tab: 'english' }))
  }, [steward?.setDetails])
  const focused = useIsFocused()
  const userId = useAuthStore((s) => s.user?.id)
  const recordingRevision = useRecordingState().revision
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [page, setPage] = useState<'list' | 'settings' | 'add'>('list')
  const [selected, setSelected] = useState<string | null>(null)
  const [word, setWord] = useState('')
  const [interval, setIntervalMinutes] = useState('5')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState(false)
  const epoch = useRef(0)
  const load = useCallback(
    async (quiet = false) => {
      if (!userId || !focused) return
      const current = ++epoch.current
      const live = () => current === epoch.current && useAuthStore.getState().user?.id === userId
      if (!quiet) setLoading(true)
      try {
        const store = await moduleStore()
        const cached =
          (await store.cached<Snapshot>('english-overview')) ??
          (await store.cached<Snapshot>('overview'))
        if (!live()) return
        if (cached) setSnapshot((previous) => previous ?? cached)
        const [items, preferences] = await Promise.all([
          authApi<{ items: EnglishItem[] }>(`${base}/items`),
          authApi<{ enabled: boolean; intervalMinutes: number }>(`${base}/preferences`),
        ])
        if (!live()) return
        const next = { words: items.items, ...preferences }
        setSnapshot(next)
        rememberEnglishPreference(userId, preferences.enabled)
        await store.cache('english-enabled', preferences.enabled)
        if (!live()) return
        setOffline(false)
        await store.cache('english-overview', next)
      } catch {
        if (live()) setOffline(true)
      } finally {
        if (live()) setLoading(false)
      }
    },
    [focused, userId],
  )
  useEffect(() => {
    setSnapshot(null)
    setSelected(null)
    setPage('list')
  }, [userId])
  useEffect(() => {
    if (!focused) return
    void load()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load()
    })
    // Lightweight vocabulary/preferences only; no transcript download or model call.
    const timer = setInterval(() => void load(true), 30000)
    return () => {
      epoch.current++
      subscription.remove()
      clearInterval(timer)
    }
  }, [load])
  useEffect(() => {
    if (!focused) return
    const timer = setTimeout(() => void load(true), 1000)
    return () => clearTimeout(timer)
  }, [recordingRevision, focused, load])
  const action = async (work: () => Promise<unknown>) => {
    const owner = userId
    setBusy(true)
    setError(false)
    try {
      await work()
      if (useAuthStore.getState().user?.id !== owner) return
      await load()
    } catch {
      if (useAuthStore.getState().user?.id === owner) setError(true)
    } finally {
      setBusy(false)
    }
  }
  const button = (label: string, run: () => void, disabled = busy) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={run}
      style={{ minHeight: 48, paddingVertical: 14, opacity: disabled ? 0.4 : 1 }}
    >
      <Text style={{ ...mobileTypography.body, color: colors.brand }}>{label}</Text>
    </Pressable>
  )
  const words = snapshot?.words ?? []
  const item = words.find((value) => value.word === selected)
  const detail = !!selected
  const mastered = words.filter((value) => value.state === 'mastered').length
  const fieldStyle = {
    ...mobileTypography.body,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginVertical: 12,
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <AppPageHeader
        title={t(
          page === 'settings'
            ? 'personal_english_settings'
            : page === 'add'
              ? 'personal_add_word'
              : 'personal_entry_english',
        )}
        onBack={
          page !== 'list' || detail
            ? () => {
                setPage('list')
                setSelected(null)
              }
            : back
        }
        trailing={
          page === 'list' && !detail ? (
            <HeaderIconButton
              icon="ellipsis-horizontal"
              label={t('personal_english_settings')}
              onPress={() => {
                setIntervalMinutes(String(snapshot?.intervalMinutes ?? 5))
                setPage('settings')
              }}
            />
          ) : undefined
        }
      />
      {offline ? (
        <Pressable accessibilityRole="button" onPress={() => void load()} style={{ padding: 16 }}>
          <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>
            {t('personal_english_offline')}
          </Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ padding: 16, color: colors.errorText }}>
          {t('personal_action_failed')}
        </Text>
      ) : null}
      {page === 'list' && !detail ? (
        <>
          {snapshot ? (
            <View
              style={{
                paddingHorizontal: 24,
                paddingVertical: 14,
                backgroundColor: colors.surfaceHover,
              }}
            >
              <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>
                {t('personal_english_progress', { mastered, learning: words.length - mastered })}
              </Text>
            </View>
          ) : null}
          {loading && !snapshot ? (
            <ActivityIndicator
              accessibilityLabel={t('personal_english_loading')}
              style={{ margin: 24 }}
            />
          ) : null}
          <FlatList
            data={words}
            keyExtractor={(value) => value.word}
            refreshControl={
              <RefreshControl refreshing={loading && !!snapshot} onRefresh={() => void load()} />
            }
            ListEmptyComponent={
              !loading ? (
                <Text
                  style={{ ...mobileTypography.body, padding: 24, color: colors.textSecondary }}
                >
                  {t(offline ? 'personal_offline' : 'personal_english_empty')}
                </Text>
              ) : null
            }
            renderItem={({ item: value, index }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${value.word}, ${t(`personal_word_${value.state}`)}`}
                onPress={() => setSelected(value.word)}
                style={{
                  minHeight: 60,
                  paddingVertical: 16,
                  paddingHorizontal: 24,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  backgroundColor: index % 2 ? colors.surfaceHover : colors.bg,
                }}
              >
                <Text
                  style={{
                    ...mobileTypography.body,
                    fontSize: 20,
                    lineHeight: 28,
                    flex: 1,
                    color: colors.text,
                  }}
                >
                  {value.word}
                </Text>
                <Ionicons
                  name={
                    value.state === 'mastered'
                      ? 'checkmark-circle'
                      : value.state === 'partial'
                        ? 'pie-chart-outline'
                        : 'ellipse-outline'
                  }
                  size={26}
                  color={
                    value.state === 'mastered'
                      ? colors.successText
                      : value.state === 'partial'
                        ? colors.warningText
                        : colors.textSecondary
                  }
                />
              </Pressable>
            )}
          />
        </>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24 }}>
          {page === 'settings' ? (
            <>
              {button(t('personal_add_word'), () => setPage('add'))}
              <View
                style={{
                  minHeight: 56,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ ...mobileTypography.body, color: colors.text }}>
                  {t('personal_english_enabled')}
                </Text>
                <Switch
                  accessibilityLabel={t('personal_english_enabled')}
                  value={snapshot?.enabled ?? false}
                  disabled={busy || !snapshot}
                  onValueChange={(enabled) =>
                    void action(async () => {
                      const store = await moduleStore()
                      await authApi(`${base}/preferences`, {
                        method: 'PATCH',
                        body: JSON.stringify({ enabled }),
                      })
                      if (userId && useAuthStore.getState().user?.id === userId) {
                        rememberEnglishPreference(userId, enabled)
                        await store.cache('english-enabled', enabled)
                        if (!enabled) clearEnglishFeedback()
                      }
                    })
                  }
                />
              </View>
              <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>
                {t('personal_english_hint')}
              </Text>
              <Text style={{ ...mobileTypography.body, color: colors.text, marginTop: 24 }}>
                {t('personal_interval')}
              </Text>
              <TextInput
                accessibilityLabel={t('personal_interval')}
                value={interval}
                onChangeText={setIntervalMinutes}
                keyboardType="number-pad"
                style={fieldStyle}
              />
              {button(
                t('save'),
                () =>
                  void action(() =>
                    authApi(`${base}/preferences`, {
                      method: 'PATCH',
                      body: JSON.stringify({ intervalMinutes: Number(interval) }),
                    }),
                  ),
                busy ||
                  !snapshot ||
                  !/^\d+$/.test(interval) ||
                  Number(interval) < 1 ||
                  Number(interval) > 120,
              )}
              {button(
                t('personal_analyze'),
                () => void action(() => authApi(`${base}/analyze`, { method: 'POST', body: '{}' })),
              )}
            </>
          ) : page === 'add' ? (
            <>
              <TextInput
                accessibilityLabel={t('personal_word')}
                placeholder={t('personal_word')}
                placeholderTextColor={colors.textSecondary}
                value={word}
                onChangeText={setWord}
                autoCapitalize="none"
                autoFocus
                style={fieldStyle}
              />
              {button(
                t('personal_add_word'),
                () =>
                  void action(async () => {
                    await authApi(`${base}/items`, {
                      method: 'PUT',
                      body: JSON.stringify({ word: word.trim(), state: 'unseen' }),
                    })
                    if (useAuthStore.getState().user?.id === userId) {
                      setWord('')
                      setPage('list')
                    }
                  }),
                busy || !word.trim(),
              )}
            </>
          ) : item ? (
            <>
              <Text
                selectable
                style={{
                  ...mobileTypography.body,
                  fontSize: 26,
                  lineHeight: 34,
                  color: colors.text,
                }}
              >
                {item.word}
              </Text>
              <Text
                style={{ ...mobileTypography.body, color: colors.textSecondary, marginTop: 16 }}
              >
                {t(`personal_word_${item.state}`)}
              </Text>
              <Text
                style={{
                  ...mobileTypography.secondary,
                  color: colors.textSecondary,
                  marginVertical: 16,
                }}
              >
                {t('personal_word_counts', {
                  own: item.selfUseCount,
                  repeat: item.repeatCount,
                  prompt: item.promptCount,
                })}
              </Text>
              {item.state !== 'mastered'
                ? button(
                    t('personal_mastered'),
                    () =>
                      void action(() =>
                        authApi(`${base}/items`, {
                          method: 'PUT',
                          body: JSON.stringify({ word: item.word, state: 'mastered' }),
                        }),
                      ),
                  )
                : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}
