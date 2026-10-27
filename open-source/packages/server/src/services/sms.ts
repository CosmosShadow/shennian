import DysmsapiModule, { SendSmsRequest } from "@alicloud/dysmsapi20170525";
import { Config } from "@alicloud/openapi-client";

// CJS package exports the constructor at .default under ESM interop
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DysmsapiCtor = ((DysmsapiModule as any).default ?? DysmsapiModule) as new (config: Config) => InstanceType<typeof DysmsapiModule>;

type DysmsapiClient = InstanceType<typeof DysmsapiModule>;


function isDebugMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.DEBUG === "true" || !process.env.ALIYUN_ACCESS_KEY_ID)
  );
}

let client: DysmsapiClient | null = null;

function getClient(): DysmsapiClient {
  if (client) return client;
  const config = new Config({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID!,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET!,
    endpoint: "dysmsapi.aliyuncs.com",
  });
  client = new DysmsapiCtor(config);
  return client;
}

function stripE164(phone: string): string {
  return phone.replace(/^\+86/, "");
}

export async function sendSmsCode(
  phone: string,
  code: string,
): Promise<{ debug: boolean }> {
  if (isDebugMode()) {
    return { debug: true };
  }

  const signName = process.env.ALIYUN_SMS_SIGN?.trim();
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE?.trim();
  if (!process.env.ALIYUN_ACCESS_KEY_ID || !process.env.ALIYUN_ACCESS_KEY_SECRET || !signName || !templateCode) {
    throw new Error("SMS provider is not configured");
  }

  const req = new SendSmsRequest({
    phoneNumbers: stripE164(phone),
    signName,
    templateCode,
    templateParam: JSON.stringify({ code }),
  });

  const resp = await getClient().sendSms(req);
  if (resp.body?.code !== "OK") {
    throw new Error(
      `SMS send failed: ${resp.body?.code} - ${resp.body?.message}`,
    );
  }

  return { debug: false };
}
