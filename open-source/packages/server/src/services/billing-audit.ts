// @arch open-source/docs/server-runtime.md
// @test private/official-server/src/__tests__/billing.test.ts src/__tests__/invites.test.ts

import { prisma } from "../lib/prisma.js";

type BillingAuditTx = Pick<typeof prisma, "billingAuditLog">;

export type BillingAuditAction =
  | "order_paid"
  | "promotion_reward_awarded"
  | "billing_maintenance";

export async function recordBillingAuditLog(params: {
  tx?: BillingAuditTx;
  userId?: string | null;
  action: BillingAuditAction;
  refType?: string | null;
  refId?: string | null;
  actor?: string | null;
  metadata?: unknown;
}) {
  const client = (params.tx ?? prisma) as BillingAuditTx;
  return client.billingAuditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      refType: params.refType ?? null,
      refId: params.refId ?? null,
      actor: params.actor ?? null,
      metadata: params.metadata as never,
    },
  });
}
