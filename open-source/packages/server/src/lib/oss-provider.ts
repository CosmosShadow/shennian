// @arch open-source/docs/server-runtime.md
// @test src/__tests__/oss.test.ts
import OSS from "ali-oss";

const region = process.env.OSS_REGION ?? "oss-cn-hangzhou";
const bucket = process.env.OSS_BUCKET ?? "videoindustry";

let internalClient: OSS | null = null;
let publicClient: OSS | null = null;

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function shouldUseInternalEndpoint(): boolean {
  return readBoolean(process.env.OSS_USE_INTERNAL_ENDPOINT, process.env.NODE_ENV === "production");
}

function buildInternalEndpoint(): string {
  return process.env.OSS_INTERNAL_ENDPOINT ?? `https://${region}-internal.aliyuncs.com`;
}

function buildPublicEndpoint(): string | undefined {
  return process.env.OSS_PUBLIC_ENDPOINT;
}

function buildOssClient(options?: { publicEndpoint?: boolean }): OSS {
  if (!process.env.ALIYUN_ACCESS_KEY_ID || !process.env.ALIYUN_ACCESS_KEY_SECRET) {
    throw new Error("ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET are required for OSS access");
  }
  const endpoint = options?.publicEndpoint
    ? buildPublicEndpoint()
    : shouldUseInternalEndpoint()
      ? buildInternalEndpoint()
      : undefined;
  return new OSS({
    region,
    // ali-oss defaults to plain HTTP when only a region is provided. Room
    // clients intentionally reject non-HTTPS signed URLs before uploading.
    secure: true,
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    bucket,
    ...(endpoint ? { endpoint } : {}),
  });
}

export function getOssClient(): OSS {
  if (internalClient) return internalClient;
  internalClient = buildOssClient();
  return internalClient;
}

function getPublicOssClient(): OSS {
  if (publicClient) return publicClient;
  publicClient = buildOssClient({ publicEndpoint: true });
  return publicClient;
}

export async function getObjectText(objectKey: string): Promise<string | null> {
  const oss = getOssClient();
  try {
    const result = await oss.get(objectKey);
    const content = result.content as Buffer | string | undefined;
    if (Buffer.isBuffer(content)) return content.toString("utf8");
    if (typeof content === "string") return content;
    return "";
  } catch (error) {
    const status = (error as { status?: number; code?: string }).status;
    const code = (error as { status?: number; code?: string }).code;
    if (status === 404 || code === "NoSuchKey") return null;
    throw error;
  }
}

export async function getObjectBuffer(objectKey: string): Promise<{ buffer: Buffer; mimeType?: string } | null> {
  const oss = getOssClient();
  try {
    const result = await oss.get(objectKey);
    const content = result.content as Buffer | string | undefined;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ""));
    const headers = (result.res as { headers?: Record<string, unknown> } | undefined)?.headers ?? {};
    const mimeType = typeof headers["content-type"] === "string" ? headers["content-type"] : undefined;
    return { buffer, mimeType };
  } catch (error) {
    const status = (error as { status?: number; code?: string }).status;
    const code = (error as { status?: number; code?: string }).code;
    if (status === 404 || code === "NoSuchKey") return null;
    throw error;
  }
}

export async function putObjectText(objectKey: string, content: string): Promise<number> {
  const oss = getOssClient();
  const buffer = Buffer.from(content, "utf8");
  await oss.put(objectKey, buffer, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
  return buffer.byteLength;
}

export async function putObjectBuffer(
  objectKey: string,
  content: Buffer,
  contentType = "application/octet-stream",
): Promise<number> {
  const oss = getOssClient();
  await oss.put(objectKey, content, {
    mime: contentType,
    headers: {
      "Content-Type": contentType,
    },
  });
  return content.byteLength;
}

export async function listObjectsByPrefix(
  prefix: string,
  marker?: string | null,
): Promise<{
  objects: Array<{ name: string; lastModified?: string; size?: number }>;
  nextMarker: string | null;
  isTruncated: boolean;
}> {
  const oss = getOssClient() as unknown as {
    list: (query: Record<string, unknown>) => Promise<{
      objects?: Array<{ name: string; lastModified?: string; size?: number }>;
      nextMarker?: string | null;
      isTruncated?: boolean;
    }>;
  };
  const result = await oss.list({
    prefix,
    marker: marker || undefined,
    "max-keys": 1000,
  });
  return {
    objects: result.objects ?? [],
    nextMarker: result.nextMarker ?? null,
    isTruncated: Boolean(result.isTruncated),
  };
}

export async function deleteObjects(objectKeys: string[]): Promise<number> {
  if (objectKeys.length === 0) return 0;
  const oss = getOssClient() as unknown as {
    deleteMulti: (names: string[], options?: { quiet?: boolean }) => Promise<unknown>;
  };
  await oss.deleteMulti(objectKeys, { quiet: true });
  return objectKeys.length;
}

export async function deleteObjectIfExists(objectKey: string): Promise<void> {
  const oss = getOssClient();
  try {
    await oss.delete(objectKey);
  } catch (error) {
    const status = (error as { status?: number; code?: string }).status;
    const code = (error as { status?: number; code?: string }).code;
    if (status === 404 || code === "NoSuchKey") return;
    throw error;
  }
}

/** Generate a pre-signed URL that expires in `seconds` (default 5 min). */
export function signDownloadUrl(
  objectKey: string,
  seconds = 300,
): string {
  const oss = getPublicOssClient();
  return oss.signatureUrl(objectKey, { expires: seconds });
}

export function signUploadUrl(
  objectKey: string,
  input: { seconds?: number; contentType: string; sha256: string },
): string {
  const oss = getPublicOssClient();
  return oss.signatureUrl(objectKey, {
    method: "PUT",
    expires: input.seconds ?? 300,
    "Content-Type": input.contentType,
    "x-oss-meta-sha256": input.sha256,
  } as unknown as Parameters<OSS["signatureUrl"]>[1]);
}

export async function headObjectMetadata(objectKey: string): Promise<{
  byteSize: number;
  contentType: string | null;
  sha256: string | null;
} | null> {
  const oss = getOssClient();
  try {
    const result = await oss.head(objectKey);
    const headers = (result.res as { headers?: Record<string, unknown> } | undefined)?.headers ?? {};
    const byteSize = Number(headers["content-length"] ?? result.meta?.["content-length"] ?? NaN);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw new Error("Invalid OSS object length");
    const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : null;
    const sha256 = typeof headers["x-oss-meta-sha256"] === "string"
      ? headers["x-oss-meta-sha256"].toLowerCase()
      : null;
    return { byteSize, contentType, sha256 };
  } catch (error) {
    const status = (error as { status?: number; code?: string }).status;
    const code = (error as { status?: number; code?: string }).code;
    if (status === 404 || code === "NoSuchKey") return null;
    throw error;
  }
}
