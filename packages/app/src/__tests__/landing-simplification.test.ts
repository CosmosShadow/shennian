// @covers packages/app/src/components/PublicSiteRedirect.tsx
// @covers packages/app/app/landing.tsx
// @covers packages/app/app-web/index.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('retired Expo landing page', () => {
  it('redirects every obsolete public entry to the canonical public site', () => {
    const entry = readFileSync(resolve(__dirname, '../../app/index.tsx'), 'utf8')
    const lightweightEntry = readFileSync(resolve(__dirname, '../../app-web/index.tsx'), 'utf8')
    const landingRoute = readFileSync(resolve(__dirname, '../../app/landing.tsx'), 'utf8')
    const redirect = readFileSync(resolve(__dirname, '../components/PublicSiteRedirect.tsx'), 'utf8')

    expect(entry).toContain("from '../src/components/PublicSiteRedirect'")
    expect(lightweightEntry).toContain('<PublicSiteRedirect />')
    expect(landingRoute).toContain('PublicSiteRedirect as default')
    expect(redirect).toContain('window.location.replace(publicSiteDestination())')
    expect(redirect).toContain("window.location.hash === '#get-started' ? '#downloads'")
    expect(entry).not.toContain('LandingContent')
    expect(lightweightEntry).not.toContain('href="/landing"')
  })
})
