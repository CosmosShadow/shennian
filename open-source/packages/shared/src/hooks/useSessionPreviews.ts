import {
  SESSION_PREVIEW_MAX_LEN,
  trimPreviewText,
  isToolCallPayload,
  extractPreviewText,
  extractLatestReadablePreview,
} from '../lib/session-preview'

export {
  SESSION_PREVIEW_MAX_LEN,
  trimPreviewText,
  isToolCallPayload,
  extractPreviewText,
  extractLatestReadablePreview,
}

/**
 * Session 列表预览已由 sessions store 在索引落地时原子投影。
 * 这个兼容 Hook 不再订阅 Store、扫描正文或回写 preview；调用方
 * 可继续保留，不会把列表渲染变成同步触发器。
 */
export function createUseSessionPreviews() {
  return function useSessionPreviews(): void {}
}
