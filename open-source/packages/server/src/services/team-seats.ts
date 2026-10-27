// @arch open-source/docs/server-runtime.md
// @test src/__tests__/team-seats.test.ts src/__tests__/entitlements.test.ts

import { prisma } from "../lib/prisma.js";

export const TEAM_INCLUDED_SEATS = 5;

type TeamSeatClient = {
  billingSubscription: {
    findMany: (args: unknown) => Promise<Array<{ id: string; productId: string; seatCount: number; expiresAt: Date | null }>>;
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  organization: {
    findMany: (args: unknown) => Promise<Array<{
      id: string;
      members: Array<{ id: string; userId: string; role: string; createdAt: Date }>;
    }>>;
  };
  organizationMember: {
    findMany: (args: unknown) => Promise<Array<{ organization: { ownerId: string } }>>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export function seatsForSubscription(subscription: { productId: string; seatCount: number }): number {
  if (subscription.seatCount > 0) return subscription.seatCount;
  if (subscription.productId === "team_monthly") return TEAM_INCLUDED_SEATS;
  if (subscription.productId === "team_extra_seat_monthly") return 1;
  return 0;
}

export async function refreshTeamSeatsForOwner(params: { ownerId: string; now?: Date; tx?: TeamSeatClient }) {
  const client = (params.tx ?? prisma) as TeamSeatClient;
  const now = params.now ?? new Date();
  const [subscriptions, organizations] = await Promise.all([
    client.billingSubscription.findMany({
      where: {
        userId: params.ownerId,
        status: "active",
        kind: { in: ["tier:enterprise", "team_seat"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, productId: true, seatCount: true, expiresAt: true },
      orderBy: { createdAt: "asc" },
    }),
    client.organization.findMany({
      where: { ownerId: params.ownerId },
      select: {
        id: true,
        members: {
          select: { id: true, userId: true, role: true, createdAt: true },
          orderBy: [{ role: "desc" }, { createdAt: "asc" }],
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const capacity = subscriptions.reduce((sum, subscription) => sum + seatsForSubscription(subscription), 0);
  const expiresAtCandidates = subscriptions.map((subscription) => subscription.expiresAt).filter((date): date is Date => Boolean(date));
  const seatExpiresAt = expiresAtCandidates.length > 0
    ? new Date(Math.max(...expiresAtCandidates.map((date) => date.getTime())))
    : null;

  let active = 0;
  let overLimit = 0;
  let expired = 0;
  let index = 0;
  for (const organization of organizations) {
    const members = [...organization.members].sort((a, b) => {
      if (a.role === "owner" && b.role !== "owner") return -1;
      if (a.role !== "owner" && b.role === "owner") return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    for (const member of members) {
      const withinCapacity = index < capacity;
      const seatStatus = capacity <= 0 ? "expired" : withinCapacity ? "active" : "over_limit";
      await client.organizationMember.update({
        where: { id: member.id },
        data: {
          seatStatus,
          seatSource: capacity <= 0 ? null : "team_subscription",
          seatExpiresAt,
        },
      });
      if (seatStatus === "active") active += 1;
      else if (seatStatus === "over_limit") overLimit += 1;
      else expired += 1;
      index += 1;
    }
  }

  return { ownerId: params.ownerId, capacity, active, overLimit, expired };
}

export async function hasActiveTeamSeat(userId: string, now = new Date()): Promise<boolean> {
  const memberships = await prisma.organizationMember.findMany({
    where: {
      userId,
      seatStatus: "active",
      OR: [{ seatExpiresAt: null }, { seatExpiresAt: { gt: now } }],
    },
    select: { organization: { select: { ownerId: true } } },
  });
  const ownerIds = [...new Set(memberships.map((member) => member.organization.ownerId).filter((ownerId) => ownerId !== userId))];
  if (ownerIds.length === 0) return false;

  const activeTeamSubscription = await prisma.billingSubscription.findFirst({
    where: {
      userId: { in: ownerIds },
      status: "active",
      kind: "tier:enterprise",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  return Boolean(activeTeamSubscription);
}
