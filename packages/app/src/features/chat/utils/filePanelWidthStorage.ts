// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/file-panel-width-storage.test.ts

export const FILE_PANEL_WIDTH_STORAGE_KEY = 'shennian.chat.filePanelWidth.v1'

const DEFAULT_PREVIEW_RATIO = 0.4
const MAX_PREVIEW_RATIO = 0.72
const MIN_PREVIEW_WIDTH = 280
const MIN_PREVIEW_RATIO = 0.22
const MIN_CHAT_WIDTH = 420
const FALLBACK_TOTAL_WIDTH = 1200

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

function normalizeTotalWidth(totalWidth: number): number {
  return Number.isFinite(totalWidth) && totalWidth > 0 ? totalWidth : FALLBACK_TOTAL_WIDTH
}

export function getFilePanelWidthBounds(totalWidth: number): { min: number; max: number } {
  const total = normalizeTotalWidth(totalWidth)
  const minPreview = Math.min(MIN_PREVIEW_WIDTH, Math.max(240, Math.floor(total * MIN_PREVIEW_RATIO)))
  const minChat = Math.min(MIN_CHAT_WIDTH, Math.max(320, Math.floor(total * 0.35)))
  const maxPreview = Math.max(minPreview, Math.floor(Math.min(total - minChat, total * MAX_PREVIEW_RATIO)))
  return { min: minPreview, max: maxPreview }
}

export function clampFilePanelWidth(width: number, totalWidth: number): number {
  const total = normalizeTotalWidth(totalWidth)
  const { min, max } = getFilePanelWidthBounds(total)
  const next = Number.isFinite(width) && width > 0 ? width : total * DEFAULT_PREVIEW_RATIO
  return Math.round(Math.max(min, Math.min(max, next)))
}

export function getDefaultFilePanelWidth(totalWidth: number): number {
  const total = normalizeTotalWidth(totalWidth)
  return clampFilePanelWidth(total * DEFAULT_PREVIEW_RATIO, total)
}

export function readStoredFilePanelWidthPreference(
  totalWidth: number,
  storage?: StorageLike | null,
): number | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(FILE_PANEL_WIDTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return clampFilePanelWidth(parsed, totalWidth)
  } catch {
    return null
  }
}

export function readStoredFilePanelWidth(totalWidth: number, storage?: StorageLike | null): number {
  return readStoredFilePanelWidthPreference(totalWidth, storage) ?? getDefaultFilePanelWidth(totalWidth)
}

export function writeStoredFilePanelWidth(width: number, totalWidth: number, storage?: StorageLike | null): void {
  if (!storage) return
  try {
    storage.setItem(FILE_PANEL_WIDTH_STORAGE_KEY, String(clampFilePanelWidth(width, totalWidth)))
  } catch {
    // Preferences are best-effort only.
  }
}

export function resetStoredFilePanelWidth(storage?: StorageLike | null): void {
  if (!storage?.removeItem) return
  try {
    storage.removeItem(FILE_PANEL_WIDTH_STORAGE_KEY)
  } catch {
    // Preferences are best-effort only.
  }
}

export function getWebFilePanelWidthStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}
