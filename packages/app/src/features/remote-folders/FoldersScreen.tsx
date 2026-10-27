// @arch docs/architecture/remote-folders.md
// @test src/__tests__/machine-avatar.test.ts
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useMachinesStore } from '@shennian/shared'
import { AppPageHeader } from '../../components/ConnectedAppPageHeader'
import { useMobileModuleBack } from '../../components/useMobileModuleBack'
import { useTheme } from '../../hooks/useTheme'
import { SavedFolderList } from './SavedFolderList'
import { canBrowseFolders } from './model'
import { MachineAvatar } from '../machines/components/MachineAvatar'
import { machineStyles } from '../machines/styles'
import { mobileTypography } from '../../theme/mobileTypography'

export default function FoldersScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const onBack = useMobileModuleBack()
  const [adding, setAdding] = useState(false)
  const machines = useMachinesStore((state) => state.machines)
  const eligible = machines.filter(canBrowseFolders)
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppPageHeader
        title={t(adding ? 'remote_folder_add' : 'mobile_folders')}
        onBack={adding ? () => setAdding(false) : onBack}
        showsConnectivityStatus
        trailing={
          <Pressable
            testID="folders-add"
            accessibilityRole="button"
            accessibilityLabel={t(adding ? 'close' : 'remote_folder_add')}
            onPress={() => setAdding((value) => !value)}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons
              name={adding ? 'close-outline' : 'add-outline'}
              size={28}
              color={colors.text}
            />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {adding ? (
          <View style={{ padding: 16, gap: 16 }}>
            <Text style={{ color: colors.textSecondary, ...mobileTypography.secondary }}>
              {t('remote_folder_add_hint')}
            </Text>
            <View>
              {!eligible.length ? (
                <Text style={{ padding: 18, color: colors.textSecondary }}>
                  {t('remote_folder_no_machines')}
                </Text>
              ) : null}
              {eligible.map((machine, index) => (
                <Pressable
                  key={machine.id}
                  accessibilityRole="button"
                  disabled={!machine.online}
                  accessibilityState={{ disabled: !machine.online }}
                  onPress={() => {
                    setAdding(false)
                    router.push({
                      pathname: '/(main)/machine-folder',
                      params: { machineId: machine.id },
                    })
                  }}
                  style={({ pressed }) => [machineStyles.machineCardCompact, machineStyles.compactMachineIdentity, {
                    borderBottomColor: colors.groupedSeparator,
                    borderBottomWidth: index === eligible.length - 1 ? 0 : 1,
                    backgroundColor: pressed ? colors.surfaceHover : colors.bg,
                  }]}
                >
                  <MachineAvatar machine={machine} />
                  <View style={machineStyles.compactMachineCopy}>
                    <Text numberOfLines={1} style={[machineStyles.compactMachineName, { color: machine.online ? colors.text : colors.textSecondary }]}>
                      {machine.name}
                    </Text>
                    <Text style={[machineStyles.compactMachineMetadata, { color: colors.textSecondary }]}>
                      {t(machine.online ? 'machine_online' : 'machine_offline')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <SavedFolderList />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
