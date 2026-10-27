import type { FastifyInstance } from "fastify";
import {
  isValidPlatform,
  getDownloadUrl,
  getRelease,
  getDownloadStats,
  recordDownload,
  needsStreamProxy,
  getOssStream,
} from "../services/download.js";

function platformError(platform: string) {
  return `Invalid platform: ${platform}. Valid: android, ios, macos, windows`;
}

const STREAM_CONTENT_TYPE: Record<string, string> = {
  android: "application/vnd.android.package-archive",
  ios: "application/octet-stream",
};

/** Download: stream proxy for APK/IPA (Aliyun `ApkDownloadForbidden`), 302 otherwise. */
async function handleDownload(
  app: FastifyInstance,
  platform: string,
  request: { ip: string; headers: { "user-agent"?: string } },
  reply: {
    redirect(url: string): unknown;
    header(k: string, v: string): unknown;
    send(body: unknown): unknown;
  },
) {
  if (needsStreamProxy(platform)) {
    const { stream, filename, size, version } = await getOssStream(
      platform as Parameters<typeof getOssStream>[0],
    );
    recordDownload({
      platform,
      version,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    }).catch((err) => app.log.error(err, "Failed to record download"));

    reply.header(
      "Content-Type",
      STREAM_CONTENT_TYPE[platform] ?? "application/octet-stream",
    );
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.header("Content-Length", String(size));
    return reply.send(stream);
  }

  const { url, version } = await getDownloadUrl(
    platform as Parameters<typeof getDownloadUrl>[0],
  );
  recordDownload({
    platform,
    version,
    ip: request.ip,
    userAgent: request.headers["user-agent"],
  }).catch((err) => app.log.error(err, "Failed to record download"));
  return reply.redirect(url);
}

export async function downloadRoutes(app: FastifyInstance) {
  /** GET /download — current release metadata (same as /download/stable) */
  app.get("/", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return (await getRelease()) ?? { version: null };
  });

  /** GET /download/stable — release metadata (alias) */
  app.get("/stable", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return (await getRelease()) ?? { version: null };
  });

  /** GET /download/stats — download counts per platform */
  app.get("/stats", async () => {
    return getDownloadStats();
  });

  /** GET /download/:platform — e.g. android / ios */
  app.get<{ Params: { platform: string } }>(
    "/:platform",
    async (request, reply) => {
      const { platform } = request.params;
      if (!isValidPlatform(platform)) {
        return reply.code(400).send({ error: platformError(platform) });
      }
      // Never cache a latest-version redirect or a temporary signed URL.
      reply.header("Cache-Control", "no-store");
      try {
        return await handleDownload(app, platform, request, reply);
      } catch (error) {
        if (error instanceof Error && /^(No release available|No release for platform:)/.test(error.message)) {
          return reply.code(404).send({ error: "download_unavailable", platform });
        }
        app.log.warn({ platform }, "Download artifact temporarily unavailable");
        return reply.code(503).send({ error: "download_temporarily_unavailable", platform });
      }
    },
  );
}
