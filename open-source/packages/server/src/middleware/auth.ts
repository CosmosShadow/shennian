import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { verifyMachineToken, verifyToken } from '../services/jwt.js'
import { prisma } from '../lib/prisma.js'
import { PlanAccessError, requirePlanAccess } from '../services/plan-access.js'

const DEVICE_ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
    deviceId: string
    machineId: string
  }
}

export function registerAuthDecorators(app: FastifyInstance) {
  app.decorateRequest('userId', '')
  app.decorateRequest('deviceId', '')
  app.decorateRequest('machineId', '')
}

async function touchDeviceActivity(device: { id: string; lastActiveAt: Date }): Promise<void> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - DEVICE_ACTIVITY_TOUCH_INTERVAL_MS)
  if (device.lastActiveAt >= staleBefore) return
  await prisma.device.updateMany({
    where: { id: device.id, lastActiveAt: { lt: staleBefore } },
    data: { lastActiveAt: now },
  })
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing token' })
  }

  const token = header.slice(7)
  const payload = verifyToken(token)
  if (!payload) {
    return reply.code(401).send({ error: 'Invalid token' })
  }

  const device = await prisma.device.findUnique({
    where: { id: payload.deviceId },
  })

  if (!device || device.tokenExpiry < new Date() || device.platform === 'web') {
    return reply.code(401).send({ error: 'Token expired' })
  }

  await touchDeviceActivity(device).catch(() => {})

  request.userId = payload.userId
  request.deviceId = payload.deviceId
}

export async function requireActivePlan(request: FastifyRequest, reply: FastifyReply) {
  try {
    await requirePlanAccess(request.userId)
  } catch (error) {
    if (error instanceof PlanAccessError) {
      return reply.code(402).send({ error: error.code })
    }
    throw error
  }
}

export async function requireUserOrMachineAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing token' })
  }

  const token = header.slice(7)
  const userPayload = verifyToken(token)
  if (userPayload) {
    const device = await prisma.device.findUnique({
      where: { id: userPayload.deviceId },
    })
    if (!device || device.tokenExpiry < new Date() || device.platform === 'web') {
      return reply.code(401).send({ error: 'Token expired' })
    }
    await touchDeviceActivity(device).catch(() => {})
    request.userId = userPayload.userId
    request.deviceId = userPayload.deviceId
    return
  }

  const machinePayload = verifyMachineToken(token)
  if (!machinePayload) {
    return reply.code(401).send({ error: 'Invalid token' })
  }
  const machine = await prisma.machine.findUnique({
    where: { machineToken: token },
    select: { id: true, userId: true },
  })
  if (!machine?.userId || machine.id !== machinePayload.machineId) {
    return reply.code(401).send({ error: 'Machine not found' })
  }
  request.userId = machine.userId
  request.machineId = machine.id
}
