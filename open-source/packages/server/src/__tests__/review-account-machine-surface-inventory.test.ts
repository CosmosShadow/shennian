// @covers open-source/packages/server/src/routes/machines.ts
// @covers open-source/packages/server/src/routes/device-authorizations.ts
// @covers open-source/packages/server/src/routes/sessions.ts
// @covers open-source/packages/server/src/routes/projects.ts
// @covers open-source/packages/server/src/routes/agents.ts
// @covers open-source/packages/server/src/routes/organizations.ts

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const routesDirectory = path.resolve(import.meta.dirname, '../routes')

function routeSource(fileName: string): string {
  return fs.readFileSync(path.join(routesDirectory, fileName), 'utf8')
}

describe('review account machine-surface inventory', () => {
  it.each([
    'machines.ts',
    'device-authorizations.ts',
    'sessions.ts',
    'projects.ts',
    'agents.ts',
    'organizations.ts',
  ])('keeps %s behind the central review-account policy', (fileName) => {
    const source = routeSource(fileName)
    expect(source).toContain('../services/review-account-policy.js')
    expect(source).toContain('requireNonReviewMachineAccess')
  })

  it('covers every machine enrollment path, including Desktop, pair claim and login intent', () => {
    const machines = routeSource('machines.ts')
    const authorizations = routeSource('device-authorizations.ts')
    expect(machines).toContain('"/desktop/register"')
    expect(machines).toContain('"/pair/claim"')
    expect(authorizations).toContain("'/:id/approve'")
    expect(authorizations).toContain('requireNonReviewMachineAccess')
  })
})
