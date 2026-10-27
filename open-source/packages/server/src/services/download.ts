// @arch open-source/docs/server-runtime.md
// @test src/__tests__/self-hosted-download.test.ts
import { getOssClient, getStorageProvider, signDownloadUrl } from "../lib/oss.js";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { parseReleaseManifest, type Platform, type ReleaseInfo } from "./download-manifest.js";
export { isValidPlatform, type Platform, type PlatformInfo, type ReleaseInfo } from "./download-manifest.js";

const OSS_PREFIX = "shennian/releases";

/** Fetch stable.json from OSS with Redis caching (single release channel). */
export async function getRelease(): Promise<ReleaseInfo | null> {
  // Local attachment storage does not imply an official distribution bucket.
  // Check before Redis so a stale cached pointer cannot cross this boundary.
  if (getStorageProvider() !== "oss") return null;
  const cacheKey = "download:release";
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      const parsed = parseReleaseManifest(JSON.parse(cached));
      if (parsed) return parsed;
    } catch { /* Read a fresh pointer if the cached value is invalid. */ }
  }

  const oss = getOssClient();
  try {
    const result = await oss.get(`${OSS_PREFIX}/stable.json`);
    const body =
      typeof result.content === "string"
        ? result.content
        : Buffer.from(result.content).toString("utf-8");
    const data = parseReleaseManifest(JSON.parse(body));
    if (!data) return null;
    await redis
      .set(cacheKey, JSON.stringify(data), "EX", 300)
      .catch(() => {});
    return data;
  } catch {
    return null;
  }
}

/** Get a signed download URL for a given platform. */
export async function getDownloadUrl(
  platform: Platform,
): Promise<{
  url: string;
  version: string;
  size: number;
}> {
  const release = await getRelease();
  if (!release) {
    throw new Error("No release available");
  }
  const info = release.platforms[platform];
  if (!info) {
    throw new Error(`No release for platform: ${platform}`);
  }

  const url = signDownloadUrl(`${OSS_PREFIX}/${info.url}`);
  return { url, version: info.version ?? release.version, size: info.size };
}

/**
 * Aliyun OSS blocks public distribution of `.apk` / `.ipa` via the default
 * `*.aliyuncs.com` endpoint (`ApkDownloadForbidden`); stream both through the
 * API instead of handing out signed OSS URLs.
 */
const STREAM_PLATFORMS = new Set<string>(["android", "ios"]);

export function needsStreamProxy(platform: string): boolean {
  return STREAM_PLATFORMS.has(platform);
}

/** Readable stream from OSS for direct proxy download. */
export async function getOssStream(platform: Platform): Promise<{
  stream: NodeJS.ReadableStream;
  filename: string;
  size: number;
  version: string;
}> {
  const release = await getRelease();
  if (!release) throw new Error("No release available");
  const info = release.platforms[platform];
  if (!info) throw new Error(`No release for platform: ${platform}`);

  const oss = getOssClient();
  const ossKey = `${OSS_PREFIX}/${info.url}`;
  const result = await oss.getStream(ossKey);
  const filename = info.url.split("/").pop() ?? "download";

  return {
    stream: result.stream,
    filename,
    size: info.size,
    version: info.version ?? release.version,
  };
}

/** Record a download event (fire-and-forget). */
export async function recordDownload(opts: {
  platform: string;
  version: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await prisma.downloadLog.create({
    data: {
      platform: opts.platform,
      version: opts.version,
      ip: opts.ip,
      userAgent: opts.userAgent,
    },
  });
}

/** Get download counts per platform. */
export async function getDownloadStats(): Promise<
  { platform: string; count: number }[]
> {
  const rows = await prisma.downloadLog.groupBy({
    by: ["platform"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return rows.map((r) => ({ platform: r.platform, count: r._count.id }));
}
