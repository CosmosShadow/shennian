// @covers src/routes/adapter-submissions.ts
// @covers src/services/adapter-submissions.ts
// @covers open-source/packages/wire/src/adapter-submission.ts

import crypto from 'node:crypto'
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
}))
const objects = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators(app: ReturnType<typeof Fastify>) {
    app.decorateRequest('userId', '')
    app.decorateRequest('machineId', '')
  },
  async requireUserOrMachineAuth(request: { userId: string; machineId: string }) {
    request.userId = 'user-1'
    request.machineId = 'machine-1'
  },
  requireActivePlan: vi.fn(async () => {}),
}))
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    adapterSubmission: {
      findUnique: database.findUnique,
      findMany: database.findMany,
      create: database.create,
    },
  },
}))
vi.mock('../lib/oss.js', () => ({
  putObjectBuffer: objects.put,
  getObjectText: objects.get,
  deleteObjectIfExists: objects.remove,
}))

import { adapterSubmissionRoutes } from '../routes/adapter-submissions.js'
import {
  getAdapterSubmissionForReview,
  listAdapterSubmissionsForReview,
} from '../services/adapter-submissions.js'

const SOURCE = `export default {
  name: 'Example',
  version: '1.0.0',
  async listModels() { return { models: ['model-a'], defaultModel: 'model-a' } },
  async start(input) { return { session: input, nativeSessionId: 'native-1' } },
  async send({ output }) { output.final() },
  async stop() {},
  async resume(input) { return { session: input, nativeSessionId: input.nativeSessionId } },
}
`

function payload(content = SOURCE) {
  return {
    filename: 'adapter.mjs',
    content,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    targetAgent: 'Example Agent',
    adapterName: 'Example',
    adapterVersion: '1.0.0',
    checkedAt: '2026-09-22T08:00:00.000Z',
    models: ['model-a'],
    defaultModel: 'model-a',
    clientVersion: '0.5.3',
    platform: 'darwin',
  }
}

describe('Adapter submission API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    database.findUnique.mockResolvedValue(null)
    objects.put.mockResolvedValue(SOURCE.length)
    database.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      createdAt: new Date('2026-09-22T08:01:00.000Z'),
      updatedAt: new Date('2026-09-22T08:01:00.000Z'),
    }))
  })

  it('stores one private file and a pending review record without registering an official Adapter', async () => {
    const app = Fastify()
    await app.register(adapterSubmissionRoutes)
    const response = await app.inject({ method: 'POST', url: '/', payload: payload() })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      status: 'pending',
      duplicate: false,
      officialAdapterRegistered: false,
      sha256: payload().sha256,
    })
    expect(objects.put).toHaveBeenCalledWith(
      expect.stringMatching(/^adapter-submissions\/[^/]+\/adapter\.mjs$/),
      Buffer.from(SOURCE),
      'text/javascript; charset=utf-8',
    )
    expect(database.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        machineId: 'machine-1',
        status: 'pending',
        filename: 'adapter.mjs',
        sha256: payload().sha256,
      }),
    })
    await app.close()
  })

  it.each([
    ['credential_material', '\nconst apiKey = "sk-live-abcdefghijklmnop"\n'],
    ['environment_value', '\nprocess.env.UPSTREAM_TOKEN = "private-environment-value"\n'],
    ['absolute_path', '\nconst binary = "/Users/alice/private/bin"\n'],
    ['private_content', '\nconst contact = "alice@example.internal"\n'],
  ])('rejects %s before writing any object', async (issue, suffix) => {
    const app = Fastify()
    await app.register(adapterSubmissionRoutes)
    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: payload(SOURCE + suffix),
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'adapter_submission_sensitive_content',
      issues: expect.arrayContaining([issue]),
    })
    expect(objects.put).not.toHaveBeenCalled()
    await app.close()
  })

  it('recomputes SHA-256 and rejects a mismatched checked fingerprint', async () => {
    const app = Fastify()
    await app.register(adapterSubmissionRoutes)
    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { ...payload(), sha256: 'a'.repeat(64) },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'adapter_submission_fingerprint_mismatch' })
    expect(objects.put).not.toHaveBeenCalled()
    await app.close()
  })

  it('treats an identical user fingerprint as an idempotent duplicate', async () => {
    database.findUnique.mockResolvedValue({
      id: 'existing-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'pending',
      filename: 'adapter.mjs',
      byteSize: Buffer.byteLength(SOURCE),
      sha256: payload().sha256,
      targetAgent: 'Example Agent',
      adapterName: 'Example',
      adapterVersion: '1.0.0',
      clientVersion: '0.5.3',
      platform: 'darwin',
      checkedAt: new Date('2026-09-22T08:00:00.000Z'),
      checkSummary: { models: ['model-a'] },
      createdAt: new Date('2026-09-22T08:01:00.000Z'),
      updatedAt: new Date('2026-09-22T08:01:00.000Z'),
    })
    const app = Fastify()
    await app.register(adapterSubmissionRoutes)
    const response = await app.inject({ method: 'POST', url: '/', payload: payload() })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ submissionId: 'existing-1', duplicate: true })
    expect(objects.put).not.toHaveBeenCalled()
    await app.close()
  })

  it('loads source only for the private review detail while the queue stays metadata-only', async () => {
    const record = {
      id: 'submission-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'pending',
      filename: 'adapter.mjs',
      objectKey: 'adapter-submissions/submission-1/adapter.mjs',
      byteSize: Buffer.byteLength(SOURCE),
      sha256: payload().sha256,
      targetAgent: 'Example Agent',
      adapterName: 'Example',
      adapterVersion: '1.0.0',
      clientVersion: '0.5.3',
      platform: 'darwin',
      checkedAt: new Date('2026-09-22T08:00:00.000Z'),
      checkSummary: { models: ['model-a'] },
      createdAt: new Date('2026-09-22T08:01:00.000Z'),
      updatedAt: new Date('2026-09-22T08:01:00.000Z'),
    }
    database.findMany.mockResolvedValue([record])
    database.findUnique.mockResolvedValue(record)
    objects.get.mockResolvedValue(SOURCE)

    const queue = await listAdapterSubmissionsForReview()
    const detail = await getAdapterSubmissionForReview('submission-1')
    expect(queue).toEqual([expect.not.objectContaining({ content: expect.anything() })])
    expect(detail).toMatchObject({
      id: 'submission-1',
      content: SOURCE,
      officialAdapterRegistered: false,
    })
    expect(objects.get).toHaveBeenCalledWith(record.objectKey)
  })
})
