// @arch open-source/docs/server-runtime.md
// @test src/__tests__/convert-messages.test.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { registerAuthDecorators } from "../middleware/auth.js";
import {
  DASHSCOPE_DEFAULT_MODEL,
  PI_MODELS,
  requireMachineOrUserAuth,
  streamAgentProxyResponse,
} from "../services/agent-proxy.js";

export { convertMessages, type PiMessage } from "../services/agent-proxy.js";

export async function agentProxyRoutes(app: FastifyInstance) {
  registerAuthDecorators(app);

  const modelsHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      models: PI_MODELS,
      default: DASHSCOPE_DEFAULT_MODEL,
    });
  };

  const streamHandler = async (request: FastifyRequest, reply: FastifyReply) =>
    streamAgentProxyResponse(request, reply);

  for (const path of ["/models", "/api/models"]) {
    app.get(path, { preHandler: requireMachineOrUserAuth }, modelsHandler);
  }

  for (const path of ["/stream", "/api/stream"]) {
    app.post(path, { preHandler: requireMachineOrUserAuth }, streamHandler);
  }
}
