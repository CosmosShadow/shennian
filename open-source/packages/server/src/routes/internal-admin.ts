// @arch open-source/docs/server-runtime.md
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/entitlements.test.ts

import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import {
  buildEntitlements,
  normalizeAccountTier,
  publicEntitledUser,
  type AccountTier,
} from "../services/entitlements.js";
import { getRoomOperationsSnapshot } from '../services/room-operations.js'
import { runRoomAttachmentMaintenance } from '../jobs/room-attachment-maintenance.js'
import { getPersonalSyncOperationsSnapshot } from '../services/personal-sync-operations.js'
import {
  AdapterSubmissionError,
  getAdapterSubmissionForReview,
  listAdapterSubmissionsForReview,
} from '../services/adapter-submissions.js'

function getAdminToken(): string {
  return process.env.SHENNIAN_ADMIN_TOKEN?.trim() || process.env.ADMIN_TOKEN?.trim() || "";
}

function isAuthorized(request: FastifyRequest): boolean {
  const configured = getAdminToken();
  if (!configured) return false;
  const header = request.headers["x-admin-token"];
  return typeof header === "string" && header === configured;
}

function readFlags(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export async function internalAdminRoutes(app: FastifyInstance) {
  app.get('/adapter-submissions', async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.code(401).send({ error: 'Admin token required' })
    }
    return { submissions: await listAdapterSubmissionsForReview() }
  })

  app.get<{ Params: { submissionId: string } }>(
    '/adapter-submissions/:submissionId',
    async (request, reply) => {
      if (!isAuthorized(request)) {
        return reply.code(401).send({ error: 'Admin token required' })
      }
      try {
        return { submission: await getAdapterSubmissionForReview(request.params.submissionId) }
      } catch (error) {
        if (error instanceof AdapterSubmissionError) {
          return reply.code(error.statusCode).send({ error: error.code, message: error.message })
        }
        throw error
      }
    },
  )

  app.get('/personal-sync/health', async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.code(401).send({ error: 'Admin token required' })
    }
    return getPersonalSyncOperationsSnapshot()
  })

  app.get('/rooms/health', async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.code(401).send({ error: 'Admin token required' })
    }
    return getRoomOperationsSnapshot()
  })

  app.post('/rooms/maintenance', async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.code(401).send({ error: 'Admin token required' })
    }
    return { report: await runRoomAttachmentMaintenance() }
  })

  app.post<{
    Params: { userId: string };
    Body: { accountTier: AccountTier };
  }>("/users/:userId/tier", async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.code(401).send({ error: "Admin token required" });
    }

    const accountTier = normalizeAccountTier(request.body.accountTier);
    const updated = await prisma.user.update({
      where: { id: request.params.userId },
      data: { accountTier },
    });

    return {
      user: publicEntitledUser(updated),
      entitlements: buildEntitlements(updated.accountTier, updated.entitlementFlags),
    };
  });

  app.post<{
    Params: { userId: string };
    Body: { managedWeCom?: boolean };
  }>("/users/:userId/addons", async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.code(401).send({ error: "Admin token required" });
    }

    const current = await prisma.user.findUnique({ where: { id: request.params.userId } });
    if (!current) return reply.code(404).send({ error: "User not found" });
    const flags = readFlags(current.entitlementFlags);
    if (typeof request.body.managedWeCom === "boolean") flags.managed_wecom = request.body.managedWeCom;
    const updated = await prisma.user.update({
      where: { id: request.params.userId },
      data: { entitlementFlags: flags as never },
    });
    return {
      user: publicEntitledUser(updated),
      entitlements: buildEntitlements(updated.accountTier, updated.entitlementFlags),
    };
  });
}
