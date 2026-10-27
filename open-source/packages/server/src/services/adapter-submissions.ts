// @arch open-source/docs/server-runtime.md
// @test src/__tests__/adapter-submissions.test.ts

import crypto from 'node:crypto'
import {
  ADAPTER_SUBMISSION_CONTENT_TYPE,
  ADAPTER_SUBMISSION_FILENAME,
  ADAPTER_SUBMISSION_MAX_BYTES,
  scanAdapterSubmissionSource,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { deleteObjectIfExists, getObjectText, putObjectBuffer } from '../lib/oss.js'

export class AdapterSubmissionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly issues?: string[],
  ) {
    super(message)
  }
}

export type AdapterSubmissionInput = {
  filename?: unknown
  content?: unknown
  sha256?: unknown
  targetAgent?: unknown
  adapterName?: unknown
  adapterVersion?: unknown
  checkedAt?: unknown
  models?: unknown
  defaultModel?: unknown
  clientVersion?: unknown
  platform?: unknown
}

export async function createAdapterSubmission(input: {
  userId: string
  machineId: string
  body: AdapterSubmissionInput
}) {
  const normalized = normalizeSubmission(input.body)
  const existing = await prisma.adapterSubmission.findUnique({
    where: {
      userId_sha256: {
        userId: input.userId,
        sha256: normalized.sha256,
      },
    },
  })
  if (existing) return { submission: publicSubmission(existing), duplicate: true }

  const id = crypto.randomUUID()
  const objectKey = 'adapter-submissions/' + id + '/' + ADAPTER_SUBMISSION_FILENAME
  await putObjectBuffer(
    objectKey,
    Buffer.from(normalized.content, 'utf8'),
    ADAPTER_SUBMISSION_CONTENT_TYPE,
  )
  try {
    const submission = await prisma.adapterSubmission.create({
      data: {
        id,
        userId: input.userId,
        machineId: input.machineId,
        status: 'pending',
        filename: ADAPTER_SUBMISSION_FILENAME,
        objectKey,
        byteSize: normalized.byteSize,
        sha256: normalized.sha256,
        targetAgent: normalized.targetAgent,
        adapterName: normalized.adapterName,
        adapterVersion: normalized.adapterVersion,
        clientVersion: normalized.clientVersion,
        platform: normalized.platform,
        checkedAt: normalized.checkedAt,
        checkSummary: {
          models: normalized.models,
          defaultModel: normalized.defaultModel,
          protocolVersion: 1,
          requiredMethods: ['listModels', 'start', 'send', 'stop', 'resume'],
        },
      },
    })
    return { submission: publicSubmission(submission), duplicate: false }
  } catch (error) {
    await deleteObjectIfExists(objectKey).catch(() => {})
    const winner = await prisma.adapterSubmission.findUnique({
      where: {
        userId_sha256: {
          userId: input.userId,
          sha256: normalized.sha256,
        },
      },
    })
    if (winner) return { submission: publicSubmission(winner), duplicate: true }
    throw error
  }
}

export async function listAdapterSubmissionsForReview(limit = 100) {
  const rows = await prisma.adapterSubmission.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(limit, 100)),
  })
  return rows.map(publicSubmission)
}

export async function getAdapterSubmissionForReview(id: string) {
  const submission = await prisma.adapterSubmission.findUnique({ where: { id } })
  if (!submission) {
    throw new AdapterSubmissionError(
      'adapter_submission_not_found',
      'Adapter submission was not found.',
      404,
    )
  }
  const content = await getObjectText(submission.objectKey)
  if (content == null) {
    throw new AdapterSubmissionError(
      'adapter_submission_file_missing',
      'Adapter submission file is missing.',
      500,
    )
  }
  return { ...publicSubmission(submission), content }
}

function normalizeSubmission(body: AdapterSubmissionInput) {
  if (body.filename !== ADAPTER_SUBMISSION_FILENAME || typeof body.content !== 'string') {
    throw new AdapterSubmissionError(
      'adapter_submission_file_invalid',
      'Submission accepts exactly one UTF-8 text file named adapter.mjs.',
    )
  }
  const scan = scanAdapterSubmissionSource(body.content)
  if (scan.byteSize === 0 || scan.byteSize > ADAPTER_SUBMISSION_MAX_BYTES) {
    throw new AdapterSubmissionError(
      'adapter_submission_size_invalid',
      'adapter.mjs exceeds the allowed UTF-8 size.',
    )
  }
  if (!scan.ok) {
    throw new AdapterSubmissionError(
      'adapter_submission_sensitive_content',
      'Submission contains credentials, environment values, absolute paths or private content.',
      400,
      scan.issues,
    )
  }
  const sha256 = boundedString(body.sha256, 'sha256', 64)
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new AdapterSubmissionError('adapter_submission_fingerprint_invalid', 'Invalid SHA-256.')
  }
  const observed = crypto.createHash('sha256').update(body.content, 'utf8').digest('hex')
  if (observed !== sha256) {
    throw new AdapterSubmissionError(
      'adapter_submission_fingerprint_mismatch',
      'The submitted file does not match its checked fingerprint.',
    )
  }
  const models = Array.isArray(body.models)
    ? body.models.map((model) => boundedString(model, 'model', 255))
    : []
  if (models.length === 0 || models.length > 100 || new Set(models).size !== models.length) {
    throw new AdapterSubmissionError(
      'adapter_submission_check_invalid',
      'A valid checked model summary is required.',
    )
  }
  const defaultModel = boundedString(body.defaultModel, 'defaultModel', 255)
  if (!models.includes(defaultModel)) {
    throw new AdapterSubmissionError(
      'adapter_submission_check_invalid',
      'The checked default model is not in the model list.',
    )
  }
  const checkedAt = new Date(boundedString(body.checkedAt, 'checkedAt', 64))
  if (!Number.isFinite(checkedAt.getTime())) {
    throw new AdapterSubmissionError('adapter_submission_check_invalid', 'Invalid check timestamp.')
  }
  const platform = boundedString(body.platform, 'platform', 32)
  if (!['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd'].includes(platform)) {
    throw new AdapterSubmissionError('adapter_submission_platform_invalid', 'Invalid platform.')
  }
  return {
    content: body.content,
    byteSize: scan.byteSize,
    sha256,
    targetAgent: boundedString(body.targetAgent, 'targetAgent', 191),
    adapterName: boundedString(body.adapterName, 'adapterName', 191),
    adapterVersion: boundedString(body.adapterVersion, 'adapterVersion', 64),
    clientVersion: boundedString(body.clientVersion, 'clientVersion', 64),
    platform,
    checkedAt,
    models,
    defaultModel,
  }
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new AdapterSubmissionError('adapter_submission_metadata_invalid', field + ' is required.')
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AdapterSubmissionError('adapter_submission_metadata_invalid', field + ' is invalid.')
  }
  return normalized
}

function publicSubmission(submission: {
  id: string
  userId: string | null
  machineId: string | null
  status: string
  filename: string
  byteSize: number
  sha256: string
  targetAgent: string
  adapterName: string
  adapterVersion: string
  clientVersion: string
  platform: string
  checkedAt: Date
  checkSummary: unknown
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: submission.id,
    userId: submission.userId,
    machineId: submission.machineId,
    status: submission.status,
    filename: submission.filename,
    byteSize: submission.byteSize,
    sha256: submission.sha256,
    targetAgent: submission.targetAgent,
    adapterName: submission.adapterName,
    adapterVersion: submission.adapterVersion,
    clientVersion: submission.clientVersion,
    platform: submission.platform,
    checkedAt: submission.checkedAt.toISOString(),
    checkSummary: submission.checkSummary,
    createdAt: submission.createdAt.toISOString(),
    updatedAt: submission.updatedAt.toISOString(),
    officialAdapterRegistered: false,
  }
}
