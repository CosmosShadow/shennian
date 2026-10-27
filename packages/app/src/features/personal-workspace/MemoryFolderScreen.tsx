// @arch docs/features/personal-agent-workspace.md
// @test packages/app/src/__tests__/memory-folder.test.ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { FilePanel } from '../../components/chat/FileDrawer'
import { AppPageHeader } from '../../components/ConnectedAppPageHeader'
import { useMobileModuleBack } from '../../components/useMobileModuleBack'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useContextualSteward } from '../steward/ContextualStewardContext'
import { usePrimaryMachine } from './usePrimaryMachine'
import { personalWorkspaceClient, personalErrorKey } from './client'
import { createMemoryFolderSend } from './memoryFolderTransport'

export default function MemoryFolderScreen() {
  const accountId = useAuthStore(state => state.user?.id)
  return <AccountMemoryFolder key={accountId} />
}
function AccountMemoryFolder() {
  const { t } = useTranslation(), { colors } = useTheme(), router = useRouter()
  const moduleBack = useMobileModuleBack()
  const close = useCallback(() => { if (moduleBack) moduleBack(); else router.replace('/(main)/features') }, [moduleBack, router])
  const accountId = useAuthStore(state => state.user?.id)
  const primary = usePrimaryMachine(), machine = primary.record?.machine
  const revision = primary.record?.revision
  const setDetails = useContextualSteward()?.setDetails
  const updateDirectory = useCallback((path: string) => setDetails?.({ kind: 'memory', path, ...(machine ? { machineId: machine.id } : {}) }), [setDetails, machine?.id])
  const [attempt, setAttempt] = useState(0)
  const [location, setLocation] = useState<{ key: string; root?: string; error?: string; code?: string }>()
  const key = JSON.stringify([accountId, machine?.id, revision, attempt])
  useEffect(() => {
    if (!machine?.online || revision == null) return
    let live = true
    void personalWorkspaceClient({ action: 'info', expectedPrimaryRevision: revision }).then(info => {
      if (!info.workspace) throw new Error('personal_directory_not_configured')
      if (live && useAuthStore.getState().user?.id === accountId) setLocation({ key, root: info.workspace })
    }).catch(error => {
      if (live && useAuthStore.getState().user?.id === accountId) setLocation({ key, error: personalErrorKey(error) })
    })
    return () => { live = false }
  }, [key, machine?.online, revision, accountId])
  const root = location?.key === key ? location.root : undefined
  const send = useMemo(() => {
    const transport = createMemoryFolderSend({
      rootPath: root || '/', revision: revision ?? 0, request: personalWorkspaceClient,
      available: () => useAuthStore.getState().user?.id === accountId && !!machine?.online,
    })
    return async (frame: Parameters<typeof transport>[0]) => {
      try { return await transport(frame) }
      catch (error) {
        if (frame.method === 'fs.ls' && useAuthStore.getState().user?.id === accountId) {
          const message = error instanceof Error ? error.message : ''
          const code = message.match(/\bpersonal_[a-z_]+\b/)?.[0]
          setLocation({ key, error: personalErrorKey(error), code })
        }
        throw error
      }
    }
  }, [root, revision, accountId, machine?.online, key])
  const errorKey = primary.error || (!primary.loading && !machine
    ? primary.record?.revision ? 'personal_primary_unavailable' : 'personal_primary_not_configured'
    : machine && !machine.online ? 'personal_machine_offline' : location?.key === key ? location.error : undefined)
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    {root && machine?.online && !errorKey ? <FilePanel key={key} send={send} workDir={root} rootPath={root}
      readOnly allowUpload={false} presentation="fullscreen" onClose={close} onInsertRef={() => {}}
      onDirectoryChange={updateDirectory} /> : <>
      <AppPageHeader title={t('personal_memory')} onBack={moduleBack} />
      {errorKey ? <View style={{ padding: 24, gap: 16 }}>
        <Text style={{ color: colors.textSecondary }}>{t(errorKey)}</Text>
        {location?.key === key && location.code ? <Text selectable style={{ color: colors.textSecondary }}>{t('personal_error_code', { code: location.code })}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => { primary.refresh(); setAttempt(value => value + 1) }}>
          <Text style={{ color: colors.brand }}>{t('retry')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.navigate('/(main)/machines')}>
          <Text style={{ color: colors.brand }}>{t('personal_primary_settings')}</Text>
        </Pressable>
      </View> : <ActivityIndicator style={{ marginTop: 30 }} color={colors.brand} />}
    </>}
  </SafeAreaView>
}
