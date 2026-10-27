// @arch open-source/docs/server-runtime.md
// @test src/__tests__/login-intent-qr.test.ts
import { approveLoginIntentQr } from "../services/login-intent-qr.js";
import { LoginIntentError } from "../services/login-intents.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import {
  registerAuthDecorators,
  requireActivePlan,
  requireAuth,
  requireUserOrMachineAuth,
} from "../middleware/auth.js";
import {
  isReviewAccountUserId,
  requireNonReviewMachineAccess,
} from "../services/review-account-policy.js";
import { signMachineToken } from "../services/jwt.js";
import { cleanupRetiredExternalChannelMachineData } from "../services/retired-external-channel-data.js";
import { removeOwnedMachine } from "../services/machine-removal.js";
import { personalAccountNamespaceId } from "../services/personal-account-namespace.js";
import { connections } from "../relay/connections.js";
import { publishMachineAccessRevoked } from '../relay/connection-control.js'
import { SESSION_SYNC_DATA_EPOCH } from "@shennian/wire";

export {
  setMachineOnline,
  setMachineOffline,
  setMachineCliVersion,
  setMachineAgentList,
  setMachineAgents,
} from "../services/machine-status.js";

function generatePairToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const segment = () =>
    Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  return `sn-${segment()}-${segment()}-${segment()}`;
}

function countConfiguredAgents(agents: unknown): number {
  if (!Array.isArray(agents)) return 0;
  return agents.filter((agent) => {
    if (!agent || typeof agent !== "object") return false;
    const config = (agent as { config?: { status?: string } }).config;
    return config?.status && config.status !== "missing";
  }).length;
}

export async function machineRoutes(app: FastifyInstance) {
  registerAuthDecorators(app);

  app.get(
    "/identity",
    { preHandler: [requireUserOrMachineAuth, requireNonReviewMachineAccess] },
    async (request, reply) => {
      if (!request.machineId || !request.userId) {
        return reply.code(403).send({ error: "machine_auth_required" });
      }
      const machine = await prisma.machine.findUnique({
        where: { id: request.machineId },
        select: { daemonInstallationId: true },
      });
      if (!machine?.daemonInstallationId) {
        return reply.code(409).send({ error: "upgrade_required" });
      }
      return {
        machineId: request.machineId,
        daemonInstallationId: machine.daemonInstallationId,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
      };
    },
  );

  app.post<{
    Body: { machineId?: string; name: string; os: string; agentList?: string[] };
  }>(
    "/desktop/register",
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      const { machineId, name, os, agentList } = request.body;
      if (!name || !os) {
        return reply.code(400).send({ error: "name and os are required" });
      }

      const existing = machineId
        ? await prisma.machine.findUnique({ where: { id: machineId } })
        : null;
      if (existing?.userId && existing.userId !== request.userId) {
        return reply.code(403).send({ error: "Machine belongs to another account" });
      }

      const machine = existing
        ? await prisma.machine.update({
            where: { id: existing.id },
            data: {
              userId: request.userId,
              os,
              agentList: agentList ?? [],
              paired: true,
              pairToken: null,
              machineToken: existing.machineToken ?? signMachineToken(existing.id),
            },
          })
        : await prisma.machine.create({
            data: {
              userId: request.userId,
              name,
              os,
              agentList: agentList ?? [],
              paired: true,
            },
          });

      if (!machine.machineToken) {
        const correctedToken = signMachineToken(machine.id);
        const updated = await prisma.machine.update({
          where: { id: machine.id },
          data: { machineToken: correctedToken },
        });
        return {
          machine: {
            id: updated.id,
            name: updated.name,
            os: updated.os,
            agentList: updated.agentList,
          },
          machineToken: correctedToken,
          accountNamespaceId: personalAccountNamespaceId(request.userId),
        };
      }

      return {
        machine: {
          id: machine.id,
          name: machine.name,
          os: machine.os,
          agentList: machine.agentList,
        },
        machineToken: machine.machineToken,
        accountNamespaceId: personalAccountNamespaceId(request.userId),
      };
    },
  );

  app.post<{
    Body: { name: string; os: string; agentList: string[]; daemonInstallationId: string };
  }>(
    "/pair/create",
    async (request, reply) => {
      const { name, os, agentList, daemonInstallationId } = request.body;
      if (!name || !os || !daemonInstallationId || daemonInstallationId.length > 191) {
        return reply.code(400).send({ error: "name, os and daemonInstallationId are required" });
      }

      const pairToken = generatePairToken();

      const existingInstallation = await prisma.machine.findUnique({
        where: { daemonInstallationId },
      });
      const machine = existingInstallation
        ? await prisma.machine.update({
            where: { id: existingInstallation.id },
            data: { name, os, agentList: agentList ?? [], pairToken },
          })
        : await prisma.machine.create({
            data: {
              name,
              os,
              agentList: agentList ?? [],
              daemonInstallationId,
              pairToken,
            },
          });

      await prisma.qrSession.create({
        data: {
          token: pairToken,
          type: "pair",
          machineId: machine.id,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      return { pairToken, machineId: machine.id };
    },
  );

  app.post<{ Body: { pairToken: string } }>(
    "/pair/claim",
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      const { pairToken } = request.body;
      if (!pairToken) {
        return reply.code(400).send({ error: "pairToken is required" });
      }

      // Keep the published mobile scanner's pair: payload and endpoint intact.
      if (typeof pairToken === "string" && pairToken.startsWith("auth-")) {
        try { return await approveLoginIntentQr(pairToken, request.userId); }
        catch (error) {
          if (error instanceof LoginIntentError) {
            return reply.code(error.statusCode).send({ error: error.code });
          }
          throw error;
        }
      }

      const session = await prisma.qrSession.findFirst({
        where: {
          token: pairToken,
          type: "pair",
          status: "pending",
          expiresAt: { gt: new Date() },
        },
      });
      if (!session) {
        return reply.code(400).send({ error: "Invalid or expired pair token" });
      }

      const machine = await prisma.machine.findFirst({
        where: { pairToken },
      });
      if (!machine) {
        return reply.code(400).send({ error: "Machine not found" });
      }

      const targetId = machine.id;
      const machineToken = signMachineToken(targetId);
      const updated = await prisma.$transaction(async (tx) => {
        const target = await tx.machine.update({
          where: { id: targetId },
          data: {
            userId: request.userId,
            name: machine.name,
            os: machine.os,
            agentList: machine.agentList ?? [],
            daemonInstallationId: machine.daemonInstallationId,
            paired: true,
            pairToken: null,
            machineToken,
          },
        });
        await tx.qrSession.update({
          where: { id: session.id },
          data: { status: "confirmed", userId: request.userId, machineId: targetId },
        });
        if (machine.userId && machine.userId !== request.userId) {
          await tx.machineGrant.deleteMany({ where: { machineId: targetId } });
          await tx.nianSession.deleteMany({
            where: {
              machineId: targetId,
              roomBinding: { is: null },
              roomNativeSources: { none: {} },
            },
          });
        }
        return target;
      });

      if (machine.userId && machine.userId !== request.userId) {
        connections.getMachine(targetId)?.close(4403, 'ownership_transferred');
        for (const client of connections.getClients(targetId) ?? []) {
          client.close(4403, 'ownership_transferred');
        }
        connections.removeMachine(targetId);
        await redis.del(`machine:${targetId}:region`);
      }

      return {
        machine: {
          id: updated.id,
          name: updated.name,
          os: updated.os,
          agentList: updated.agentList,
        },
      };
    },
  );

  app.get<{ Querystring: { token: string } }>(
    "/pair/status",
    async (request, reply) => {
      const { token } = request.query;
      if (!token) {
        return reply.code(400).send({ error: "token is required" });
      }

      const session = await prisma.qrSession.findFirst({
        where: { token, type: "pair" },
      });
      if (!session) {
        return reply.code(404).send({ error: "Token not found" });
      }

      if (session.status === "pending") {
        if (session.expiresAt < new Date()) {
          return reply.code(410).send({ error: "Token expired" });
        }
        return { status: "pending" };
      }

      if (session.status === "confirmed" && session.machineId) {
        const machine = await prisma.machine.findUnique({
          where: { id: session.machineId },
          select: { machineToken: true, name: true, id: true, userId: true },
        });
        if (machine?.machineToken && machine.userId) {
          return {
            status: "claimed",
            machineToken: machine.machineToken,
            machineId: machine.id,
            machineName: machine.name,
            accountNamespaceId: personalAccountNamespaceId(machine.userId),
          };
        }
      }

      return { status: session.status };
    },
  );

  app.get(
    "/",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (await isReviewAccountUserId(request.userId)) return { machines: [] };
      await requireActivePlan(request, reply);
      if (reply.sent) return;
      const [ownedRaw, grants] = await Promise.all([
        prisma.machine.findMany({
          where: { userId: request.userId, paired: true },
          select: {
            id: true,
            name: true,
            os: true,
            agentList: true,
            agents: true,
            paired: true,
            online: true,
            lastSeen: true,
            cliVersion: true,
            sessionSyncProtocolVersion: true,
            sessionSyncDataEpoch: true,
            sessionSyncCapabilities: true,
            daemonInstallationId: true,
            autoUpgrade: true,
            remoteAccessDisabledAt: true,
          },
          orderBy: { lastSeen: "desc" },
        }),
        prisma.machineGrant.findMany({
          where: {
            granteeId: request.userId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          include: {
            machine: {
              select: {
                id: true,
                name: true,
                os: true,
                agentList: true,
                agents: true,
                paired: true,
                online: true,
                lastSeen: true,
                cliVersion: true,
                sessionSyncProtocolVersion: true,
                sessionSyncDataEpoch: true,
                sessionSyncCapabilities: true,
                daemonInstallationId: true,
                autoUpgrade: true,
                remoteAccessDisabledAt: true,
                user: {
                  select: { name: true, phone: true, email: true },
                },
              },
            },
          },
        }),
      ]);

      const ownedIdsForCounts = ownedRaw.map((m) => m.id);
      const activeMachineGrants = ownedIdsForCounts.length
        ? await prisma.machineGrant.findMany({
            where: {
              machineId: { in: ownedIdsForCounts },
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: { machineId: true, granteeId: true, grantee: { select: { name: true } } },
          })
        : [];
      const shareSummary = new Map<string, { names: string[]; pending: number }>();
      for (const grant of activeMachineGrants) {
        const summary = shareSummary.get(grant.machineId) ?? { names: [], pending: 0 };
        if (grant.granteeId && grant.grantee?.name) summary.names.push(grant.grantee.name);
        else if (!grant.granteeId) summary.pending += 1;
        shareSummary.set(grant.machineId, summary);
      }
      const enrichMachine = async (
        m: (typeof ownedRaw)[number],
        extra?: Record<string, unknown>,
      ) => {
        const region = m.online
          ? await redis.get(`machine:${m.id}:region`)
          : null;
        return {
          ...m,
          configuredAgentCount: countConfiguredAgents(m.agents),
          sharedCount: shareSummary.get(m.id)?.names.length ?? 0,
          sharedWith: shareSummary.get(m.id)?.names ?? [],
          pendingShareCount: shareSummary.get(m.id)?.pending ?? 0,
          region: region ?? undefined,
          role: "owner" as const,
          ...extra,
        };
      };

      const ownedEnriched = await Promise.all(ownedRaw.map((m) => enrichMachine(m)));

      const ownedIds = new Set(ownedRaw.map((m) => m.id));
      const grantedEnriched = await Promise.all(
        grants
          .filter((g) => !ownedIds.has(g.machine.id))
          .map(async (g) => {
            const { user: owner, ...sharedMachine } = g.machine;
            const region = g.machine.online
              ? await redis.get(`machine:${g.machine.id}:region`)
              : null;
            return {
              ...sharedMachine,
              configuredAgentCount: countConfiguredAgents(g.machine.agents),
              sharedCount: 0,
              region: region ?? undefined,
              role: "granted" as const,
              permission: g.permission,
              ownerName: owner?.name ?? null,
            };
          }),
      );

      return { machines: [...ownedEnriched, ...grantedEnriched] };
    },
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/:id",
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      const { name } = request.body;
      if (!name) {
        return reply.code(400).send({ error: "name is required" });
      }

      const machine = await prisma.machine.findUnique({
        where: { id: request.params.id },
      });
      if (!machine || machine.userId !== request.userId) {
        return reply.code(404).send({ error: "Machine not found" });
      }

      const updated = await prisma.machine.update({
        where: { id: machine.id },
        data: { name },
      });

      return {
        machine: {
          id: updated.id,
          name: updated.name,
          os: updated.os,
          agentList: updated.agentList,
          paired: updated.paired,
          online: updated.online,
          lastSeen: updated.lastSeen,
        },
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      const machineId = request.params.id;

      // Check if user owns the machine
      const machine = await prisma.machine.findUnique({
        where: { id: machineId },
      });

      if (machine && machine.userId === request.userId) {
        // Unbinding is reversible for the same account + daemon installation.
        // Keep the stable Machine identity, deletion revision and cloud index;
        // only revoke credentials and hide it from the active machine list.
        await removeOwnedMachine(machineId, request.userId);
        await cleanupRetiredExternalChannelMachineData(machineId).catch(() => undefined);
        return { ok: true };
      }

      // Not an owner — check if user has a grant
      const grant = await prisma.machineGrant.findFirst({
        where: { machineId, granteeId: request.userId, revokedAt: null },
      });

      if (grant) {
        // Grantee: revoke only this user's grant
        await prisma.machineGrant.update({
          where: { id: grant.id },
          data: { revokedAt: new Date() },
        });
        publishMachineAccessRevoked(machineId, request.userId)
        return { ok: true };
      }

      return reply.code(404).send({ error: "Machine not found" });
    },
  );
}
