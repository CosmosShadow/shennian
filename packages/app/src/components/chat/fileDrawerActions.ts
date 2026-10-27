// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/file-drawer-actions.test.ts

export type FileDrawerActionId = 'upload' | 'upload-folder' | 'tree' | 'more' | 'close'
export type FilePreviewActionId = 'edit' | 'insert-ref' | 'close'

export function getFileDrawerActionIds(
  isFullscreen: boolean,
  readOnly = false,
): FileDrawerActionId[] {
  return [
    ...(readOnly ? [] : ['upload' as const, 'upload-folder' as const]),
    ...(isFullscreen ? [] : ['tree' as const]),
    'more',
    ...(isFullscreen ? [] : ['close' as const]),
  ]
}

export function getFilePreviewActionIds(
  isFullscreen: boolean,
  canEdit = false,
  readOnly = false,
): FilePreviewActionId[] {
  return [
    ...(canEdit && !readOnly ? ['edit' as const] : []),
    ...(readOnly ? [] : ['insert-ref' as const]),
    ...(isFullscreen ? [] : ['close' as const]),
  ]
}
