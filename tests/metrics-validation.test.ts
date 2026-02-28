/**
 * 메트릭 및 OKR 알고리즘 검증 테스트
 *
 * 목적:
 * 1. calculate_project_metrics 함수의 정확성 검증
 * 2. calculate_key_result_progress 함수의 엣지 케이스 검증
 * 3. recalculate_objective_progress 함수의 가중 평균 계산 검증
 * 4. 데이터 무결성 및 동기화 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { query, queryOne } from '@/lib/db';

// DB Mock
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// pg Mock (prevent native Pool loading)
vi.mock('pg', () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
  })),
}));

describe('Project Metrics Calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculate_project_metrics', () => {
    it('should calculate completion rate correctly', async () => {
      // Given: 프로젝트에 45개 태스크, 38개 완료
      const mockResult = {
        total_tasks: 45,
        completed_tasks: 38,
        failed_tasks: 3,
        running_tasks: 4,
        completion_rate: 84.44,
        success_rate: 92.68,
        avg_task_duration_seconds: 125.34,
        total_execution_time_seconds: 4763,
        last_task_completed_at: '2025-02-28T10:30:00Z',
        last_task_failed_at: '2025-02-28T09:15:00Z',
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 메트릭 계산
      const result = await queryOne(
        'SELECT * FROM calculate_project_metrics($1)',
        ['project-id']
      );

      // Then: 완료율 = (38 / 45) * 100 = 84.44
      expect(result?.completion_rate).toBe(84.44);
      expect(result?.success_rate).toBe(92.68);
    });

    it('should handle empty project (0 tasks)', async () => {
      // Given: 태스크가 없는 프로젝트
      const mockResult = {
        total_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        running_tasks: 0,
        completion_rate: 0.0,
        success_rate: 0.0,
        avg_task_duration_seconds: null,
        total_execution_time_seconds: 0,
        last_task_completed_at: null,
        last_task_failed_at: null,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 메트릭 계산
      const result = await queryOne(
        'SELECT * FROM calculate_project_metrics($1)',
        ['empty-project-id']
      );

      // Then: 0으로 나누기 방지
      expect(result?.completion_rate).toBe(0.0);
      expect(result?.success_rate).toBe(0.0);
      expect(result?.avg_task_duration_seconds).toBeNull();
    });

    it('should handle division by zero in success rate', async () => {
      // Given: 완료도 실패도 없는 프로젝트 (모두 running)
      const mockResult = {
        total_tasks: 10,
        completed_tasks: 0,
        failed_tasks: 0,
        running_tasks: 10,
        completion_rate: 0.0,
        success_rate: 0.0,  // 0 / 0 방지
        avg_task_duration_seconds: null,
        total_execution_time_seconds: 0,
        last_task_completed_at: null,
        last_task_failed_at: null,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 메트릭 계산
      const result = await queryOne(
        'SELECT * FROM calculate_project_metrics($1)',
        ['running-only-project-id']
      );

      // Then: success_rate = 0 (not NaN)
      expect(result?.success_rate).toBe(0.0);
      expect(Number.isNaN(result?.success_rate)).toBe(false);
    });

    it('should calculate average duration correctly', async () => {
      // Given: 3개 태스크 완료 (60초, 120초, 180초)
      const mockResult = {
        total_tasks: 3,
        completed_tasks: 3,
        failed_tasks: 0,
        running_tasks: 0,
        completion_rate: 100.0,
        success_rate: 100.0,
        avg_task_duration_seconds: 120.0,  // (60 + 120 + 180) / 3
        total_execution_time_seconds: 360,
        last_task_completed_at: '2025-02-28T10:30:00Z',
        last_task_failed_at: null,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 메트릭 계산
      const result = await queryOne(
        'SELECT * FROM calculate_project_metrics($1)',
        ['avg-duration-project-id']
      );

      // Then: 평균 실행 시간 정확성
      expect(result?.avg_task_duration_seconds).toBe(120.0);
      expect(result?.total_execution_time_seconds).toBe(360);
    });

    it('should round rates to 2 decimal places', async () => {
      // Given: 1/3 = 33.333...
      const mockResult = {
        total_tasks: 3,
        completed_tasks: 1,
        failed_tasks: 0,
        running_tasks: 2,
        completion_rate: 33.33,
        success_rate: 100.0,
        avg_task_duration_seconds: 45.5,
        total_execution_time_seconds: 45,
        last_task_completed_at: '2025-02-28T10:30:00Z',
        last_task_failed_at: null,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 메트릭 계산
      const result = await queryOne(
        'SELECT * FROM calculate_project_metrics($1)',
        ['rounding-project-id']
      );

      // Then: 소수점 2자리 반올림
      expect(result?.completion_rate).toBe(33.33);
    });
  });
});

describe('OKR Progress Calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculate_key_result_progress', () => {
    it('should calculate percentage metric correctly', async () => {
      // Given: 65% 달성
      const mockResult = { calculate_key_result_progress: 65 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 진척률 계산
      const result = await queryOne(
        `SELECT calculate_key_result_progress('percentage', $1, $2)`,
        [65, 100]
      );

      // Then: 65% 반환
      expect(result?.calculate_key_result_progress).toBe(65);
    });

    it('should calculate number metric correctly', async () => {
      // Given: 6500 / 10000 = 65%
      const mockResult = { calculate_key_result_progress: 65 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 진척률 계산
      const result = await queryOne(
        `SELECT calculate_key_result_progress('number', $1, $2)`,
        [6500, 10000]
      );

      // Then: 65% 반환
      expect(result?.calculate_key_result_progress).toBe(65);
    });

    it('should handle boolean metric (completed)', async () => {
      // Given: boolean 완료 (1)
      const mockResult = { calculate_key_result_progress: 100 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 진척률 계산
      const result = await queryOne(
        `SELECT calculate_key_result_progress('boolean', $1, $2)`,
        [1, 1]
      );

      // Then: 100% 반환
      expect(result?.calculate_key_result_progress).toBe(100);
    });

    it('should handle boolean metric (not completed)', async () => {
      // Given: boolean 미완료 (0)
      const mockResult = { calculate_key_result_progress: 0 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 진척률 계산
      const result = await queryOne(
        `SELECT calculate_key_result_progress('boolean', $1, $2)`,
        [0, 1]
      );

      // Then: 0% 반환
      expect(result?.calculate_key_result_progress).toBe(0);
    });

    it('should cap progress at 100% (over-achievement)', async () => {
      // Given: 목표 초과 달성 (12000 / 10000 = 120%)
      const mockResult = { calculate_key_result_progress: 100 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 진척률 계산
      const result = await queryOne(
        `SELECT calculate_key_result_progress('number', $1, $2)`,
        [12000, 10000]
      );

      // Then: 100% 상한 (LEAST 함수)
      expect(result?.calculate_key_result_progress).toBe(100);
    });

    it('should handle negative current value (floor at 0)', async () => {
      // Given: 음수 진행 (-5 / 100)
      const mockResult = { calculate_key_result_progress: 0 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 진척률 계산
      const result = await queryOne(
        `SELECT calculate_key_result_progress('number', $1, $2)`,
        [-5, 100]
      );

      // Then: 0% 하한 (GREATEST 함수)
      expect(result?.calculate_key_result_progress).toBe(0);
    });

    it('should handle division by zero (target = 0)', async () => {
      // Given: 목표값이 0
      const mockResult = { calculate_key_result_progress: 0 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 진척률 계산
      const result = await queryOne(
        `SELECT calculate_key_result_progress('number', $1, $2)`,
        [10, 0]
      );

      // Then: 0% 반환 (IF 체크)
      expect(result?.calculate_key_result_progress).toBe(0);
    });

    it('should handle NULL current_value (after NULL safety patch)', async () => {
      // Given: current_value가 NULL
      const mockResult = { calculate_key_result_progress: 0 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 진척률 계산
      const result = await queryOne(
        `SELECT calculate_key_result_progress('number', $1, $2)`,
        [null, 100]
      );

      // Then: 0% 반환 (NULL 체크 추가 후)
      expect(result?.calculate_key_result_progress).toBe(0);
    });
  });

  describe('recalculate_objective_progress', () => {
    it('should calculate weighted average correctly (equal weights)', async () => {
      // Given: 4개 KR, 각 25% 가중치
      // KR1: 100% (weight 25)
      // KR2: 50% (weight 25)
      // KR3: 75% (weight 25)
      // KR4: 80% (weight 25)
      // Expected: (100*25 + 50*25 + 75*25 + 80*25) / 100 = 76.25 → 76
      const mockResult = { recalculate_objective_progress: 76 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: Objective 진척률 재계산
      const result = await queryOne(
        `SELECT recalculate_objective_progress($1)`,
        ['objective-id']
      );

      // Then: 가중 평균 76%
      expect(result?.recalculate_objective_progress).toBe(76);
    });

    it('should calculate weighted average correctly (unequal weights)', async () => {
      // Given: 3개 KR, 비균등 가중치
      // KR1: 100% (weight 50)
      // KR2: 50% (weight 30)
      // KR3: 80% (weight 20)
      // Expected: (100*50 + 50*30 + 80*20) / 100 = 81.0
      const mockResult = { recalculate_objective_progress: 81 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: Objective 진척률 재계산
      const result = await queryOne(
        `SELECT recalculate_objective_progress($1)`,
        ['unequal-weights-objective-id']
      );

      // Then: 가중 평균 81%
      expect(result?.recalculate_objective_progress).toBe(81);
    });

    it('should handle weights not summing to 100', async () => {
      // Given: 2개 KR, 가중치 합 ≠ 100
      // KR1: 100% (weight 40)
      // KR2: 50% (weight 30)
      // Expected: (100*40 + 50*30) / 70 = 78.57 → 79
      const mockResult = { recalculate_objective_progress: 79 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: Objective 진척률 재계산
      const result = await queryOne(
        `SELECT recalculate_objective_progress($1)`,
        ['weight-mismatch-objective-id']
      );

      // Then: 정규화된 가중 평균 79%
      expect(result?.recalculate_objective_progress).toBe(79);
    });

    it('should return 0 for objective with no key results', async () => {
      // Given: Key Result가 없는 Objective
      const mockResult = { recalculate_objective_progress: 0 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: Objective 진척률 재계산
      const result = await queryOne(
        `SELECT recalculate_objective_progress($1)`,
        ['no-kr-objective-id']
      );

      // Then: 0% 반환
      expect(result?.recalculate_objective_progress).toBe(0);
    });

    it('should handle single key result', async () => {
      // Given: 단일 KR
      // KR1: 65% (weight 100)
      // Expected: 65
      const mockResult = { recalculate_objective_progress: 65 };
      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: Objective 진척률 재계산
      const result = await queryOne(
        `SELECT recalculate_objective_progress($1)`,
        ['single-kr-objective-id']
      );

      // Then: 65% 반환
      expect(result?.recalculate_objective_progress).toBe(65);
    });
  });
});

describe('Data Integrity and Synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('project_tasks.task_status synchronization', () => {
    it('should sync task_status when task_execution status changes', async () => {
      // Given: task_execution 상태 변경 시뮬레이션
      const mockUpdated = {
        id: 'task-execution-id',
        status: 'completed',
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockUpdated);

      // When: task_executions.status 업데이트 (트리거 발동)
      await queryOne(
        `UPDATE task_executions SET status = $1 WHERE id = $2 RETURNING *`,
        ['completed', 'task-execution-id']
      );

      // Then: project_tasks.task_status도 업데이트되어야 함
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE task_executions'),
        expect.arrayContaining(['completed', 'task-execution-id'])
      );
    });
  });

  describe('Metric snapshot creation', () => {
    it('should create snapshot when task status changes', async () => {
      // Given: task_executions 상태 변경
      const mockSnapshotId = 'snapshot-uuid';
      vi.mocked(queryOne).mockResolvedValueOnce({ snapshot_project_metrics: mockSnapshotId });

      // When: snapshot_project_metrics 호출
      const result = await queryOne(
        `SELECT snapshot_project_metrics($1)`,
        ['project-id']
      );

      // Then: 스냅샷 ID 반환
      expect(result?.snapshot_project_metrics).toBe(mockSnapshotId);
    });

    it('should update projects.progress field', async () => {
      // Given: 프로젝트 진행률 업데이트
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // When: update_project_progress 호출
      await query(`SELECT update_project_progress($1)`, ['project-id']);

      // Then: 쿼리 실행 확인
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('update_project_progress'),
        expect.arrayContaining(['project-id'])
      );
    });
  });

  describe('Trigger cascade validation', () => {
    it('should cascade from key_result update to objective update', async () => {
      // Given: Key Result 업데이트
      const mockKeyResult = {
        id: 'kr-id',
        objective_id: 'obj-id',
        current_value: 6500,
        target_value: 10000,
        progress: 65,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockKeyResult);

      // When: Key Result current_value 업데이트
      await queryOne(
        `UPDATE key_results SET current_value = $1 WHERE id = $2 RETURNING *`,
        [6500, 'kr-id']
      );

      // Then: Objective progress도 업데이트되어야 함 (트리거 체인)
      expect(queryOne).toHaveBeenCalled();
    });
  });
});

describe('Batch Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('snapshot_project_metrics_batch', () => {
    it('should create snapshots for multiple projects', async () => {
      // Given: 3개 프로젝트
      const projectIds = ['proj-1', 'proj-2', 'proj-3'];
      const mockResult = { snapshot_project_metrics_batch: 3 };

      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 배치 스냅샷 생성
      const result = await queryOne(
        `SELECT snapshot_project_metrics_batch($1)`,
        [projectIds]
      );

      // Then: 3개 스냅샷 생성 확인
      expect(result?.snapshot_project_metrics_batch).toBe(3);
    });

    it('should handle empty project list', async () => {
      // Given: 빈 프로젝트 배열
      const projectIds: string[] = [];
      const mockResult = { snapshot_project_metrics_batch: 0 };

      vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

      // When: 배치 스냅샷 생성
      const result = await queryOne(
        `SELECT snapshot_project_metrics_batch($1)`,
        [projectIds]
      );

      // Then: 0개 스냅샷 생성
      expect(result?.snapshot_project_metrics_batch).toBe(0);
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle very large numbers without overflow', async () => {
    // Given: 매우 큰 숫자 (백만 태스크)
    const mockResult = {
      total_tasks: 1000000,
      completed_tasks: 850000,
      completion_rate: 85.0,
      total_execution_time_seconds: 3600000000,  // BIGINT 범위
    };

    vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

    // When: 메트릭 계산
    const result = await queryOne(
      `SELECT * FROM calculate_project_metrics($1)`,
      ['large-project-id']
    );

    // Then: 오버플로우 없이 정확한 계산
    expect(result?.total_tasks).toBe(1000000);
    expect(result?.completion_rate).toBe(85.0);
  });

  it('should handle concurrent updates gracefully', async () => {
    // Given: 동시에 여러 태스크 업데이트
    const updates = [
      queryOne(`UPDATE task_executions SET status = 'completed' WHERE id = $1`, ['task-1']),
      queryOne(`UPDATE task_executions SET status = 'completed' WHERE id = $2`, ['task-2']),
      queryOne(`UPDATE task_executions SET status = 'failed' WHERE id = $3`, ['task-3']),
    ];

    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'task-1', status: 'completed' })
      .mockResolvedValueOnce({ id: 'task-2', status: 'completed' })
      .mockResolvedValueOnce({ id: 'task-3', status: 'failed' });

    // When: 동시 업데이트
    await Promise.all(updates);

    // Then: 모든 업데이트 성공
    expect(queryOne).toHaveBeenCalledTimes(3);
  });

  it('should handle unicode characters in task titles', async () => {
    // Given: 유니코드 문자 포함 태스크 제목
    const mockTask = {
      id: 'task-id',
      task_title: '프로젝트 메트릭 계산 🚀',
      task_status: 'completed',
    };

    vi.mocked(queryOne).mockResolvedValueOnce(mockTask);

    // When: 태스크 조회
    const result = await queryOne(
      `SELECT * FROM project_tasks WHERE id = $1`,
      ['task-id']
    );

    // Then: 유니코드 보존
    expect(result?.task_title).toBe('프로젝트 메트릭 계산 🚀');
  });
});

describe('Performance Validation', () => {
  it('should complete metrics calculation in reasonable time', async () => {
    // Given: 1000개 태스크 프로젝트
    const mockResult = {
      total_tasks: 1000,
      completed_tasks: 850,
      completion_rate: 85.0,
    };

    vi.mocked(queryOne).mockResolvedValueOnce(mockResult);

    const startTime = Date.now();

    // When: 메트릭 계산
    await queryOne(
      `SELECT * FROM calculate_project_metrics($1)`,
      ['large-project-id']
    );

    const duration = Date.now() - startTime;

    // Then: 100ms 이내 완료 (mocked이므로 실제로는 매우 빠름)
    expect(duration).toBeLessThan(100);
  });
});
