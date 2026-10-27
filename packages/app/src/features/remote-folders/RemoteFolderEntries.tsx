import { ActionIconButton } from '../../components/ActionIconButton'
// @arch docs/architecture/remote-folders.md
import { Alert, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTheme } from '../../hooks/useTheme'
import { canBrowseFolders, folderKey, folderName, type RemoteFolder } from './model'

export function RemoteFolderEntries({
  folders,
  onRemove,
  onChange,
}: {
  folders: RemoteFolder[]
  onRemove(folder: RemoteFolder): Promise<void>
  onChange?(folder: RemoteFolder): Promise<void>
}) {
  const machines = useMachinesStore((s) => s.machines)
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  return (
    <View>
      {folders
        .filter((folder) => machines.some((machine) => machine.id === folder.machineId))
        .map((folder) => {
          const machine = machines.find((machine) => machine.id === folder.machineId)!
          const available = canBrowseFolders(machine)
          const confirmRemove = () =>
            Alert.alert(t('remote_folder_remove'), t('remote_folder_remove_hint'), [
              { text: t('cancel'), style: 'cancel' },
              {
                text: t('remote_folder_remove_confirm'),
                style: 'destructive',
                onPress: () => {
                  void onRemove(folder).catch(() => Alert.alert(t('remote_folder_save_failed')))
                },
              },
            ])
          const manage = () =>
            Alert.alert(folderName(folder.path), undefined, [
              ...(onChange
                ? [
                    {
                      text: t(folder.showInFeatures ? 'remote_folder_unpin' : 'remote_folder_pin'),
                      onPress: () => {
                        void onChange({ ...folder, showInFeatures: !folder.showInFeatures }).catch(
                          () => Alert.alert(t('remote_folder_save_failed')),
                        )
                      },
                    },
                  ]
                : []),
              {
                text: t('remote_folder_remove'),
                style: 'destructive' as const,
                onPress: confirmRemove,
              },
              { text: t('cancel'), style: 'cancel' as const },
            ])
          return (
            <View
              key={folderKey(folder)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                borderBottomWidth: 0.5,
                borderBottomColor: colors.border,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('remote_folder')} ${folderName(folder.path)}`}
                accessibilityHint={t('remote_folder_manage_hint')}
                testID="remote-folder-entry"
                accessibilityActions={[{ name: 'remove-folder', label: t('remote_folder_remove') }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'remove-folder') confirmRemove()
                }}
                onLongPress={confirmRemove}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 76,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 18,
                  paddingVertical: 10,
                  backgroundColor: pressed ? colors.surfaceHover : colors.bg,
                })}
                onPress={() =>
                  available
                    ? router.navigate({
                        pathname: '/(main)/remote-folder',
                        params: { machineId: folder.machineId, path: folder.path },
                      })
                    : Alert.alert(t('remote_folder_unavailable'))
                }
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 15,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.surface,
                  }}
                >
                  <Ionicons name="folder-outline" size={25} color={colors.navigationSelected} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text
                    style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}
                    numberOfLines={1}
                  >
                    {folderName(folder.path)}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 14 }} numberOfLines={1}>
                    {t('remote_folder')} · {machine.name} ·{' '}
                    {t(
                      !available
                        ? 'remote_folder_unavailable'
                        : machine.online
                          ? 'online'
                          : 'remote_folder_offline_short',
                    )}
                  </Text>
                </View>
              </Pressable>
              <ActionIconButton icon="more" color={colors.textSecondary}
                testID="remote-folder-manage"
                label={`${t('more')} · ${folderName(folder.path)}`}
                onPress={manage}
                style={({ pressed }) => ({
                  minWidth: 48,
                  minHeight: 48,
                  marginRight: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  backgroundColor: pressed ? colors.surfaceHover : colors.bg,
                })}
              >

              </ActionIconButton>
            </View>
          )
        })}
    </View>
  )
}
