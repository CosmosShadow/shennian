// @covers open-source/packages/cli/src/upgrade/distribution.ts

import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchCliDistribution, getCliUpdateSourceOrder } from '../upgrade/distribution.js'

let server: Server | null = null
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
  server = null
})

describe('private CLI distribution client', () => {
  it('sends machine authentication over a real local HTTP request', async () => {
    server = createServer((request, response) => {
      expect(request.url).toBe('/api/releases/cli?channel=stable')
      expect(request.headers.authorization).toBe('Bearer local-machine-token')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        schemaVersion: 1,
        channel: 'stable',
        version: '1.2.3',
        artifact: {
          url: 'http://127.0.0.1/private-artifact.tgz?expires=60&signature=fixture',
          size: 123,
          integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
        },
      }))
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('local server did not bind')

    await expect(fetchCliDistribution({
      baseUrl: `http://127.0.0.1:${address.port}`,
      machineToken: 'local-machine-token',
    })).resolves.toMatchObject({ version: '1.2.3', channel: 'stable' })
  })

  it('defaults to npm-first and exposes OSS-first only as an explicit switch', () => {
    expect(getCliUpdateSourceOrder()).toBe('npm-first')
    expect(getCliUpdateSourceOrder('oss-first')).toBe('oss-first')
    expect(getCliUpdateSourceOrder('invalid')).toBe('npm-first')
  })
})
