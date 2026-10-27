import { reservePersonalModelQuota, type PersonalQuotaReservation } from './personal-model-quota.js';
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/convert-messages.test.ts src/__tests__/agent-proxy-quota.test.ts

import { PLATFORM_TEXT_MODEL, PLATFORM_TEXT_MODEL_NAME, platformTextBaseUrl } from "./platform-model.js";

import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { consumeCredits, ensureCreditsAvailable } from "./credits.js";
import { getUserEntitlements } from "./entitlements.js";
import { getBillingFeatureMode, isBillingLive } from "./billing-mode.js";
import { verifyMachineToken, verifyToken } from "./jwt.js";

export const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DASHSCOPE_DEFAULT_MODEL = PLATFORM_TEXT_MODEL;
export const DEFAULT_NIAN_DAILY_REQUEST_LIMIT = 2000;
export const DEFAULT_NIAN_PER_MINUTE_REQUEST_LIMIT = 10;
export const DEFAULT_NIAN_MAX_OUTPUT_TOKENS = 4096;
export const DEFAULT_NIAN_REQUEST_TIMEOUT_MS = 120_000;
export const NIAN_QUOTA_EXCEEDED_ERROR = "nian_quota_exceeded";
export const NIAN_INSUFFICIENT_CREDITS_ERROR = "insufficient_credits";
export const NIAN_ENTITLEMENT_REQUIRED_ERROR = "entitlement_required";
export const DESKTOP_SETUP_PROXY_PROVIDER = "shennian-desktop-setup";
const DESKTOP_SETUP_SYSTEM_PROMPT_PREFIX = "你是神念桌面端内置安装助手";


export const PI_MODELS = [
  { id: PLATFORM_TEXT_MODEL, name: PLATFORM_TEXT_MODEL_NAME, provider: "dashscope" },
  { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", provider: "dashscope" },
] as const;

const ALLOWED_MODELS = new Set<string>(PI_MODELS.map((model) => model.id));

export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image"; data: string; mimeType: string };
export type ToolCall = { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export type PiUserMessage = { role: "user"; content: string | (TextContent | ImageContent)[] };
export type PiAssistantMessage = { role: "assistant"; content: (TextContent | ToolCall)[] };
export type PiToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
};
export type PiMessage = PiUserMessage | PiAssistantMessage | PiToolResultMessage;

type PiTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export interface ProxyRequestBody {
  model: { id: string; provider: string; api: string };
  context: {
    systemPrompt?: string;
    messages: PiMessage[];
    tools?: PiTool[];
  };
  options?: {
    temperature?: number;
    maxTokens?: number;
    reasoning?: string;
  };
}

function getApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error("DASHSCOPE_API_KEY not configured");
  return key;
}

function dayStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function minuteStamp(now = new Date()): string {
  return now.toISOString().slice(0, 16);
}

function quotaKey(userId: string, metric: string, now = new Date()): string {
  return `nian:quota:${metric}:${userId}:${dayStamp(now)}`;
}

function minuteQuotaKey(userId: string, now = new Date()): string {
  return `nian:quota:requests:${userId}:${minuteStamp(now)}`;
}

function readPositiveIntEnv(name: string, fallback: number, max?: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max === undefined ? parsed : Math.min(parsed, max);
}

function readNonNegativeNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getNianQuotaConfig() {
  return {
    dailyRequestLimit: readPositiveIntEnv("NIAN_DAILY_REQUEST_LIMIT", DEFAULT_NIAN_DAILY_REQUEST_LIMIT, DEFAULT_NIAN_DAILY_REQUEST_LIMIT),
    perMinuteRequestLimit: readPositiveIntEnv("NIAN_PER_MINUTE_REQUEST_LIMIT", DEFAULT_NIAN_PER_MINUTE_REQUEST_LIMIT),
    maxOutputTokens: readPositiveIntEnv("NIAN_MAX_OUTPUT_TOKENS", DEFAULT_NIAN_MAX_OUTPUT_TOKENS),
    requestTimeoutMs: readPositiveIntEnv("NIAN_REQUEST_TIMEOUT_MS", DEFAULT_NIAN_REQUEST_TIMEOUT_MS),
  };
}

export function estimateNianInputTokens(body: ProxyRequestBody): number {
  const context = body.context ?? { messages: [] };
  return Math.max(1, Math.ceil(JSON.stringify({
    systemPrompt: context.systemPrompt ?? "",
    messages: context.messages ?? [],
    tools: context.tools ?? [],
  }).length / 3));
}

export function nianModelPricingCnyPerMillion(modelId: string) {
  const prefix = modelId.includes("flash") ? "NIAN_FLASH" : "NIAN_PLUS";
  return {
    input: readNonNegativeNumberEnv(`${prefix}_INPUT_CNY_PER_MILLION`, 0.2),
    output: readNonNegativeNumberEnv(`${prefix}_OUTPUT_CNY_PER_MILLION`, 2),
  };
}

export function creditsForNianUsage(params: {
  modelId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}) {
  const inputTokens = Math.max(0, Math.ceil(params.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.ceil(params.outputTokens ?? 0));
  const pricing = nianModelPricingCnyPerMillion(params.modelId);
  const actualCostCny = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  const creditValueCny = readNonNegativeNumberEnv("BILLING_CREDIT_VALUE_CNY", 0.01) || 0.01;
  const targetGrossMargin = Math.min(0.95, readNonNegativeNumberEnv("BILLING_TARGET_GROSS_MARGIN", 0.5));
  const userPriceCny = actualCostCny / (1 - targetGrossMargin);
  return Math.max(1, Math.ceil((userPriceCny / creditValueCny) - 1e-9));
}

export async function ensureNianHostedModelAllowed(userId: string) {
  if (!isBillingLive()) return null;
  const entitlements = await getUserEntitlements(userId);
  if (entitlements.tier !== "pro" && entitlements.tier !== "enterprise") {
    const error = new Error("Nian hosted model requests require Pro or Team.");
    (error as Error & { code?: string; statusCode?: number }).code = NIAN_ENTITLEMENT_REQUIRED_ERROR;
    (error as Error & { code?: string; statusCode?: number }).statusCode = 403;
    throw error;
  }
  return ensureCreditsAvailable(userId);
}

export async function chargeNianHostedModelUsage(params: {
  userId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  usageRefId: string;
}) {
  if (!isBillingLive()) return null;
  const credits = creditsForNianUsage(params);
  await consumeCredits({
    userId: params.userId,
    amount: credits,
    reason: "nian_model_request",
    refType: "nian_proxy",
    refId: params.usageRefId,
    metadata: {
      billingMode: getBillingFeatureMode(),
      modelId: params.modelId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
    },
  });
  return { creditsCharged: credits };
}

type QuotaRedis = Pick<typeof redis, "get" | "incr" | "incrby" | "expire">;

export type NianQuotaDecision =
  | { allowed: true; estimatedInputTokens: number; used: { dailyRequests: number; minuteRequests: number } }
  | { allowed: false; statusCode: number; code: string; message: string; limit: number; used: number; retryAfterSeconds?: number };

async function incrementWithExpiry(store: QuotaRedis, key: string, amount: number, ttlSeconds: number): Promise<number> {
  const next = amount === 1 ? await store.incr(key) : await store.incrby(key, amount);
  if (next === amount) await store.expire(key, ttlSeconds);
  return next;
}

export async function reserveNianQuota(
  userId: string,
  body: ProxyRequestBody,
  store: QuotaRedis = redis,
  now = new Date(),
): Promise<NianQuotaDecision> {
  const config = getNianQuotaConfig();
  const estimatedInputTokens = estimateNianInputTokens(body);

  const dailyRequestsKey = quotaKey(userId, "daily-requests", now);
  const minuteRequestsKey = minuteQuotaKey(userId, now);

  const [dailyRequestsRaw, minuteRequestsRaw] = await Promise.all([
    store.get(dailyRequestsKey),
    store.get(minuteRequestsKey),
  ]);
  const dailyRequests = Number.parseInt(dailyRequestsRaw ?? "0", 10) || 0;
  const minuteRequests = Number.parseInt(minuteRequestsRaw ?? "0", 10) || 0;

  if (dailyRequests >= config.dailyRequestLimit) {
    return {
      allowed: false,
      statusCode: 429,
      code: NIAN_QUOTA_EXCEEDED_ERROR,
      message: `Nian 今日额度已用完（${dailyRequests}/${config.dailyRequestLimit} 次模型请求），次日自动恢复。`,
      used: dailyRequests,
      limit: config.dailyRequestLimit,
    };
  }
  if (minuteRequests >= config.perMinuteRequestLimit) {
    return {
      allowed: false,
      statusCode: 429,
      code: NIAN_QUOTA_EXCEEDED_ERROR,
      message: `Nian is receiving requests too quickly (${minuteRequests}/${config.perMinuteRequestLimit} per minute). Please wait and try again.`,
      used: minuteRequests,
      limit: config.perMinuteRequestLimit,
      retryAfterSeconds: 60,
    };
  }

  const [nextDailyRequests, nextMinuteRequests] = await Promise.all([
    incrementWithExpiry(store, dailyRequestsKey, 1, 86_400),
    incrementWithExpiry(store, minuteRequestsKey, 1, 60),
  ]);

  return {
    allowed: true,
    estimatedInputTokens,
    used: {
      dailyRequests: nextDailyRequests,
      minuteRequests: nextMinuteRequests,
    },
  };
}

export function isDesktopSetupProxyRequest(body: ProxyRequestBody): boolean {
  return (
    body.model?.provider === DESKTOP_SETUP_PROXY_PROVIDER &&
    typeof body.context?.systemPrompt === "string" &&
    body.context.systemPrompt.startsWith(DESKTOP_SETUP_SYSTEM_PROMPT_PREFIX)
  );
}

function convertTools(tools: PiTool[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function sse(reply: FastifyReply, event: unknown) {
  reply.raw.write("data: " + JSON.stringify(event) + "\n\n");
}

export function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Accept both user accessToken and CLI machineToken. */
export async function requireMachineOrUserAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing token" });
  }
  const token = header.slice(7);

  const machinePayload = verifyMachineToken(token);
  if (machinePayload) {
    const machine = await prisma.machine.findUnique({
      where: { machineToken: token },
      select: { userId: true },
    });
    if (!machine?.userId) return reply.code(401).send({ error: "Machine not found" });
    request.userId = machine.userId;
    request.machineId = machinePayload.machineId;
    return;
  }

  const userPayload = verifyToken(token);
  if (!userPayload) return reply.code(401).send({ error: "Invalid token" });
  const { userId, deviceId } = userPayload;
  if (!userId || !deviceId) return reply.code(401).send({ error: "Invalid token" });
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.tokenExpiry < new Date()) {
    return reply.code(401).send({ error: "Token expired" });
  }
  request.userId = userId;
}

export function convertMessages(systemPrompt: string | undefined, messages: PiMessage[]) {
  const result: unknown[] = [];
  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else {
        const parts = msg.content.map((content) => {
          if (content.type === "text") return { type: "text", text: content.text };
          return { type: "image_url", image_url: { url: `data:${content.mimeType};base64,${content.data}` } };
        });
        result.push({ role: "user", content: parts });
      }
    } else if (msg.role === "assistant") {
      const textParts = msg.content.filter((content) => content.type === "text") as TextContent[];
      const toolCalls = msg.content.filter((content) => content.type === "toolCall") as ToolCall[];
      const openaiMsg: Record<string, unknown> = { role: "assistant" };
      openaiMsg.content = textParts.length > 0 ? textParts.map((content) => content.text).join("") : null;
      if (toolCalls.length > 0) {
        openaiMsg.tool_calls = toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
        }));
      }
      result.push(openaiMsg);
    } else if (msg.role === "toolResult") {
      const textParts = msg.content
        .filter((content) => content.type === "text")
        .map((content) => (content as TextContent).text)
        .join("");
      let imageParts = msg.content.filter((content) => content.type === "image") as ImageContent[];

      if (imageParts.length === 0 && textParts) {
        try {
          const parsed = JSON.parse(textParts) as unknown;
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            "content" in parsed &&
            Array.isArray((parsed as { content: unknown[] }).content)
          ) {
            const candidates = (parsed as { content: unknown[] }).content.filter(
              (content): content is ImageContent =>
                typeof content === "object" &&
                content !== null &&
                (content as ImageContent).type === "image" &&
                typeof (content as ImageContent).data === "string" &&
                typeof (content as ImageContent).mimeType === "string",
            );
            if (candidates.length > 0) imageParts = candidates;
          }
        } catch {
          // not JSON — leave imageParts empty
        }
      }

      result.push({
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: imageParts.length > 0 ? "图片已读取，见下条消息" : textParts,
      });

      if (imageParts.length > 0) {
        const imagePayload = imageParts.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        }));
        result.push({ role: "user", content: imagePayload });
      }
    }
  }
  return result;
}

export async function streamAgentProxyResponse(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const userId = request.userId;
  const body = request.body as ProxyRequestBody;
  const { context, options = {} } = body;
  const bypassQuota = isDesktopSetupProxyRequest(body);
  if (!bypassQuota) {
    try {
      await ensureNianHostedModelAllowed(userId);
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 402;
      const code = (error as Error & { code?: string }).code ?? NIAN_INSUFFICIENT_CREDITS_ERROR;
      return reply.code(statusCode).send({
        error: code,
        message: code === NIAN_ENTITLEMENT_REQUIRED_ERROR
          ? "当前账号尚未开通 Nian 托管模型。请前往神念「套餐与支付」开通 Pro 或 Team，获得积分后重试。"
          : "积分不足，Nian 模型请求已暂停。请在套餐与支付中购买积分包后继续。",
      });
    }
    const quota = await reserveNianQuota(userId, body);
    if (!quota.allowed) {
      if (quota.retryAfterSeconds) reply.header("Retry-After", String(quota.retryAfterSeconds));
      return reply.code(quota.statusCode).send({
        error: quota.code,
        message: quota.message,
        used: quota.used,
        limit: quota.limit,
      });
    }
  }
  const quotaConfig = getNianQuotaConfig();


  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch {
    return reply.code(503).send({ error: "LLM service not configured" });
  }

  const selectedModelId = ALLOWED_MODELS.has(body.model?.id) ? body.model.id : DASHSCOPE_DEFAULT_MODEL;
  const dashscopeBody: Record<string, unknown> = {
    model: selectedModelId,
    ...(selectedModelId === PLATFORM_TEXT_MODEL ? { enable_thinking: false } : {}),
    messages: convertMessages(context.systemPrompt, context.messages ?? []),
    stream: true,
    stream_options: { include_usage: true },
    temperature: options.temperature ?? 0.7,
    max_tokens: Math.min(options.maxTokens ?? quotaConfig.maxOutputTokens, quotaConfig.maxOutputTokens),
  };
  const tools = context.tools?.length ? convertTools(context.tools) : undefined;
  if (tools?.length) {
    dashscopeBody.tools = tools;
    dashscopeBody.tool_choice = "auto";
  }

  let monthly: PersonalQuotaReservation | null = null;
  let monthlyUsage: { inputTokens: number; outputTokens: number } | null = null;
  {
    try { monthly = await reservePersonalModelQuota(userId, dashscopeBody); }
    catch { return reply.code(503).send({ error: 'official_model_quota_unavailable' }); }
    if (!monthly) return reply.code(429).send({ error: 'personal_model_monthly_quota_exceeded', message: '本月免费额度不足，请下月再试或使用自己的模型。' });
  }
  try {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Transfer-Encoding", "chunked");
  reply.raw.setHeader("Cache-Control", "no-cache");

  sse(reply, { type: "start" });

  let dsRes: Response;
  try {
    dsRes = await fetch(`${selectedModelId === PLATFORM_TEXT_MODEL ? platformTextBaseUrl() : DASHSCOPE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(dashscopeBody),
      signal: AbortSignal.timeout(quotaConfig.requestTimeoutMs),
    });
  } catch (err) {
    sse(reply, {
      type: "error",
      reason: "error",
      errorMessage: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      usage: emptyUsage(),
    });
    reply.raw.end();
    return reply;
  }

  if (!dsRes.ok) {
    monthlyUsage = { inputTokens: 0, outputTokens: 0 };
    let errorMsg = `DashScope error: ${dsRes.status} ${dsRes.statusText}`;
    try {
      const errData = (await dsRes.json()) as { error?: { message?: string } };
      if (errData.error?.message) errorMsg = errData.error.message;
    } catch {
      // ignore parse failures
    }
    sse(reply, {
      type: "error",
      reason: "error",
      errorMessage: errorMsg,
      usage: emptyUsage(),
    });
    reply.raw.end();
    return reply;
  }

  const reader = dsRes.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let textStarted = false;
  let textContentIndex = 0;
  const toolCallState = new Map<
    number,
    { id: string; name: string; argsAccum: string; contentIndex: number; started: boolean }
  >();
  let nextContentIndex = 0;
  let finalUsage: { input_tokens?: number; prompt_tokens?: number; output_tokens?: number; completion_tokens?: number } | null = null;
  let stopReason: "stop" | "length" | "toolUse" = "stop";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") break;

        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
          usage?: {
            prompt_tokens?: number;
            input_tokens?: number;
            completion_tokens?: number;
            output_tokens?: number;
          };
        };

        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const choice = chunk.choices?.[0];
        if (!choice) {
          if (chunk.usage) finalUsage = chunk.usage;
          continue;
        }

        if (choice.finish_reason) {
          if (choice.finish_reason === "tool_calls") stopReason = "toolUse";
          else if (choice.finish_reason === "length") stopReason = "length";
          if (chunk.usage) finalUsage = chunk.usage;
        }

        const delta = choice.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content.length > 0) {
          if (!textStarted) {
            textContentIndex = nextContentIndex++;
            sse(reply, { type: "text_start", contentIndex: textContentIndex });
            textStarted = true;
          }
          sse(reply, { type: "text_delta", contentIndex: textContentIndex, delta: delta.content });
        }

        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;
            if (!toolCallState.has(index)) {
              const contentIndex = nextContentIndex++;
              toolCallState.set(index, {
                id: toolCall.id ?? "",
                name: toolCall.function?.name ?? "",
                argsAccum: toolCall.function?.arguments ?? "",
                contentIndex,
                started: false,
              });
            } else {
              const state = toolCallState.get(index)!;
              if (toolCall.id) state.id = toolCall.id;
              if (toolCall.function?.name) state.name += toolCall.function.name;
              if (toolCall.function?.arguments) state.argsAccum += toolCall.function.arguments;
            }

            const state = toolCallState.get(index)!;
            if (!state.started && state.id && state.name) {
              sse(reply, {
                type: "toolcall_start",
                contentIndex: state.contentIndex,
                id: state.id,
                toolName: state.name,
              });
              state.started = true;
            }
            if (state.started && toolCall.function?.arguments) {
              sse(reply, {
                type: "toolcall_delta",
                contentIndex: state.contentIndex,
                delta: toolCall.function.arguments,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    sse(reply, {
      type: "error",
      reason: "error",
      errorMessage: `Stream read error: ${err instanceof Error ? err.message : String(err)}`,
      usage: emptyUsage(),
    });
    reply.raw.end();
    return reply;
  }

  if (textStarted) {
    sse(reply, { type: "text_end", contentIndex: textContentIndex });
  }

  for (const [, state] of toolCallState) {
    if (state.started) {
      sse(reply, { type: "toolcall_end", contentIndex: state.contentIndex });
    }
  }

  const inputTokens = finalUsage?.input_tokens ?? finalUsage?.prompt_tokens ?? 0;
  const outputTokens = finalUsage?.output_tokens ?? finalUsage?.completion_tokens ?? 0;
  if (Number.isSafeInteger(finalUsage?.input_tokens ?? finalUsage?.prompt_tokens) && Number.isSafeInteger(finalUsage?.output_tokens ?? finalUsage?.completion_tokens)) monthlyUsage = { inputTokens, outputTokens };
  const usageRefId = `nian:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  let creditsCharged: number | null = null;
  if (!bypassQuota) {
    try {
      const charge = await chargeNianHostedModelUsage({
        userId,
        modelId: selectedModelId,
        inputTokens,
        outputTokens,
        usageRefId,
      });
      creditsCharged = charge?.creditsCharged ?? null;
    } catch {
      sse(reply, {
        type: "error",
        reason: NIAN_INSUFFICIENT_CREDITS_ERROR,
        errorMessage: "积分不足，Nian 模型请求扣费失败。请在套餐与支付中购买积分包后继续。",
        usage: emptyUsage(),
      });
      reply.raw.end();
      return reply;
    }
  }
  sse(reply, {
    type: "done",
    reason: stopReason,
    usage: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: inputTokens + outputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      credits: creditsCharged,
      usageRefId,
    },
  });

  reply.raw.end();

  return reply;
  } finally {
    try { await monthly?.settle(monthlyUsage); }
    catch { request.log.error('Personal model quota settlement failed; reservation retained'); }
  }
}
