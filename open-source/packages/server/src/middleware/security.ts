import type { FastifyInstance } from "fastify";
import Redis from "ioredis";

const WINDOW_SEC = 60;
const GLOBAL_LIMIT = 100;
const AUTH_CODE_LIMIT = 5;

async function connectRedis(): Promise<Redis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  redis.on("error", () => {});

  try {
    await redis.connect();
    return redis;
  } catch {
    redis.disconnect();
    return null;
  }
}

export async function securityPlugin(app: FastifyInstance) {
  const redis = await connectRedis();

  if (!redis) {
    app.log.warn("Redis not available – rate limiting disabled");
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!redis || redis.status !== "ready") return;

    const ip = request.ip;
    const isAuthCode = request.url.startsWith("/auth/send-code");
    const limit = isAuthCode ? AUTH_CODE_LIMIT : GLOBAL_LIMIT;
    const keyPrefix = isAuthCode ? "rl:auth:" : "rl:ip:";
    const key = `${keyPrefix}${ip}`;

    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, WINDOW_SEC);
    }

    reply.header("X-RateLimit-Limit", limit);
    reply.header("X-RateLimit-Remaining", Math.max(0, limit - current));

    if (current > limit) {
      return reply.code(429).send({ error: "Too many requests" });
    }
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "1; mode=block");
    reply.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  });

  if (redis) {
    app.addHook("onClose", async () => {
      redis.disconnect();
    });
  }
}
