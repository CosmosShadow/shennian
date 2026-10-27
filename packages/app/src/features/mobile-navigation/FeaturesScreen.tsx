// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/features-screen.test.ts
import { ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { useTheme } from '../../hooks/useTheme'
import { useMobileModuleBack } from '../../components/useMobileModuleBack'
import { AppPageHeader } from '../../components/ConnectedAppPageHeader'
import { DEFAULT_MOBILE_TABS, mobileFeatures, mobileDestinationHref } from '../../components/mobileFeatureRegistry'
import { useLocalAppShortcuts } from '../local-apps/useLocalAppShortcuts'
import { appShortcutKey } from '../local-apps/shortcuts'
import { useRemoteFolders } from '../remote-folders/useRemoteFolders'
import { canBrowseFolders, folderKey, folderName } from '../remote-folders/model'
import { DirectoryRow } from './DirectoryRow'

/** Secondary directory; the four root tabs and device management have stable homes. */
export default function FeaturesScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const moduleBack = useMobileModuleBack()
  const machines = useMachinesStore(state => state.machines)
  const { folders } = useRemoteFolders()
  const { shortcuts } = useLocalAppShortcuts()
  const accessible = (machineId: string) => machines.some(machine => machine.id === machineId && canBrowseFolders(machine))
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <AppPageHeader title={t('mobile_all_features')} onBack={moduleBack} showsConnectivityStatus />
    <ScrollView testID="features-list" contentContainerStyle={{ paddingBottom: 24 }}>
      {mobileFeatures.filter(entry => !DEFAULT_MOBILE_TABS.includes(entry.key) && entry.key !== 'computers').map(entry =>
        <DirectoryRow key={entry.key} testID={`feature-${entry.key}`} title={t(entry.label)} icon={entry.icon}
          onPress={() => router.push(mobileDestinationHref(entry.key, 'push'))} />)}
      {folders.filter(folder => folder.showInFeatures && accessible(folder.machineId)).map(folder =>
        <DirectoryRow key={folderKey(folder)} testID={`feature-shortcut-folder:${folderKey(folder)}`}
          title={folderName(folder.path)} icon="folder-outline"
          onPress={() => router.push({ pathname: '/(main)/remote-folder', params: { machineId: folder.machineId, path: folder.path } })} />)}
      {shortcuts.filter(app => accessible(app.machineId)).map(app =>
        <DirectoryRow key={appShortcutKey(app)} testID={`feature-shortcut-app:${appShortcutKey(app)}`}
          title={app.title} icon="code-slash-outline"
          onPress={() => router.push({ pathname: '/(main)/content', params: { machineId: app.machineId, appId: app.appId } })} />)}
    </ScrollView>
  </SafeAreaView>
}
