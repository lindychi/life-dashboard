-- 004_task_dependencies.sql
-- 태스크 간 의존성(depends_on) 지원: 순서 보장 + 병렬 실행

-- ─── 1. depends_on 컬럼 추가 ─────────────────────────────
-- UUID 배열: 이 태스크가 시작되려면 완료되어야 하는 선행 태스크 ID 목록
ALTER TABLE task_queue
  ADD COLUMN IF NOT EXISTS depends_on UUID[] NOT NULL DEFAULT '{}';

-- ─── 2. 의존성 조회용 인덱스 ─────────────────────────────
-- GIN 인덱스: depends_on 배열 검색 최적화
CREATE INDEX IF NOT EXISTS idx_task_queue_depends_on
  ON task_queue USING GIN (depends_on);

-- ─── 3. 의존 태스크 상태 조회 함수 ───────────────────────
-- 주어진 태스크의 모든 선행 태스크가 completed인지 확인
CREATE OR REPLACE FUNCTION are_dependencies_met(task_id UUID)
RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM unnest(
      (SELECT depends_on FROM task_queue WHERE id = task_id)
    ) AS dep_id
    WHERE NOT EXISTS (
      SELECT 1 FROM task_queue
      WHERE id = dep_id AND status = 'completed'
    )
  );
$$ LANGUAGE SQL STABLE;
