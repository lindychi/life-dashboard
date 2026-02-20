import { Resend } from "resend";

// Resend 인스턴스는 API 키가 있을 때만 생성
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export async function sendMagicLink(
  email: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const magicLink = `${appUrl}/auth/verify?token=${token}`;

  // Dev mode: 이메일 키 없으면 콘솔에 출력
  if (!resend) {
    console.log("\n========================================");
    console.log("🔗 Magic Link (dev mode):");
    console.log(magicLink);
    console.log("========================================\n");
    return { success: true };
  }

  try {
    await resend.emails.send({
      from: "LifeDashboard <noreply@updates.chozang.com>",
      to: email,
      subject: "🔐 LifeDashboard 로그인 링크",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a1a1a;">🎛️ LifeDashboard</h2>
          <p style="color: #666; line-height: 1.6;">
            아래 버튼을 클릭하여 로그인하세요. 이 링크는 15분간 유효합니다.
          </p>
          <a href="${magicLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; margin: 16px 0;">
            로그인하기 →
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">
            본인이 요청하지 않았다면 이 이메일을 무시하세요.
          </p>
        </div>
      `,
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to send magic link:", error);
    return { success: false, error: "이메일 전송 실패" };
  }
}
