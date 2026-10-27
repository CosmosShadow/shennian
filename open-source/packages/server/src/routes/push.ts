import type { FastifyInstance } from "fastify";
import { systemPushEnabled } from '../services/instance-settings.js'
import { registerAuthDecorators, requireAuth } from "../middleware/auth.js";
import {
  registerPushToken,
  unregisterPushToken,
  type PushProvider,
} from "../services/push.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";

export { sendPushNotification } from "../services/push.js";

export async function pushRoutes(app: FastifyInstance) {
  registerAuthDecorators(app);

  app.get("/vapid-public-key", async (_request, reply) => {
    if (!systemPushEnabled() || !VAPID_PUBLIC_KEY) {
      return reply.code(503).send({ error: "Web Push not configured" });
    }
    return { key: VAPID_PUBLIC_KEY };
  });

  app.post<{
    Body: {
      pushToken?: string | null;
      platform: string;
      provider: PushProvider;
    };
  }>(
    "/devices/push-token",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { pushToken, platform, provider } = request.body;
      if (!platform || !provider) {
        return reply
          .code(400)
          .send({ error: "platform and provider are required" });
      }

      if (pushToken?.trim()) {
        if (!systemPushEnabled()) return reply.code(409).send({ error: 'push_disabled' });
        await registerPushToken({
          userId: request.userId,
          deviceId: request.deviceId,
          pushToken: pushToken.trim(),
          platform,
          provider,
        });
      } else {
        await unregisterPushToken({
          deviceId: request.deviceId,
          provider,
        });
      }

      return {};
    },
  );
}
