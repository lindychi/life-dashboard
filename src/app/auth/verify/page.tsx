"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function VerifyContent() {
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");

    const verify = async () => {
      if (!token) {
        setStatus("error");
        setError("토큰이 없습니다");
        return;
      }

      try {
        const res = await fetch(`/api/auth/verify?token=${token}`);
        const data = await res.json();

        if (!res.ok) {
          setStatus("error");
          setError(data.error);
          return;
        }

        setStatus("success");

        // Redirect to dashboard
        setTimeout(() => {
          router.push("/");
        }, 1500);
      } catch {
        setStatus("error");
        setError("인증 실패");
      }
    };

    verify();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl p-8 w-full max-w-md border border-gray-700 text-center">
        {status === "loading" && (
          <>
            <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">인증 중...</h2>
            <p className="text-gray-400">잠시만 기다려주세요</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-bold text-white mb-2">로그인 성공!</h2>
            <p className="text-gray-400">대시보드로 이동합니다...</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-5xl mb-4">❌</div>
            <h2 className="text-xl font-bold text-white mb-2">인증 실패</h2>
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => router.push("/login")}
              className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-6 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              다시 로그인하기
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
