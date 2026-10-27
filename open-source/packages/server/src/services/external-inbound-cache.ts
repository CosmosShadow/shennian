// @arch open-source/docs/server-runtime.md
// @test src/__tests__/external-inbound-cache.test.ts

import {
  formatExternalAttachmentReference,
  formatExternalConversationText,
  formatExternalMessageLine,
} from "@shennian/wire";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const DEFAULT_CONTEXT_LIMIT = 30;
const DEFAULT_CONTEXT_WINDOW_MINUTES = 60;

export type CachedExternalAttachment = {
  type: "image" | "video" | "audio" | "file" | string;
  name?: string;
  mimeType?: string;
  size?: number;
  url?: string;
  localPath?: string;
  thumbnailPath?: string;
  hash?: string;
  availability?: string;
  machineId?: string;
  expiresAt?: string;
  providerError?: string;
};

export type ExternalInboundCacheInput = {
  userId: string;
  bindingId: string;
  sessionId: string;
  provider: "wecom" | "feishu" | string;
  externalAccountId: string;
  externalConversationId: string;
  externalMessageId: string;
  conversationName: string;
  conversationType: "group" | "dm" | string;
  senderId: string;
  senderName: string;
  text: string;
  attachments: CachedExternalAttachment[];
  isMention: boolean;
  rawRef?: string | null;
  receivedAt: Date;
};

export type ExternalContextMessage = {
  text: string;
  attachments: Array<{ path: string; name: string; mimeType: string }>;
  messageCount: number;
};

function contextLimit(): number {
  const value = Number(process.env.EXTERNAL_INBOUND_CONTEXT_LIMIT || DEFAULT_CONTEXT_LIMIT);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 100) : DEFAULT_CONTEXT_LIMIT;
}

function contextWindowMs(): number {
  const value = Number(process.env.EXTERNAL_INBOUND_CONTEXT_WINDOW_MINUTES || DEFAULT_CONTEXT_WINDOW_MINUTES);
  const minutes = Number.isFinite(value) && value > 0 ? Math.min(value, 24 * 60) : DEFAULT_CONTEXT_WINDOW_MINUTES;
  return minutes * 60 * 1000;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value).replace(/\//g, "-");
}

function normalizeAttachments(value: unknown): CachedExternalAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : "file";
      const name = typeof record.name === "string" ? record.name : "";
      const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";
      const url = typeof record.url === "string" ? record.url : "";
      const localPath = typeof record.localPath === "string" ? record.localPath : "";
      const thumbnailPath = typeof record.thumbnailPath === "string" ? record.thumbnailPath : "";
      const hash = typeof record.hash === "string" ? record.hash : "";
      const availability = typeof record.availability === "string" ? record.availability : "";
      const machineId = typeof record.machineId === "string" ? record.machineId : "";
      const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : "";
      const providerError = typeof record.providerError === "string" ? record.providerError : "";
      const size = Number(record.size || 0);
      return {
        type,
        ...(name ? { name } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(url ? { url } : {}),
        ...(localPath ? { localPath } : {}),
        ...(thumbnailPath ? { thumbnailPath } : {}),
        ...(hash ? { hash } : {}),
        ...(availability ? { availability } : {}),
        ...(machineId ? { machineId } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(Number.isFinite(size) && size > 0 ? { size } : {}),
        ...(providerError ? { providerError } : {}),
      };
    })
    .filter((item): item is CachedExternalAttachment => item != null);
}

function providerSafeAttachments(provider: string, attachments: CachedExternalAttachment[]): CachedExternalAttachment[] {
  if (provider !== "wechat-rpa") return attachments;
  return attachments.map((attachment) => {
    const keepUrl = attachment.url && attachment.availability === "server-url";
    return {
      type: attachment.type,
      ...(attachment.name ? { name: attachment.name } : {}),
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(Number.isFinite(attachment.size) && Number(attachment.size) > 0 ? { size: attachment.size } : {}),
      ...(keepUrl ? { url: attachment.url } : {}),
      ...(attachment.hash ? { hash: attachment.hash } : {}),
      ...(attachment.availability ? { availability: attachment.availability } : {}),
      ...(attachment.machineId ? { machineId: attachment.machineId } : {}),
      ...(attachment.expiresAt ? { expiresAt: attachment.expiresAt } : {}),
      ...(attachment.providerError ? { providerError: attachment.providerError } : {}),
    };
  });
}

function attachmentLines(attachments: CachedExternalAttachment[]): string[] {
  return attachments.map((attachment, index) => formatExternalAttachmentReference({
    type: attachment.type,
    name: attachment.name,
    path: attachment.url || attachment.localPath || attachment.thumbnailPath,
    mimeType: attachment.mimeType,
    availability: attachment.availability || (attachment.localPath ? "edge-local" : ""),
    providerError: attachment.providerError,
  }, index));
}

function chatAttachments(provider: string, messages: Array<{ attachments: Prisma.JsonValue | null }>): Array<{ path: string; name: string; mimeType: string }> {
  const seen = new Set<string>();
  const result: Array<{ path: string; name: string; mimeType: string }> = [];
  for (const message of messages) {
    for (const attachment of providerSafeAttachments(provider, normalizeAttachments(message.attachments))) {
      const descriptor = chatAttachmentDescriptor(provider, attachment);
      if (!descriptor) continue;
      const key = `${descriptor.path}:${descriptor.name}:${descriptor.mimeType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(descriptor);
    }
  }
  return result;
}

function chatAttachmentDescriptor(provider: string, attachment: CachedExternalAttachment): { path: string; name: string; mimeType: string } | null {
  if (attachment.url) {
    return {
      path: attachment.url,
      name: attachment.name || "attachment",
      mimeType: attachment.mimeType || "application/octet-stream",
    };
  }
  if (provider === "wechat-rpa") return null;
  if (attachment.localPath && attachment.availability === "edge-local") {
    return {
      path: attachment.localPath,
      name: attachment.name || "attachment",
      mimeType: attachment.mimeType || "application/octet-stream",
    };
  }
  if (attachment.thumbnailPath && attachment.availability === "edge-local") {
    return {
      path: attachment.thumbnailPath,
      name: attachment.name ? `${attachment.name}-preview.png` : "preview.png",
      mimeType: "image/png",
    };
  }
  return null;
}

export async function cacheExternalInboundMessage(input: ExternalInboundCacheInput): Promise<void> {
  const attachments = providerSafeAttachments(input.provider, normalizeAttachments(input.attachments));
  const data = {
    userId: input.userId,
    bindingId: input.bindingId,
    sessionId: input.sessionId,
    provider: input.provider,
    externalAccountId: input.externalAccountId,
    externalConversationId: input.externalConversationId,
    externalMessageId: input.externalMessageId,
    conversationName: input.conversationName,
    conversationType: input.conversationType,
    senderId: input.senderId,
    senderName: input.senderName,
    text: input.text,
    attachments: jsonValue(attachments),
    isMention: input.isMention,
    rawRef: input.rawRef ?? null,
    receivedAt: input.receivedAt,
  };
  await prisma.externalInboundMessage.upsert({
    where: {
      provider_bindingId_externalMessageId: {
        provider: input.provider,
        bindingId: input.bindingId,
        externalMessageId: input.externalMessageId,
      },
    },
    create: data,
    update: {
      senderId: input.senderId,
      senderName: input.senderName,
      text: input.text,
      attachments: jsonValue(attachments),
      isMention: input.isMention,
      rawRef: input.rawRef ?? null,
      receivedAt: input.receivedAt,
    },
  });
}

export async function buildExternalMentionContext(input: {
  provider: string;
  bindingId: string;
  triggerMessageId: string;
  fallback: ExternalInboundCacheInput;
}): Promise<ExternalContextMessage> {
  const since = new Date(input.fallback.receivedAt.getTime() - contextWindowMs());
  const rowsDesc = await prisma.externalInboundMessage.findMany({
    where: {
      provider: input.provider,
      bindingId: input.bindingId,
      receivedAt: { gte: since, lte: input.fallback.receivedAt },
    },
    orderBy: { receivedAt: "desc" },
    take: contextLimit(),
  });
  const rows = rowsDesc.reverse();
  const contextualRows = rows.length ? rowsAfterPreviousMention(rows, input.triggerMessageId) : rows;
  const messages = contextualRows.length
    ? contextualRows
    : rows.length
      ? rows
      : [{
          ...input.fallback,
          attachments: jsonValue(input.fallback.attachments) as Prisma.JsonValue,
          createdAt: input.fallback.receivedAt,
          updatedAt: input.fallback.receivedAt,
          id: input.fallback.externalMessageId,
        }];
  const latest = messages[messages.length - 1] ?? input.fallback;
  const lines = messages.map((message) => {
    const attachments = providerSafeAttachments(input.provider, normalizeAttachments(message.attachments));
    const sender = message.senderName || message.senderId || "外部用户";
    return [
      formatExternalMessageLine({
        senderName: sender,
        senderId: message.senderId,
        text: message.text || "",
        isTrigger: message.externalMessageId === input.triggerMessageId,
        timestampLabel: formatTime(message.receivedAt),
      }),
      ...attachmentLines(attachments).map((line) => `${sender}: ${line}`),
    ].filter(Boolean).join("\n");
  });
  return {
    text: formatExternalConversationText({
      conversationName: latest.conversationName || input.fallback.conversationName,
      includeContextLabel: true,
      messages: [],
    }) + (lines.length ? `\n${lines.join("\n")}` : ""),
    attachments: chatAttachments(input.provider, messages),
    messageCount: messages.length,
  };
}

function rowsAfterPreviousMention<T extends { externalMessageId: string; isMention?: boolean | null }>(
  rows: T[],
  triggerMessageId: string,
): T[] {
  const triggerIndex = rows.findIndex((message) => message.externalMessageId === triggerMessageId);
  if (triggerIndex < 0) return rows;
  let previousMentionIndex = -1;
  for (let index = triggerIndex - 1; index >= 0; index--) {
    if (rows[index]?.isMention === true) {
      previousMentionIndex = index;
      break;
    }
  }
  return rows.slice(previousMentionIndex + 1, triggerIndex + 1);
}

export function buildSingleExternalMessage(input: ExternalInboundCacheInput): ExternalContextMessage {
  const attachments = providerSafeAttachments(input.provider, normalizeAttachments(input.attachments));
  const sender = input.senderName || input.senderId || "外部用户";
  const lines = [
    input.text
      ? formatExternalMessageLine({ senderName: sender, senderId: input.senderId, text: input.text })
      : attachments.length
        ? ""
        : formatExternalMessageLine({ senderName: sender, senderId: input.senderId }),
    ...attachmentLines(attachments).map((line) => `${sender}: ${line}`),
  ].filter(Boolean);
  return {
    text: formatExternalConversationText({
      conversationName: input.conversationName,
      messages: [],
    }) + (lines.length ? `\n${lines.join("\n")}` : ""),
    attachments: attachments
      .map((attachment) => chatAttachmentDescriptor(input.provider, attachment))
      .filter((attachment): attachment is { path: string; name: string; mimeType: string } => attachment != null),
    messageCount: 1,
  };
}
