import type { FastifyInstance } from "fastify";
import geoip from "geoip-lite";

function getClientIp(request: { ip: string; headers: Record<string, string | string[] | undefined> }): string {
  const xff = request.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0].trim();
  if (Array.isArray(xff)) return xff[0].trim();
  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string") return realIp.trim();
  return request.ip;
}

export async function geoRoutes(app: FastifyInstance) {
  app.get("/geo", async (request) => {
    const ip = getClientIp(request);
    const geo = geoip.lookup(ip);
    return {
      country: geo?.country ?? null,
      ip,
    };
  });
}
