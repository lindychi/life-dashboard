import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

let _jwtSecret: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  if (_jwtSecret) return _jwtSecret;
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable is required in production");
  }
  _jwtSecret = new TextEncoder().encode(secret || "dev-only-secret-do-not-use-in-prod");
  return _jwtSecret;
}

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export interface User {
  email: string;
  iat: number;
  exp: number;
}

export async function createToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function createMagicLinkToken(email: string): Promise<string> {
  return new SignJWT({ email, type: "magic-link" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<User | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());

    // Runtime validation: ensure required fields exist
    if (typeof payload.email !== "string" || !payload.email) {
      return null;
    }

    return {
      email: payload.email as string,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

export function isEmailAllowed(email: string): boolean {
  if (ALLOWED_EMAILS.length === 0) return true; // No restriction if not configured
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("auth-token");
}
