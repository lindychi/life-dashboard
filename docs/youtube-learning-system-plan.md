# YouTube 채널 학습 시스템 프로젝트 설계

## 프로젝트 개요

**프로젝트명**: YouTube 채널 학습 시스템
**상태**: Active
**현재 진행률**: 30%
**설명**: YouTube 콘텐츠 기반 지속적 학습 체계. 자동화된 영상 수집, 분석, 인사이트 추출 및 적용 시스템.

---

## OKR 구조

### Objective (목표)
**제목**: "YouTube 콘텐츠 기반 지속적 학습 체계 구축"
**기간**: Q1 2025 (2025-01-01 ~ 2025-03-31)
**소유자**: hanchi
**설명**: YouTube에서 수집한 콘텐츠를 체계적으로 분석하고 인사이트를 추출하여 개인 성장과 업무에 적용하는 자동화 시스템 구축

### Key Results

#### KR1: 분석된 영상 수
- **제목**: 분석된 영상 수 50개 달성
- **측정 단위**: 개 (videos)
- **목표값**: 50
- **현재값**: 0
- **가중치**: 25%
- **상태**: active

#### KR2: 추출된 인사이트 수
- **제목**: 추출된 인사이트 200개 달성
- **측정 단위**: 개 (insights)
- **목표값**: 200
- **현재값**: 0
- **가중치**: 30%
- **상태**: active

#### KR3: 학습 자동화 가동률
- **제목**: 학습 자동화 시스템 가동률 95% 이상 유지
- **측정 단위**: % (percentage)
- **목표값**: 95
- **현재값**: 0
- **가중치**: 25%
- **상태**: active
- **측정 방법**: (정상 가동 시간 / 전체 시간) × 100

#### KR4: 주간 리뷰 완료율
- **제목**: 주간 리뷰 12회 완료 (12주)
- **측정 단위**: % (percentage)
- **목표값**: 100
- **현재값**: 0
- **가중치**: 20%
- **상태**: active
- **측정 방법**: (완료된 주간 리뷰 수 / 12) × 100

---

## 프로젝트 KPI

1. **자동화 가동률**: 측정 중 → tmux 세션 상태, cron 작업 상태로 계산
2. **분석된 영상 수**: 0/50 (Q1 목표)
3. **추출된 인사이트**: 0/200 (Q1 목표)

---

## 정기 리뷰 일정

### 일일 (자동화)
- **시간**: 매일 오전 9시
- **작업**:
  - 새로운 영상 수집 (RSS/API)
  - 자동 전사 및 번역
  - 1차 인사이트 추출
  - 데이터베이스 저장

### 주간 (수동)
- **시간**: 매주 일요일 오후
- **작업**:
  - 주간 수집 영상 리뷰
  - 인사이트 정리 및 분류
  - 적용 가능한 액션 아이템 도출
  - 옵시디언 주간회고 연동
- **체크리스트**:
  - [ ] 이번 주 분석된 영상 수 확인
  - [ ] 핵심 인사이트 5개 선정
  - [ ] 액션 아이템 생성 (최소 3개)
  - [ ] 옵시디언 주간회고에 기록
  - [ ] KR 진행률 업데이트

### 월간 (수동)
- **시간**: 매월 마지막 일요일
- **작업**:
  - 월간 학습 성과 리뷰
  - 자동화 시스템 개선 사항 도출
  - 다음 달 학습 목표 설정
  - OKR 진행률 점검
- **체크리스트**:
  - [ ] 월간 영상 분석 수 집계
  - [ ] 월간 인사이트 수 집계
  - [ ] 자동화 가동률 계산
  - [ ] 시스템 이슈 분석 및 개선 계획 수립
  - [ ] 다음 달 목표 조정

### 분기 (수동)
- **시간**: 분기 마지막 주
- **작업**:
  - OKR 달성도 평가
  - 다음 분기 OKR 설정
  - 시스템 아키텍처 리뷰
  - 학습 콘텐츠 아카이빙

---

## 시스템 구성 요소

### 1. 데이터 수집
- **채널 목록**: `~/youtube-learning/channels.json`
- **수집 방법**: YouTube Data API v3 또는 RSS
- **저장 위치**: PostgreSQL (새 테이블 필요)

### 2. 전사 & 번역
- **도구**: Whisper API 또는 YouTube 자동 자막
- **번역**: GPT-4 또는 Claude
- **저장**: 전사본 텍스트 파일 + DB

### 3. 인사이트 추출
- **AI 모델**: Claude Sonnet 3.5
- **추출 항목**:
  - 핵심 개념
  - 실행 가능한 팁
  - 참고 자료
  - 적용 가능한 업무 영역
- **저장**: 구조화된 JSON + DB

### 4. 자동화 스케줄러
- **도구**: cron 또는 node-schedule
- **tmux 세션**: `youtube-learner`
- **로그**: `~/youtube-learning/logs/`

### 5. 옵시디언 연동
- **일일노트**: `~/groundone/daily/YYYY-MM-DD.md`
- **주간회고**: `~/groundone/weekly/YYYY-Www.md`
- **인사이트 아카이브**: `~/groundone/youtube-insights/`

---

## 데이터베이스 스키마 (제안)

```sql
-- 채널 정보
CREATE TABLE youtube_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id VARCHAR(255) UNIQUE NOT NULL,
  channel_name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  priority INTEGER DEFAULT 5,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 영상 정보
CREATE TABLE youtube_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES youtube_channels(id),
  video_id VARCHAR(255) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMP,
  duration INTEGER, -- seconds
  transcript TEXT,
  summary TEXT,
  analyzed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  analyzed_at TIMESTAMP
);

-- 추출된 인사이트
CREATE TABLE youtube_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES youtube_videos(id),
  insight_type VARCHAR(50), -- concept, tip, reference, action
  content TEXT NOT NULL,
  category VARCHAR(100),
  priority INTEGER DEFAULT 3,
  applied BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  applied_at TIMESTAMP
);

-- 학습 세션 로그
CREATE TABLE learning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type VARCHAR(50), -- daily, weekly, monthly
  videos_processed INTEGER DEFAULT 0,
  insights_extracted INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 구현 단계

### Phase 1: 기반 구축 (1-2주)
- [ ] 데이터베이스 스키마 생성
- [ ] YouTube API 연동
- [ ] 기본 수집 스크립트 작성
- [ ] 옵시디언 연동 테스트

### Phase 2: 자동화 (2-3주)
- [ ] 전사 자동화
- [ ] 인사이트 추출 AI 파이프라인
- [ ] cron 작업 설정
- [ ] 모니터링 대시보드

### Phase 3: 고도화 (3-4주)
- [ ] 중복 제거 로직
- [ ] 카테고리 자동 분류
- [ ] 우선순위 자동 계산
- [ ] 적용 추적 시스템

### Phase 4: 최적화 (4주~)
- [ ] 성능 튜닝
- [ ] 비용 최적화
- [ ] UI/UX 개선
- [ ] 분석 리포트 자동 생성

---

## 성공 지표

### 정량적 지표
- 분석된 영상 수: 50개/분기
- 추출된 인사이트: 200개/분기
- 자동화 가동률: 95% 이상
- 주간 리뷰 완료율: 100%

### 정성적 지표
- 업무에 직접 적용된 인사이트 비율
- 학습 효율성 개선 체감도
- 시스템 유지보수 부담 감소
- 옵시디언 노트 품질 향상

---

## 위험 요소 및 대응

### 위험 1: API 비용 초과
- **대응**: 무료 티어 한도 모니터링, RSS 우선 사용

### 위험 2: AI 분석 정확도 저하
- **대응**: 프롬프트 지속 개선, 피드백 루프 구축

### 위험 3: 자동화 시스템 장애
- **대응**: 헬스 체크 스크립트, 알림 시스템

### 위험 4: 정보 과부하
- **대응**: 우선순위 필터링, 카테고리별 제한

---

## 다음 단계

1. **즉시**: Life Dashboard에서 프로젝트 수동 생성
2. **즉시**: OKR 수동 생성 (Objective + 4개 Key Results)
3. **1일 내**: 데이터베이스 스키마 생성 SQL 실행
4. **1주 내**: 첫 번째 자동화 스크립트 작성
5. **2주 내**: 첫 주간 리뷰 진행 및 회고

---

## 참고 문서

- Life Dashboard 프로젝트 시스템: `/docs/project-metrics-system.md`
- Life Dashboard OKR 시스템: `/docs/okr-system.md`
- 옵시디언 볼트 위치: `~/groundone`
