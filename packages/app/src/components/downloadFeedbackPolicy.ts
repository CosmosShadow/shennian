// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/attachment-download.test.ts

export const DOWNLOAD_FEEDBACK_MS = 4000
export type DownloadResult = 'desktop' | 'picker' | 'download' | 'browser' | 'downloads' | 'share' | 'library' | 'permission-denied'
export type DownloadNotice = { message: string; type: 'success' | 'error' | 'info' }

export function downloadFeedback(t: (key: string, options: { name: string }) => string, result: DownloadResult, name: string): DownloadNotice {
  const key = result === 'library' ? 'media_saved_to_library'
    : result === 'permission-denied' ? 'media_save_permission_denied'
    : result === 'desktop' || result === 'picker' ? 'download_saved_to_selected_location'
    : result === 'downloads' ? 'download_saved_to_downloads'
    : result === 'share' ? 'download_opened_save_sheet' : 'download_started_browser'
  return { message: t(key, { name }), type: result === 'permission-denied' ? 'error'
    : result === 'share' || result === 'browser' || result === 'download' ? 'info' : 'success' }
}

