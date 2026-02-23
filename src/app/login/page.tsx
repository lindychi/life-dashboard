"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setDevToken(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error });
        return;
      }

      setMessage({ type: "success", text: data.message });

      // Dev mode: show token link
      if (data.devToken) {
        setDevToken(data.devToken);
      }
    } catch {
      setMessage({ type: "error", text: "요청 실패" });
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async () => {
    if (!devToken) return;
    router.push(`/auth/verify?token=${devToken}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl p-8 w-full max-w-md border border-gray-700">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">🎛️ LifeDashboard</h1>
          <p className="text-gray-400">이메일로 로그인하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              이메일
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus-visible:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-medium py-3 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            {loading ? "전송 중..." : "로그인 링크 받기"}
          </button>
        </form>

        {message && (
          <div
            className={`mt-4 p-4 rounded-lg ${
              message.type === "success"
                ? "bg-green-500/10 border border-green-500/30 text-green-400"
                : "bg-red-500/10 border border-red-500/30 text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}

        {devToken && (
          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-yellow-400 text-sm mb-2">
              🔧 개발 모드: 아래 버튼으로 바로 로그인
            </p>
            <button
              onClick={handleDevLogin}
              className="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-medium py-2 rounded-lg transition-colors text-sm focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:outline-none"
            >
              개발 모드 로그인 →
            </button>
          </div>
        )}

        <p className="text-gray-500 text-xs text-center mt-6">
          허용된 이메일만 로그인할 수 있습니다
        </p>
      </div>
    </div>
  );
}
