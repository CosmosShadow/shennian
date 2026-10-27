import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

export interface TokenPayload {
  userId: string;
  deviceId: string;
}

export interface MachineTokenPayload {
  machineId: string;
  type: "machine";
  tokenId?: string;
}

export function signToken(
  payload: TokenPayload,
  expiresInSeconds: number = 7 * 24 * 60 * 60,
): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresInSeconds });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    if (!decoded.userId) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function signMachineToken(machineId: string): string {
  const payload: MachineTokenPayload = { machineId, type: "machine", tokenId: randomUUID() };
  return jwt.sign(payload, JWT_SECRET);
}

export function verifyMachineToken(token: string): MachineTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as MachineTokenPayload;
    if (decoded.type !== "machine" || !decoded.machineId) return null;
    return decoded;
  } catch {
    return null;
  }
}
