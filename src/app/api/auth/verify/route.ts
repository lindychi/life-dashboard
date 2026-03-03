import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLinkToken, createToken } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "토큰이 없습니다" }, { status: 400 });
  }

  const payload = await verifyMagicLinkToken(token);

  if (!payload) {
    return NextResponse.json(
      { error: "유효하지 않거나 만료된 링크입니다" },
      { status: 401 }
    );
  }

  // Create session token and set cookie directly on response
  const sessionToken = await createToken(payload.email);
  const response = NextResponse.json({ success: true });
  response.cookies.set("auth-token", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
