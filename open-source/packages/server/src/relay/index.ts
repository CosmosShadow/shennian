// @arch open-source/docs/server-runtime.md
// @test ../__tests__/client-relay-diagnostics.test.ts

import type { FastifyInstance } from "fastify";
import {
  handleMachineConnection,
  handleClientConnection,
  handleMultiplexClientConnection,
} from "./handler.js";
import { pubsub } from "./pubsub.js";
import { destroyServerRequestRouting, initServerRequestRouting } from "./server-requests.js";
import { destroyConnectionControl, initConnectionControl } from "./connection-control.js";
import { observeClientRelayLifecycle } from "./client-relay-diagnostics.js";

const HEARTBEAT_INTERVAL = 30_000;

function buildTickFrame(): string {
  return JSON.stringify({
    type: "event",
    event: "tick",
    payload: { ts: Date.now() },
  });
}

export async function relayPlugin(app: FastifyInstance): Promise<void> {
  await pubsub.init();
  await initServerRequestRouting();
  await initConnectionControl();

  app.get("/relay/machine", { websocket: true }, (socket, request) => {
    void handleMachineConnection(socket, request);
  });

  app.get("/relay/client", { websocket: true }, (socket, request) => {
    observeClientRelayLifecycle(socket, request, "multiplex");
    void handleMultiplexClientConnection(socket, request);
  });

  app.get<{ Params: { machineId: string } }>(
    "/relay/:machineId",
    { websocket: true },
    (socket, request) => {
      observeClientRelayLifecycle(socket, request, "legacy");
      void handleClientConnection(socket, request);
    },
  );

  const heartbeatTimer = setInterval(() => {
    const tick = buildTickFrame();
    for (const client of app.websocketServer.clients) {
      if (client.readyState === client.OPEN) {
        client.send(tick);
      }
    }
  }, HEARTBEAT_INTERVAL);

  app.addHook("onClose", async () => {
    clearInterval(heartbeatTimer);
    destroyServerRequestRouting();
    destroyConnectionControl();
    await pubsub.destroy();
  });
}
