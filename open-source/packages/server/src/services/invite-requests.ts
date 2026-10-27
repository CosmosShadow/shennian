// @arch open-source/docs/server-runtime.md
// @test private/official-server/src/__tests__/billing-routes.test.ts

import { redis } from "../lib/redis.js";

export type InviteAccessRequest = {
  id: string;
  phone?: string | null;
  contact?: string | null;
  note?: string | null;
  source?: string | null;
  status: "pending";
  createdAt: string;
};

const LIST_KEY = "billing:invite-access-requests";
const DEDUPE_PREFIX = "billing:invite-access-request:";
const MAX_RECENT_REQUESTS = 200;
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

function normalizePhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11) return `+86${digits}`;
  if (digits.startsWith("86") && digits.length === 13) return `+${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+86${digits}`;
  return `+${digits}`;
}

function normalizeText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : null;
}

function requestKey(params: { phone?: string | null; contact?: string | null }): string {
  const key = params.phone || params.contact || "anonymous";
  return `${DEDUPE_PREFIX}${key.toLowerCase()}`;
}

export async function createInviteAccessRequest(params: {
  phone?: string | null;
  contact?: string | null;
  note?: string | null;
  source?: string | null;
}): Promise<{ request: InviteAccessRequest; duplicate: boolean }> {
  const phone = normalizePhone(params.phone);
  const contact = normalizeText(params.contact, 120);
  const note = normalizeText(params.note, 500);
  const source = normalizeText(params.source, 80) ?? "web";
  if (!phone && !contact) {
    const error = new Error("phone_or_contact_required");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }

  const dedupeKey = requestKey({ phone, contact });
  const existing = await redis.get(dedupeKey);
  if (existing) {
    return { request: JSON.parse(existing) as InviteAccessRequest, duplicate: true };
  }

  const request: InviteAccessRequest = {
    id: `iar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    phone,
    contact,
    note,
    source,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  const payload = JSON.stringify(request);
  await redis
    .multi()
    .set(dedupeKey, payload, "EX", DEDUPE_TTL_SECONDS)
    .lpush(LIST_KEY, payload)
    .ltrim(LIST_KEY, 0, MAX_RECENT_REQUESTS - 1)
    .exec();
  return { request, duplicate: false };
}
