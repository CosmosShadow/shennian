// @arch docs/architecture/app/modular-features.md
// @covers packages/app/src/features/profile/docsLink.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Linking: {
    openURL: vi.fn(),
  },
}))

vi.mock('../config/server', () => ({
  getDocsUrl: () => 'https://configured.example/docs',
}))

import { getProfileDocsUrl, openProfileDocs } from '../features/profile/docsLink'

describe('profile docs link', () => {
  it('derives the profile documentation URL from the configured docs URL', () => {
    expect(getProfileDocsUrl()).toBe('https://configured.example/docs')
  })

  it('opens the derived docs URL', async () => {
    const openUrl = vi.fn(() => Promise.resolve(true))

    await expect(openProfileDocs(openUrl)).resolves.toBe(true)

    expect(openUrl).toHaveBeenCalledWith('https://configured.example/docs')
  })

  it('swallows native browser launch failures instead of crashing the settings screen', async () => {
    const openUrl = vi.fn(() => Promise.reject(new Error('cannot open')))

    await expect(openProfileDocs(openUrl)).resolves.toBe(false)
  })
})
