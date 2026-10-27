// @covers open-source/packages/server/src/middleware/trace.ts

import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeErrorMessage, tracePlugin } from '../middleware/trace.js'

const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

function buildLoggedApp(lines: string[]) {
  const app = Fastify({
    disableRequestLogging: true,
    logger: {
      level: 'info',
      stream: { write: (line: string) => lines.push(line) },
    },
  })
  apps.push(app)
  return app
}

async function flushLogs(app: ReturnType<typeof Fastify>): Promise<void> {
  app.log.flush()
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('HTTP access logging', () => {
  it('redacts credentials and URLs from error messages', () => {
    const sanitized = sanitizeErrorMessage(
      'failed https://example.com/path?token=secret Bearer private-token',
    )

    expect(sanitized).toBe('failed [url] Bearer [redacted]')
  })

  it('writes one completion entry with a route template and no Fastify request pair', async () => {
    const lines: string[] = []
    const app = buildLoggedApp(lines)
    await tracePlugin(app)
    app.get('/rooms/:roomId', async () => ({ ok: true }))

    await app.inject({ method: 'GET', url: '/rooms/private-room-id?token=secret' })
    await flushLogs(app)

    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records.filter((record) => record.event === 'http.access')).toHaveLength(1)
    expect(records.find((record) => record.event === 'http.access')).toMatchObject({
      method: 'GET',
      path: '/rooms/:roomId',
      statusCode: 200,
    })
    expect(records.some((record) => record.msg === 'incoming request')).toBe(false)
    expect(records.some((record) => record.msg === 'request completed')).toBe(false)
    expect(JSON.stringify(records)).not.toContain('private-room-id')
    expect(JSON.stringify(records)).not.toContain('secret')
  })

  it('keeps thrown errors while excluding transport endpoints from access logs', async () => {
    const lines: string[] = []
    const app = buildLoggedApp(lines)
    await tracePlugin(app)
    app.get('/relay/machine', async () => ({ ok: true }))
    app.get('/boom', async () => { throw new Error('safe failure') })

    await app.inject({ method: 'GET', url: '/relay/machine?token=secret' })
    await app.inject({ method: 'GET', url: '/boom' })
    await flushLogs(app)

    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records.filter((record) => record.event === 'http.access')).toHaveLength(1)
    expect(records.filter((record) => record.event === 'http.error')).toHaveLength(1)
    expect(JSON.stringify(records)).not.toContain('secret')
  })
})
