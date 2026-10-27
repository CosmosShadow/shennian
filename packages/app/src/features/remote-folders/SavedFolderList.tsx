// @arch docs/architecture/remote-folders.md
// @test packages/app/src/__tests__/remote-folders.test.ts
import { Pressable, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { useTheme } from '../../hooks/useTheme'
import { useRemoteFolders } from './useRemoteFolders'
import { RemoteFolderEntries } from './RemoteFolderEntries'
import { folderName } from './model'

/** Saved directories belong to the Folders module. */
export function SavedFolderList({ query = '' }: { query?: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const machines = useMachinesStore((state) => state.machines)
  const folders = useRemoteFolders()
  const search = query.trim().toLocaleLowerCase()
  const visible = folders.folders.filter((folder) => {
    const machine = machines.find((item) => item.id === folder.machineId)
    return (
      machine &&
      (!search || `${folderName(folder.path)} ${machine.name}`.toLocaleLowerCase().includes(search))
    )
  })
  return (
    <>
      <RemoteFolderEntries
        folders={visible}
        onRemove={(folder) => folders.change(folder, true)}
        onChange={(folder) => folders.change(folder)}
      />
      {folders.error ? (
        <Pressable accessibilityRole="button" onPress={folders.reload} style={{ padding: 16 }}>
          <Text style={{ color: colors.error }}>
            {t('remote_folder_load_failed')} · {t('retry')}
          </Text>
        </Pressable>
      ) : null}
    </>
  )
}
