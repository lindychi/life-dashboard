import { NextRequest, NextResponse } from "next/server";
import { createMagicLinkToken, isEmailAllowed } from "@/lib/auth";
import { sendMagicLink } from "@/lib/resend";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "이메일을 입력해주세요" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (!isEmailAllowed(normalizedEmail)) {
      return NextResponse.json(
        { error: "허용되지 않은 이메일입니다" },
        { status: 403 }
      );
    }

    const token = await createMagicLinkToken(normalizedEmail);
    const result = await sendMagicLink(normalizedEmail, token);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "이메일 전송 실패" },
        { status: 500 }
      );
    }

    // Dev mode: return token in response
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({
        success: true,
        message: "로그인 링크가 전송되었습니다 (개발 모드: 콘솔 확인)",
        devToken: token,
      });
    }

    return NextResponse.json({
      success: true,
      message: "로그인 링크가 이메일로 전송되었습니다",
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
