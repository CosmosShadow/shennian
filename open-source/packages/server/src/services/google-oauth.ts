import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client();

export async function verifyGoogleIdToken(
  idToken: string,
  audiences: string[],
): Promise<{
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}> {
  if (audiences.length === 0) {
    throw new Error("No Google OAuth client IDs configured");
  }
  const ticket = await client.verifyIdToken({
    idToken,
    audience: audiences,
  });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("Empty payload");
  return payload;
}

export function parseGoogleClientIds(): string[] {
  const raw = process.env.GOOGLE_OAUTH_CLIENT_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
