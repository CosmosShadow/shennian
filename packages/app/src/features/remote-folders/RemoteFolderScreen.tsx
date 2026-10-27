import { useContextualSteward } from '../steward/ContextualStewardContext'
// @arch docs/architecture/remote-folders.md
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { useGoBack } from '../../hooks/useGoBack'
import { useTheme } from '../../hooks/useTheme'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { FilePanel, type SendFn } from '../../components/chat/FileDrawer'
import { canBrowseFolders, createFolderSend, folderKey } from './model'
import { useRemoteFolders } from './useRemoteFolders'

export default function RemoteFolderScreen() {
  const contextual = useContextualSteward()
  const setDetails = contextual?.setDetails
  const updateDirectory = useCallback((path: string) => setDetails?.({ path }), [setDetails])
  const { machineId, path } = useLocalSearchParams<{ machineId: string; path: string }>()
  const close = useGoBack('/(main)/spaces')
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { accountId, folders, ready, error, reload } = useRemoteFolders()
  const machine = useMachinesStore((s) => s.machines.find((entry) => entry.id === machineId))
  const [connection, setConnection] = useState<{ key: string; status: 'ready' | 'error' } | null>(
    null,
  )
  const [retry, setRetry] = useState(0)
  const saved =
    typeof machineId === 'string' &&
    typeof path === 'string' &&
    folders.some((folder) => folderKey(folder) === folderKey({ machineId, path }))
  const allowed = saved && canBrowseFolders(machine)
  const connectionKey = JSON.stringify([accountId, machineId, path, retry])
  useEffect(() => {
    if (!allowed || !machine?.online) return
    let active = true
    let observed = false
    void accountRuntime
      .observeMachine(machineId)
      .then((result) => {
        observed = result
        if (!active) {
          if (observed) void accountRuntime.unobserveMachine(machineId)
          return
        }
        setConnection({ key: connectionKey, status: result ? 'ready' : 'error' })
      })
      .catch(() => {
        if (active) setConnection({ key: connectionKey, status: 'error' })
      })
    return () => {
      active = false
      if (observed) void accountRuntime.unobserveMachine(machineId)
    }
  }, [allowed, machine?.online, machineId, connectionKey])
  const send: SendFn = useCallback(
    createFolderSend(
      { machineId, path },
      (frame) => {
        if (
          frame.method !== 'fs.ls' &&
          frame.method !== 'fs.read' &&
          frame.method !== 'fs.transfer.start' &&
          frame.method !== 'fs.transfer.chunk' &&
          frame.method !== 'fs.transfer.finish' &&
          frame.method !== 'fs.transfer.abort'
        )
          throw new Error(t('remote_folder_unavailable'))
        return accountRuntime.requestMachine(machineId, frame.method, frame.params)
      },
      () =>
        useAuthStore.getState().user?.id === accountId &&
        canBrowseFolders(
          useMachinesStore.getState().machines.find((entry) => entry.id === machineId),
        ),
      t('remote_folder_unavailable'),
      true,
    ),
    [machineId, path, accountId, t],
  )
  const connected =
    allowed && machine?.online && connection?.key === connectionKey && connection.status === 'ready'
  const failed =
    error ||
    (ready && !allowed) ||
    (allowed && !machine?.online) ||
    (connection?.key === connectionKey && connection.status === 'error')
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {connected ? (
        <FilePanel
          key={connectionKey}
          send={send}
          onDirectoryChange={updateDirectory}
          workDir={path}
          rootPath={path}
          readOnly
          allowUpload
          presentation="fullscreen"
          onInsertRef={() => {}}
          onClose={close}
        />
      ) : (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 }}
        >
          {failed ? (
            <>
              <Text style={{ color: colors.textSecondary }}>
                {t(
                  allowed && !machine?.online
                    ? 'remote_folder_offline'
                    : 'remote_folder_unavailable',
                )}
              </Text>
              <Pressable
                onPress={() => {
                  reload()
                  setRetry((value) => value + 1)
                }}
              >
                <Text style={{ color: colors.brand }}>{t('retry')}</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={colors.brand} />
          )}
          <Pressable accessibilityRole="button" onPress={close}>
            <Text style={{ color: colors.brand }}>{t('close')}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  )
}
