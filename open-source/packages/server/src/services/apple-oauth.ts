import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

export type AppleIdTokenPayload = JWTPayload & {
  sub?: string;
  email?: string;
  nonce?: string;
};

export function parseAppleBundleId(): string | null {
  return process.env.APPLE_SIGN_IN_BUNDLE_ID?.trim() || null;
}

export async function verifyAppleIdentityToken(params: {
  identityToken: string;
  audience: string;
  nonce?: string;
}): Promise<AppleIdTokenPayload> {
  if (!params.audience) {
    throw new Error("No Apple bundle ID configured");
  }

  const { payload } = await jwtVerify(params.identityToken, appleJwks, {
    issuer: APPLE_ISSUER,
    audience: params.audience,
  });

  const applePayload = payload as AppleIdTokenPayload;
  if (params.nonce && applePayload.nonce !== params.nonce) {
    throw new Error("Invalid Apple nonce");
  }

  return applePayload;
}
