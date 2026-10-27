// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/machine-connection.ts

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('upgrade event version authority', () => {
  it('keeps the connected handshake authoritative for CLI version projection', () => {
    const handler = fs.readFileSync(
      path.resolve(__dirname, '../relay/machine-connection.ts'),
      'utf8',
    )
    const upgradeBranch = handler.slice(
      handler.indexOf("event.event === 'upgrade'"),
      handler.indexOf("event.event === 'native.session.events'"),
    )
    expect(upgradeBranch).toContain('pubsub.publishToClient(machineId, enriched)')
    expect(upgradeBranch).not.toContain('setMachineCliVersion')
  })
})
