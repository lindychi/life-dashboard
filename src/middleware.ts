import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? undefined : "dev-only-secret-do-not-use-in-prod")
);

// Relay API key for MCP server authentication
const RELAY_API_KEY = process.env.RELAY_API_KEY || "dev-relay-key";

// 인증 필요 없는 경로
const publicPaths = [
  "/login",
  "/auth/verify",
  "/api/auth/login",
  "/api/auth/verify",
  "/api/relay/",
  "/api/tasks/health",
  "/api/task-executions",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths - 인증 필요 없음
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Static files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check for relay API key (for MCP server and gateway connector)
  const relayKey = request.headers.get("x-relay-key");
  if (relayKey && relayKey === RELAY_API_KEY) {
    return NextResponse.next();
  }

  // Check auth token
  const token = request.cookies.get("auth-token")?.value;

  if (!token) {
    // API routes return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Pages redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Verify token
  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch {
    // Invalid token - clear and redirect
    const response = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));

    response.cookies.delete("auth-token");
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
