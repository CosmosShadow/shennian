import { useContextualSteward } from '../steward/ContextualStewardContext'
// @arch docs/architecture/remote-folders.md
// @test packages/app/src/__tests__/remote-folders.test.ts
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { useGoBack } from '../../hooks/useGoBack'
import { useTheme } from '../../hooks/useTheme'
import { DirBrowser } from '../../components/DirBrowser'
import { useRemoteFolders } from './useRemoteFolders'
import { canBrowseFolders } from './model'

export default function MachineFolderScreen() {
  const contextual = useContextualSteward()
  const setDetails = contextual?.setDetails
  const updateDirectory = useCallback((path: string) => setDetails?.({ path }), [setDetails])
  const { machineId } = useLocalSearchParams<{ machineId: string }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const close = useGoBack('/(main)/machines')
  const folders = useRemoteFolders()
  const machine = useMachinesStore((state) => state.machines.find((item) => item.id === machineId))
  const [saving, setSaving] = useState(false)
  const [retryPath, setRetryPath] = useState<string | null>(null)
  const save = async (path: string) => {
    if (saving) return
    if (
      useAuthStore.getState().user?.id !== folders.accountId ||
      !canBrowseFolders(useMachinesStore.getState().machines.find((item) => item.id === machineId))
    ) {
      Alert.alert(t('remote_folder_unavailable'))
      return
    }
    setSaving(true)
    setRetryPath(path)
    try {
      await folders.change({ machineId, path })
      if (useAuthStore.getState().user?.id !== folders.accountId) return
      router.navigate('/(main)/folders')
    } catch {
      Alert.alert(t('remote_folder_save_failed'))
    } finally {
      setSaving(false)
    }
  }
  const available = typeof machineId === 'string' && canBrowseFolders(machine) && machine?.online
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {available ? (
        <>
          <DirBrowser
            key={machineId}
            machineId={machineId}
            onDirectoryChange={updateDirectory}
            initialPath="~"
            mode="workDirPicker"
            inline
            closeOnSelect={false}
            onClose={close}
            onSelect={(path) => {
              void save(path)
            }}
          />
          {saving ? (
            <View
              style={{
                position: 'absolute',
                inset: 0,
                justifyContent: 'center',
                backgroundColor: colors.bg,
                opacity: 0.9,
              }}
            >
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : null}
          {retryPath && !saving ? (
            <Pressable
              onPress={() => {
                void save(retryPath)
              }}
              style={{ padding: 12 }}
            >
              <Text style={{ color: colors.brand }}>{t('retry')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20 }}>
          <Text style={{ color: colors.textSecondary }}>{t('remote_folder_unavailable')}</Text>
          <Pressable onPress={close}>
            <Text style={{ color: colors.brand }}>{t('close')}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  )
}
