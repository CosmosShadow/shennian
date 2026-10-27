// @arch docs/architecture/remote-folders.md
// @test packages/app/src/__tests__/file-drawer-actions.test.ts
import { useContextualSteward } from './ContextualStewardContext'
import type { ComposerMenuItem } from '../chat/components/ComposerActionMenu'

/** A filesystem upload is not an attachment sent to the AI. Keep both destinations explicit. */
export function useDirectoryUploadMenu(t: (key: string, options?: any) => string, close: () => void) {
  const context = useContextualSteward()
  const action = context?.directoryUpload
  const items: ComposerMenuItem[] = action ? [{
    id: 'directory-upload', icon: 'upload', testID: 'composer-directory-upload',
    label: `${t('remote_folder_upload_current')}\n${action.path}`,
    disabled: action.disabled,
    onPress: () => { if (!action.disabled) { close(); action.onPress() } },
  }] : []
  return { items,
    fileLabel: t(action ? 'remote_folder_attach_ai' : 'composer_menu_files'),
    cameraLabel: t(action ? 'remote_folder_camera_ai' : 'profile_avatar_camera'),
    mediaLabel: t(action ? 'remote_folder_media_ai' : 'composer_menu_photos'),
  }
}
