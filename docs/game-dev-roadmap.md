# 게임 개발 로드맵

## 프로젝트 개요

**목표**: 핵심 메커니즘 검증부터 완성된 게임까지 단계적 개발
**기간**: 12-18개월 (Phase별 4-6개월)
**방법론**: 반복적 프로토타이핑 → 점진적 콘텐츠 확장 → 데이터 기반 밸런싱

---

## 기술 스택 선정

### 게임 엔진
**Unity (권장)** 또는 Unreal Engine
- **Unity 선택 시**:
  - 장점: 빠른 프로토타이핑, 광범위한 에셋 스토어, 크로스 플랫폼 지원
  - 적합 장르: 2D/3D 인디 게임, 모바일, PC
  - 학습곡선: 중간

- **Unreal Engine 선택 시**:
  - 장점: AAA급 그래픽, Blueprint 시각적 스크립팅, 강력한 렌더링
  - 적합 장르: 3D 액션, FPS, 오픈월드
  - 학습곡선: 높음

**권장**: Unity (빠른 검증과 반복을 위해)

### 플랫폼 전략
1. **Phase 1 (프로토타입)**: PC (Steam) - 가장 빠른 배포와 피드백
2. **Phase 2 (콘텐츠 확장)**: PC + 콘솔 고려 (Switch, PlayStation)
3. **Phase 3 (밸런싱)**: 모바일 포팅 검토 (필요 시)

### 개발 도구 스택
```
엔진: Unity 2023 LTS
언어: C#
버전 관리: Git + GitHub
협업: Unity Collaborate / Plastic SCM
분석: Unity Analytics + Custom Telemetry
CI/CD: GitHub Actions
배포: Steam, itch.io
```

---

## Phase 1: 핵심 메커니즘 프로토타입 (4-6개월)

### 목표 (Objective)
> "게임의 핵심 재미를 검증하고, 기술적 실현 가능성을 확보한다"

**기간**: Month 1-6
**상태**: Planning → In Progress → Completed
**Overall Progress**: 0% (자동 계산)

### Key Results

#### KR1: 핵심 루프 구현 (Weight: 40%)
- **Metric Type**: Boolean (완료/미완료)
- **Target**: 1 (완료)
- **Definition**: 플레이어가 10분 동안 반복해서 즐길 수 있는 최소 게임 루프
- **Success Criteria**:
  - [ ] 플레이어 입력 → 게임 반응 → 보상 → 다음 도전 순환 구현
  - [ ] 10명 테스트 플레이 시 7명 이상 "재미있다" 평가
  - [ ] 평균 플레이 시간 15분 이상

#### KR2: 기술적 안정성 확보 (Weight: 30%)
- **Metric Type**: Percentage
- **Target**: 95%
- **Current**: 0%
- **Measurement**: (성공한 빌드 수 / 전체 빌드 수) × 100
- **Success Criteria**:
  - [ ] 60 FPS 안정적 유지 (타겟 플랫폼)
  - [ ] 크래시 없이 30분 연속 플레이 가능
  - [ ] 메모리 누수 0건

#### KR3: 플레이테스터 피드백 수집 (Weight: 20%)
- **Metric Type**: Number
- **Target**: 50명
- **Current**: 0명
- **Unit**: "playtests"
- **Success Criteria**:
  - [ ] 최소 50명의 외부 테스터 확보
  - [ ] 정량 피드백 수집 (NPS, 재미도 1-10점)
  - [ ] 정성 피드백 분석 (주요 불만 사항 Top 5)

#### KR4: 개발 파이프라인 구축 (Weight: 10%)
- **Metric Type**: Boolean
- **Target**: 1
- **Success Criteria**:
  - [ ] Git 기반 버전 관리 워크플로우
  - [ ] 자동화된 빌드 시스템
  - [ ] 기본 에셋 관리 체계

---

### Deliverables (Phase 1)

#### M1.1: 핵심 메커니즘 테스트베드 (Week 1-4)
- **Task**: 게임의 핵심 1-2가지 메커니즘만 구현
- **Example**:
  - 액션 게임 → 공격/회피 시스템
  - 퍼즐 게임 → 기본 매칭 로직
  - 전략 게임 → 유닛 생성/이동
- **Deliverable**:
  - [ ] 플레이 가능한 씬 1개
  - [ ] GDD (Game Design Document) v0.1
  - [ ] 내부 플레이테스트 영상 3분

#### M1.2: 프로토타입 v1.0 - 수직 슬라이스 (Week 5-12)
- **Task**: 게임의 한 레벨/스테이지를 완성도 높게 구현
- **Deliverable**:
  - [ ] 튜토리얼 → 게임플레이 → 종료 플로우
  - [ ] 임시 그래픽/사운드 적용
  - [ ] Windows 빌드 (itch.io 비공개 배포)
  - [ ] 플레이테스터 모집 페이지

#### M1.3: 피드백 반영 및 반복 (Week 13-20)
- **Task**: 테스터 피드백을 기반으로 3회 이상 반복 개선
- **Deliverable**:
  - [ ] 플레이테스트 리포트 (iteration별)
  - [ ] 개선 전후 비교 영상
  - [ ] GDD v1.0 (확정된 핵심 메커니즘)

#### M1.4: Phase 1 검증 (Week 21-24)
- **Task**: 핵심 메커니즘이 충분히 재미있는지 Go/No-Go 결정
- **Deliverable**:
  - [ ] 플레이테스트 분석 리포트
  - [ ] NPS 점수: 30 이상 (목표)
  - [ ] Phase 2 진입 결정 문서
  - [ ] 필요시 피벗(Pivot) 계획

---

### 리소스 계획 (Phase 1)

| 역할 | 인원 | 시간 투입 |
|------|------|-----------|
| 게임 디자이너 | 1명 | Full-time |
| 프로그래머 | 1-2명 | Full-time |
| 아티스트 | 0.5명 | Part-time (임시 에셋 사용) |
| 사운드 디자이너 | 0명 | 무료 에셋 사용 |
| QA 테스터 | 외주 | 주 1회 세션 |

**예산 (6개월)**:
- 인건비: $50,000 - $80,000
- 도구/라이선스: $2,000 (Unity Pro, 에셋 스토어)
- 테스팅: $3,000 (플레이테스터 보상)
- 기타: $5,000
- **총**: $60,000 - $90,000

---

## Phase 2: 콘텐츠 확장 (4-6개월)

### 목표 (Objective)
> "검증된 핵심 메커니즘을 기반으로 풍부한 콘텐츠를 제작하여 재플레이성을 확보한다"

**기간**: Month 7-12
**상태**: Pending
**Overall Progress**: 0%

### Key Results

#### KR1: 콘텐츠 볼륨 목표 달성 (Weight: 35%)
- **Metric Type**: Percentage
- **Target**: 100%
- **Measurement**: (완성된 콘텐츠 / 계획된 콘텐츠) × 100
- **Definition**:
  - 레벨/스테이지: 15-20개
  - 캐릭터/유닛: 8-12종
  - 아이템/스킬: 20-30종
  - 스토리 분량: 2-3시간 (필요 시)

#### KR2: 플레이 시간 연장 (Weight: 30%)
- **Metric Type**: Number
- **Target**: 600 (분)
- **Current**: 0
- **Unit**: "minutes"
- **Measurement**: 평균 플레이어의 첫 플레이스루 완료 시간
- **Success Criteria**: 10시간 이상의 콘텐츠 제공

#### KR3: 콘텐츠 다양성 확보 (Weight: 20%)
- **Metric Type**: Percentage
- **Target**: 80%
- **Measurement**: (중복되지 않는 게임플레이 패턴 비율)
- **Success Criteria**:
  - [ ] 레벨별 차별화된 메커니즘 도입
  - [ ] 플레이어 선택지 3가지 이상 경로

#### KR4: 메타 게임 시스템 구축 (Weight: 15%)
- **Metric Type**: Boolean
- **Target**: 1
- **Success Criteria**:
  - [ ] 진행 저장/로드 시스템
  - [ ] 업그레이드/언락 시스템
  - [ ] 리더보드/업적 시스템

---

### Deliverables (Phase 2)

#### M2.1: 아트 파이프라인 구축 (Week 1-6)
- **Task**: 임시 그래픽을 실제 아트워크로 교체
- **Deliverable**:
  - [ ] 아트 스타일 가이드 확정
  - [ ] 캐릭터 리깅/애니메이션 시스템
  - [ ] 환경 에셋 라이브러리 (모듈형)
  - [ ] UI/UX 최종 디자인

#### M2.2: 레벨 디자인 및 제작 (Week 7-16)
- **Task**: 15-20개 레벨 제작 및 밸런스 조정
- **Deliverable**:
  - [ ] 레벨 디자인 템플릿
  - [ ] 난이도 곡선 설계 (Easy → Hard)
  - [ ] 각 레벨별 플레이테스트
  - [ ] 보스/특수 이벤트 구현

#### M2.3: 시스템 통합 (Week 17-20)
- **Task**: 모든 시스템을 하나의 빌드로 통합
- **Deliverable**:
  - [ ] 세이브/로드 시스템
  - [ ] 설정 메뉴 (그래픽, 사운드, 컨트롤)
  - [ ] 튜토리얼 시퀀스
  - [ ] 트레일러용 스크립트 시퀀스

#### M2.4: 알파 빌드 (Week 21-24)
- **Task**: 기능 완성된 알파 버전 출시
- **Deliverable**:
  - [ ] Steam 페이지 오픈 (Wishlist 수집)
  - [ ] 알파 테스터 50-100명 모집
  - [ ] 크리티컬 버그 0건
  - [ ] GDD v2.0 (최종 확정)

---

### 리소스 계획 (Phase 2)

| 역할 | 인원 | 시간 투입 |
|------|------|-----------|
| 게임 디자이너 | 1명 | Full-time |
| 프로그래머 | 2명 | Full-time |
| 2D/3D 아티스트 | 2명 | Full-time |
| 사운드 디자이너 | 1명 | Part-time |
| 레벨 디자이너 | 1명 | Full-time |
| QA 테스터 | 외주 | 주 2-3회 |

**예산 (6개월)**:
- 인건비: $120,000 - $180,000
- 아트 외주: $20,000
- 사운드/음악: $15,000
- 마케팅 (Steam 페이지): $5,000
- 기타: $10,000
- **총**: $170,000 - $230,000

---

## Phase 3: 밸런싱 및 출시 준비 (4-6개월)

### 목표 (Objective)
> "데이터 기반 밸런싱을 통해 최적의 게임 경험을 제공하고, 성공적인 출시를 달성한다"

**기간**: Month 13-18
**상태**: Pending
**Overall Progress**: 0%

### Key Results

#### KR1: 밸런싱 완료 (Weight: 40%)
- **Metric Type**: Percentage
- **Target**: 100%
- **Measurement**: (밸런싱 완료된 요소 / 전체 요소) × 100
- **Success Criteria**:
  - [ ] 플레이어 리텐션 > 40% (Day 7)
  - [ ] 평균 세션 시간 > 45분
  - [ ] 난이도별 클리어율: Easy(90%), Normal(60%), Hard(30%)

#### KR2: 버그 수정율 (Weight: 25%)
- **Metric Type**: Percentage
- **Target**: 100%
- **Current**: 0%
- **Measurement**: (수정된 크리티컬 버그 / 전체 크리티컬 버그) × 100
- **Success Criteria**:
  - [ ] P0 (크래시) 버그 0건
  - [ ] P1 (게임플레이 차단) 버그 0건
  - [ ] P2 (주요 불편) 버그 < 5건

#### KR3: Steam Wishlist 확보 (Weight: 20%)
- **Metric Type**: Number
- **Target**: 10000
- **Current**: 0
- **Unit**: "wishlists"
- **Success Criteria**: 출시 전 1만 Wishlist 확보

#### KR4: 성공적 출시 (Weight: 15%)
- **Metric Type**: Boolean
- **Target**: 1
- **Success Criteria**:
  - [ ] Steam 출시 완료
  - [ ] 메타크리틱 점수 > 75
  - [ ] 첫 주 판매량 > 1,000 copies

---

### Deliverables (Phase 3)

#### M3.1: 텔레메트리 시스템 구축 (Week 1-4)
- **Task**: 플레이어 행동 데이터 수집 및 분석
- **Deliverable**:
  - [ ] Unity Analytics 연동
  - [ ] 커스텀 이벤트 트래킹 (20+ 지표)
  - [ ] 실시간 대시보드 (Life Dashboard 통합)
  - [ ] A/B 테스트 프레임워크

#### M3.2: 데이터 기반 밸런싱 (Week 5-12)
- **Task**: 텔레메트리 데이터를 기반으로 반복 조정
- **Deliverable**:
  - [ ] 주간 밸런스 패치 (8회)
  - [ ] 난이도 곡선 최적화
  - [ ] 보상 체계 조정
  - [ ] 밸런싱 리포트 (iteration별)

**주요 밸런싱 지표**:
```
- 레벨 클리어율 (목표: 60-80%)
- 평균 사망 횟수 (목표: 레벨당 2-3회)
- 아이템 사용 비율 (모든 아이템 > 10% 사용)
- 플레이어 이탈 지점 (특정 레벨에 집중되지 않도록)
```

#### M3.3: 베타 테스트 (Week 13-18)
- **Task**: 공개 베타 테스트 운영
- **Deliverable**:
  - [ ] Steam Playtest 오픈 (500-1000명)
  - [ ] 커뮤니티 Discord 서버 운영
  - [ ] 버그 리포트 시스템
  - [ ] 주간 업데이트 노트

#### M3.4: 출시 준비 (Week 19-24)
- **Task**: 마케팅 및 최종 폴리싱
- **Deliverable**:
  - [ ] 출시 트레일러 제작
  - [ ] 프레스 킷 배포
  - [ ] 인플루언서 키 배포 (50개)
  - [ ] 출시 이벤트 (할인, 번들 등)
  - [ ] **Gold Master Build**

---

### 리소스 계획 (Phase 3)

| 역할 | 인원 | 시간 투입 |
|------|------|-----------|
| 게임 디자이너 | 1명 | Full-time |
| 프로그래머 | 2명 | Full-time |
| 데이터 분석가 | 1명 | Full-time |
| QA 테스터 | 3명 | Full-time |
| 커뮤니티 매니저 | 1명 | Full-time |
| 마케팅 | 외주 | 프로젝트 기반 |

**예산 (6개월)**:
- 인건비: $150,000 - $200,000
- QA/테스팅: $30,000
- 마케팅: $50,000 (트레일러, 인플루언서)
- 로컬라이제이션: $15,000 (5개 언어)
- 기타: $10,000
- **총**: $255,000 - $305,000

---

## 마일스톤 타임라인

```
Month 1-6   : Phase 1 - 핵심 메커니즘 프로토타입
├─ M1.1 (Week 1-4)    : 테스트베드
├─ M1.2 (Week 5-12)   : 수직 슬라이스
├─ M1.3 (Week 13-20)  : 피드백 반영
└─ M1.4 (Week 21-24)  : Go/No-Go 결정

Month 7-12  : Phase 2 - 콘텐츠 확장
├─ M2.1 (Week 1-6)    : 아트 파이프라인
├─ M2.2 (Week 7-16)   : 레벨 디자인
├─ M2.3 (Week 17-20)  : 시스템 통합
└─ M2.4 (Week 21-24)  : 알파 빌드

Month 13-18 : Phase 3 - 밸런싱 및 출시
├─ M3.1 (Week 1-4)    : 텔레메트리
├─ M3.2 (Week 5-12)   : 데이터 밸런싱
├─ M3.3 (Week 13-18)  : 베타 테스트
└─ M3.4 (Week 19-24)  : 출시 준비

Month 19+   : Post-Launch Support
└─ 패치, DLC, 커뮤니티 운영
```

---

## 리스크 관리

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| 핵심 메커니즘이 재미없음 | High | Phase 1에서 빠른 검증 및 피벗 |
| 예산 초과 | Medium | 우선순위 기반 기능 축소 (MVP 접근) |
| 기술적 문제 (성능, 버그) | Medium | 정기적인 기술 리뷰, 외부 컨설팅 |
| 팀원 이탈 | High | 지식 공유, 문서화, 백업 인력 |
| 시장 경쟁 | Medium | 차별화 포인트 명확화, 빠른 출시 |

---

## 성공 지표 (KPI)

### Phase 1
- ✅ 내부 플레이테스트 NPS > 30
- ✅ 외부 플레이테스트 50명 참여
- ✅ 핵심 루프 10분 리텐션 > 70%

### Phase 2
- ✅ Steam Wishlist > 5,000 (알파 출시 시점)
- ✅ 플레이타임 > 10시간 (메인 콘텐츠)
- ✅ 크리티컬 버그 < 5건

### Phase 3
- ✅ Steam Wishlist > 10,000 (출시 시점)
- ✅ Day 7 Retention > 40%
- ✅ 첫 주 판매 > 1,000 copies
- ✅ 메타크리틱 > 75

---

## Life Dashboard 통합

이 로드맵을 Life Dashboard에 통합하여 실시간 진척률 추적:

### 1. 프로젝트 생성
```bash
POST /api/projects
{
  "name": "게임 개발 프로젝트",
  "description": "핵심 메커니즘부터 출시까지",
  "status": "active",
  "url": "https://github.com/yourteam/game-project"
}
```

### 2. OKR 생성
```bash
# Phase 1 Objective
POST /api/okr/objectives
{
  "title": "Phase 1: 핵심 메커니즘 프로토타입",
  "period_type": "custom",
  "start_date": "2025-03-01",
  "end_date": "2025-08-31",
  "status": "active"
}

# Key Results 추가 (KR1-4)
POST /api/okr/key-results
{
  "objective_id": "...",
  "title": "핵심 루프 구현",
  "metric_type": "boolean",
  "target_value": 1,
  "weight": 40
}
```

### 3. 태스크 연동
각 Deliverable을 Task Queue에 추가하고 프로젝트에 연결:
```bash
POST /api/projects/{projectId}/tasks
{
  "task_execution_id": "...",
  "metadata": {
    "task_title": "M1.1: 핵심 메커니즘 테스트베드",
    "task_status": "running",
    "task_type": "development"
  }
}
```

### 4. 실시간 메트릭 조회
```bash
GET /api/projects/metrics
# → 완료율, 성공률, 평균 실행 시간 등 자동 계산
```

---

## 결론

이 로드맵은 **검증 → 확장 → 최적화** 순서로 리스크를 최소화하면서 게임 개발을 진행합니다.

**핵심 원칙**:
1. **Phase 1에서 재미 검증** - 재미없으면 빠르게 피벗
2. **데이터 기반 의사결정** - 텔레메트리 + Life Dashboard 연동
3. **점진적 폴리싱** - 임시 에셋 → 실제 아트 → 최종 폴리싱
4. **커뮤니티 중심** - 초기부터 플레이테스터와 긴밀한 소통

**예상 총 예산**: $485,000 - $625,000 (18개월)
**최소 팀 규모**: 5-7명 (Full-time equivalent)
**출시 목표**: Month 18 (Steam Early Access 또는 Full Release)
