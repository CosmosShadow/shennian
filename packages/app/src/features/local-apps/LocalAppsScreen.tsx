import { useContextualSteward } from '../steward/ContextualStewardContext'
// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppPageHeader, HeaderIconButton } from '../../components/AppPageHeader'
import { useMobileModuleBack } from '../../components/useMobileModuleBack'
import { useTranslation } from 'react-i18next'
import type { LocalApp } from '@shennian/wire'
import { getApiBaseUrl } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { localAppErrorKey } from './errors'
import { StewardScreen } from '../steward/StewardScreen'
import { LocalAppPreview } from './LocalAppPreview'
import { LocalAppTile } from './LocalAppTile'
import { LocalAppView } from './LocalAppView'
import { localAppsClient as client, runtimeUrl } from './client'

import { useLocalAppShortcuts } from './useLocalAppShortcuts'

type Entry = { app: LocalApp; machineId: string; machineName: string }
export default function LocalAppsScreen() {
  const contextual = useContextualSteward()
  const setDetails = contextual?.setDetails
  const { width } = useWindowDimensions()
  const tileWidth = (Math.min(width, 720) - 50) / 2
  const [creating, setCreating] = useState<{ id: number; text: string } | null>(null)
  const moduleBack = useMobileModuleBack()
  const { t } = useTranslation(),
    { colors } = useTheme()
  const userId = useAuthStore((s) => s.user?.id)
  const [machineCount, setMachineCount] = useState(0),
    [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [unavailable, setUnavailable] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [opened, setOpened] = useState<{
    entry: Entry
    url: string
    userId: string | undefined
  } | null>(null)
  const { shortcuts, change: changeShortcut } = useLocalAppShortcuts()
  const shortcut = (entry: Entry) => ({
    machineId: entry.machineId,
    appId: entry.app.id,
    title: entry.app.title,
  })
  const pinned = (entry: Entry) =>
    shortcuts.some((item) => item.machineId === entry.machineId && item.appId === entry.app.id)
  const epoch = useRef(0)
  const live = (n: number) => epoch.current === n && useAuthStore.getState().user?.id === userId
  const load = useCallback(async () => {
    const n = ++epoch.current
    setBusy(true)
    setError(null)
    setUnavailable(null)
    try {
      const { machines: rows } = await client.machines()
      if (!live(n)) return
      setMachineCount(rows.length)
      const results = await Promise.all(
        rows.map(async (machine) => {
          try {
            return {
              entries: (await client.apps(machine.id)).apps.map((app) => ({
                app,
                machineId: machine.id,
                machineName: machine.name,
              })),
              failure: null as string | null,
            }
          } catch (error) {
            return { entries: [], failure: localAppErrorKey(error) }
          }
        }),
      )
      if (live(n)) {
        setEntries(results.reduce<Entry[]>((rows, result) => rows.concat(result.entries), []))
        setUnavailable(results.find((r) => r.failure)?.failure ?? null)
      }
    } catch (error) {
      if (live(n)) setError(localAppErrorKey(error))
    } finally {
      if (live(n)) setBusy(false)
    }
    // Account reset invalidates all outstanding list/open operations.
  }, [userId])
  useEffect(() => {
    setOpened(null)
    setCreating(null)
    setMenu(null)
    setEntries([])
    setMachineCount(0)
    void load()
    return () => {
      epoch.current++
    }
  }, [load])
  const open = async (entry: Entry) => {
    setMenu(null)
    const n = ++epoch.current
    setBusy(true)
    setError(null)
    try {
      const runtime = await client.runtime(entry.machineId, entry.app.id)
      if (live(n))
        setOpened({ entry, userId, url: runtimeUrl(getApiBaseUrl(), runtime.runtimePath) })
    } catch (error) {
      if (live(n)) setError(localAppErrorKey(error))
    } finally {
      if (live(n)) setBusy(false)
    }
  }
  const remove = (entry: Entry) => {
    setMenu(null)
    Alert.alert(t('local_remove'), t('local_remove_body'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('local_remove'),
        style: 'destructive',
        onPress: () => {
          if (useAuthStore.getState().user?.id !== userId) return
          const n = epoch.current
          void client
            .remove(entry.machineId, entry.app.id)
            .then(async () => {
              if (live(n)) {
                await changeShortcut(shortcut(entry), true).catch(() =>
                  Alert.alert(t('local_feature_save_failed')),
                )
                if (live(n)) void load()
              }
            })
            .catch((error) => {
              if (live(n)) setError(localAppErrorKey(error))
            })
        },
      },
    ])
  }
  useEffect(() => { setDetails?.(opened && opened.userId === userId ? { machineId: opened.entry.machineId, appId: opened.entry.app.id } : {}) }, [opened, userId, setDetails])
  if (opened && userId && opened.userId === userId)
    return (
      <LocalAppView
        key={userId + opened.url}
        app={opened.entry.app}
        machineId={opened.entry.machineId}
        url={opened.url}
        onClose={() => {
          setOpened(null)
          void load()
        }}
      />
    )
  if (creating && !contextual)
    return (
      <StewardScreen
        composerDraft={creating}
        moduleHeader={
          <AppPageHeader
            title={t('local_add')}
            onBack={() => {
              setCreating(null)
              void load()
            }}
          />
        }
        moduleContent={<View />}
      />
    )
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppPageHeader
        title={t('content_entry')}
        onBack={moduleBack}
        hideDivider
        trailing={
          <HeaderIconButton
            icon="add"
            label={t('local_add')}
            testID="local-app-add"
            onPress={() => {
              setMenu(null)
              if (contextual) contextual.draft(t('local_create_prompt'))
              else setCreating({ id: Date.now(), text: t('local_create_prompt') })
            }}
          />
        }
      />
      <FlatList
        data={entries}
        numColumns={2}
        keyExtractor={(entry) => entry.machineId + entry.app.id}
        style={{ width: '100%', maxWidth: 720, alignSelf: 'center' }}
        contentContainerStyle={{ padding: 18, gap: 22 }}
        columnWrapperStyle={{ gap: 14 }}
        initialNumToRender={4}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={false}
        onScrollBeginDrag={() => setMenu(null)}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => {
              void load()
            }}
            tintColor={colors.textMuted}
          />
        }
        ListHeaderComponent={
          error ? (
            <Pressable
              onPress={() => {
                void load()
              }}
            >
              <Text style={{ color: colors.brand }}>{t(error)}</Text>
            </Pressable>
          ) : unavailable ? (
            <Text style={{ color: colors.textMuted }}>{t(unavailable)}</Text>
          ) : null
        }
        ListEmptyComponent={
          !busy && !error && !unavailable ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', paddingTop: 60 }}>
              {t(machineCount ? 'local_empty' : 'local_no_machine')}
            </Text>
          ) : null
        }
        renderItem={({ item: entry }) => (
          <LocalAppTile
            title={entry.app.title}
            machineName={entry.machineName}
            width={tileWidth}
            preview={
              <LocalAppPreview
                key={userId}
                machineId={entry.machineId}
                appId={entry.app.id}
                revision={entry.app.updatedAt}
                width={tileWidth}
              />
            }
            testID={'local-app-' + entry.app.id}
            colors={colors}
            removeLabel={t('local_remove')}
            moreLabel={t('local_more')}
            menuOpen={menu === entry.machineId + entry.app.id}
            shortcutLabel={t(pinned(entry) ? 'local_feature_hide' : 'local_feature_show')}
            onToggleShortcut={() => {
              setMenu(null)
              void changeShortcut(shortcut(entry), pinned(entry)).catch(() =>
                Alert.alert(t('local_feature_save_failed')),
              )
            }}
            onOpen={() => {
              void open(entry)
            }}
            onMore={() =>
              setMenu((current) =>
                current === entry.machineId + entry.app.id ? null : entry.machineId + entry.app.id,
              )
            }
            onRemove={() => remove(entry)}
          />
        )}
      />
    </SafeAreaView>
  )
}
