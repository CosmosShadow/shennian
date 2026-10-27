/**
 * Tencent 天御验证码 — 与 ppt_talk_agent captcha_service 一致
 * https://ssl.captcha.qq.com/ticket/verify
 */

const VERIFY_URL = "https://ssl.captcha.qq.com/ticket/verify";

export function isTencentCaptchaEnforced(): boolean {
  return Boolean(
    process.env.TENCENT_CAPTCHA_APP_SECRET_KEY?.trim() &&
      process.env.TENCENT_CAPTCHA_APP_ID?.trim(),
  );
}

export async function verifyTencentCaptcha(
  ticket: string | undefined,
  randstr: string | undefined,
  userIp: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isTencentCaptchaEnforced()) {
    return { ok: true, message: "skipped" };
  }

  if (!ticket?.trim() || !randstr?.trim()) {
    return { ok: false, message: "Captcha required" };
  }

  const appId = process.env.TENCENT_CAPTCHA_APP_ID!.trim();
  const secret = process.env.TENCENT_CAPTCHA_APP_SECRET_KEY!.trim();

  const url = new URL(VERIFY_URL);
  url.searchParams.set("aid", appId);
  url.searchParams.set("AppSecretKey", secret);
  url.searchParams.set("Ticket", ticket);
  url.searchParams.set("Randstr", randstr);
  url.searchParams.set("UserIP", userIp || "127.0.0.1");

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    const result = (await res.json()) as {
      response?: string;
      err_msg?: string;
    };

    if (result.response === "1") {
      return { ok: true, message: "ok" };
    }
    return {
      ok: false,
      message: result.err_msg ? `Captcha: ${result.err_msg}` : "Captcha failed",
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Captcha verify error",
    };
  }
}
