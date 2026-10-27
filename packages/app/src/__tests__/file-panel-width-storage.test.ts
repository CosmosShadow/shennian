// @covers src/features/chat/utils/filePanelWidthStorage.ts

import { describe, expect, it } from 'vitest'
import {
  FILE_PANEL_WIDTH_STORAGE_KEY,
  clampFilePanelWidth,
  getDefaultFilePanelWidth,
  getFilePanelWidthBounds,
  readStoredFilePanelWidth,
  readStoredFilePanelWidthPreference,
  resetStoredFilePanelWidth,
  writeStoredFilePanelWidth,
} from '../features/chat/utils/filePanelWidthStorage'

describe('file panel width storage', () => {
  it('keeps the preview and chat columns within usable desktop bounds', () => {
    const bounds = getFilePanelWidthBounds(1200)

    expect(bounds.min).toBe(264)
    expect(bounds.max).toBeLessThanOrEqual(1200 - 420)
    expect(clampFilePanelWidth(100, 1200)).toBe(bounds.min)
    expect(clampFilePanelWidth(2000, 1200)).toBe(bounds.max)
    expect(getDefaultFilePanelWidth(1200)).toBe(480)
  })

  it('adapts bounds for narrow desktop web widths without collapsing either side', () => {
    const bounds = getFilePanelWidthBounds(768)

    expect(bounds.min).toBeGreaterThanOrEqual(240)
    expect(bounds.max).toBeGreaterThanOrEqual(bounds.min)
    expect(clampFilePanelWidth(999, 768)).toBe(bounds.max)
  })

  it('restores and persists the clamped localStorage preference', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value)
      },
    }

    map.set(FILE_PANEL_WIDTH_STORAGE_KEY, '900')
    expect(readStoredFilePanelWidth(1200, storage)).toBe(getFilePanelWidthBounds(1200).max)

    writeStoredFilePanelWidth(500, 1200, storage)
    expect(map.get(FILE_PANEL_WIDTH_STORAGE_KEY)).toBe('500')
  })

  it('distinguishes missing user preference from the first-use default', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {},
    }

    expect(readStoredFilePanelWidthPreference(1200, storage)).toBeNull()
    expect(readStoredFilePanelWidth(1200, storage)).toBe(getDefaultFilePanelWidth(1200))
  })

  it('supports explicit reset without treating default width as a stored user drag', () => {
    const map = new Map<string, string>([[FILE_PANEL_WIDTH_STORAGE_KEY, '520']])
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value)
      },
      removeItem: (key: string) => {
        map.delete(key)
      },
    }

    expect(readStoredFilePanelWidthPreference(1200, storage)).toBe(520)
    resetStoredFilePanelWidth(storage)
    expect(readStoredFilePanelWidthPreference(1200, storage)).toBeNull()
  })

})
