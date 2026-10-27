// @covers packages/app/app/(main)/organizations.tsx
// @arch docs/features/free-growth-phase.md
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('retired organization management surface', () => {
  it('keeps old links redirecting to settings without loading the retired management UI', () => {
    const route = fs.readFileSync(path.join(__dirname, '../../app/(main)/organizations.tsx'), 'utf8')
    expect(route).toContain('RetiredOrganizationsRoute')
    expect(route).toContain('<Redirect href="/(main)/profile" />')
    expect(route).not.toContain('OrganizationManagementScreen')
  })

  it('does not retain an unreachable organization management implementation or client', () => {
    const directory = path.join(__dirname, '../features/organizations')
    const files = fs.existsSync(directory) ? fs.readdirSync(directory) : []
    expect(files.filter((name) => /\.(?:ts|tsx)$/.test(name))).toEqual([])
  })
})
