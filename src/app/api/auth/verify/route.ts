import { NextRequest, NextResponse } from "next/server";
import { verifyToken, createToken, setAuthCookie } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "토큰이 없습니다" }, { status: 400 });
  }

  const payload = await verifyToken(token);

  if (!payload || (payload as { type?: string }).type !== "magic-link") {
    return NextResponse.json(
      { error: "유효하지 않거나 만료된 링크입니다" },
      { status: 401 }
    );
  }

  // Create session token
  const sessionToken = await createToken((payload as { email: string }).email);
  await setAuthCookie(sessionToken);

  return NextResponse.json({ success: true });
}
