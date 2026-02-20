const projects = [
  {
    name: "MumMum",
    description: "영어 학습 앱",
    status: "🟢 배포됨",
    progress: 80,
    url: "https://mummum.up.railway.app",
    kpis: [
      { label: "목표", value: "$10K MRR" },
      { label: "현재", value: "성장 단계" },
    ],
  },
  {
    name: "Rezoom",
    description: "이력서 서비스",
    status: "🟡 진행중",
    progress: 20,
    kpis: [
      { label: "현재 작업", value: "Import 페이지" },
    ],
  },
  {
    name: "정화의 영역",
    description: "던전 빌딩 로그라이트",
    status: "📝 기획중",
    progress: 15,
    kpis: [
      { label: "엔진", value: "Godot 4" },
    ],
  },
  {
    name: "안부",
    description: "앱 예정",
    status: "💡 아이디어",
    progress: 0,
    kpis: [],
  },
  {
    name: "크레딧컨설팅",
    description: "재정/FIRE 트래킹",
    status: "❓ 확인 필요",
    progress: 0,
    kpis: [],
  },
  {
    name: "LifeDashboard",
    description: "이 대시보드",
    status: "🆕 시작",
    progress: 5,
    kpis: [],
  },
];

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-gray-700 rounded-full h-2">
      <div
        className="bg-green-500 h-2 rounded-full transition-all"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function ProjectCard({ project }: { project: (typeof projects)[0] }) {
  return (
    <div className="bg-gray-800 rounded-xl p-6 hover:bg-gray-750 transition-colors">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="text-xl font-bold text-white">{project.name}</h2>
          <p className="text-gray-400 text-sm">{project.description}</p>
        </div>
        <span className="text-sm">{project.status}</span>
      </div>
      
      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>진행률</span>
          <span>{project.progress}%</span>
        </div>
        <ProgressBar progress={project.progress} />
      </div>

      {project.kpis.length > 0 && (
        <div className="space-y-1">
          {project.kpis.map((kpi, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-gray-400">{kpi.label}</span>
              <span className="text-white">{kpi.value}</span>
            </div>
          ))}
        </div>
      )}

      {project.url && (
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block text-center text-sm text-blue-400 hover:text-blue-300"
        >
          방문하기 →
        </a>
      )}
    </div>
  );
}

export default function Home() {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <header className="max-w-6xl mx-auto mb-8">
        <h1 className="text-3xl font-bold mb-2">📊 LifeDashboard</h1>
        <p className="text-gray-400">{today}</p>
      </header>

      <main className="max-w-6xl mx-auto">
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-300">
            🚀 프로젝트 현황
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.name} project={project} />
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-300">
            🎯 이번 주 포커스
          </h2>
          <div className="bg-gray-800 rounded-xl p-6">
            <ul className="space-y-2 text-gray-300">
              <li>• MumMum: 공유 카드 기능 (#63)</li>
              <li>• Rezoom: Import 페이지 완성</li>
              <li>• LifeDashboard: MVP 완성</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4 text-gray-300">
            💰 재정 목표
          </h2>
          <div className="bg-gray-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-gray-400">MumMum $10K MRR</span>
              <span className="text-white">0%</span>
            </div>
            <ProgressBar progress={0} />
            <p className="text-gray-500 text-sm mt-2">
              크레딧컨설팅 연동 예정
            </p>
          </div>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto mt-12 text-center text-gray-500 text-sm">
        Built with Next.js • Deployed on Railway
      </footer>
    </div>
  );
}
