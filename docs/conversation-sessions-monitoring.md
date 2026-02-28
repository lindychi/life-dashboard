# 대화 세션 시스템 모니터링 및 경고 가이드

## 개요

이 문서는 대화 세션 시스템의 모니터링, 성능 추적, 경보 설정을 다룹니다.

---

## 1. 모니터링 메트릭

### 1.1 세션 메트릭

| 메트릭 | 설명 | 단위 | 수집 빈도 | 경보 임계값 |
|--------|------|------|---------|-----------|
| `conversations_total` | 총 세션 수 | count | 5분 | - |
| `conversations_active` | 활성 세션 | count | 5분 | - |
| `conversations_archived` | 보관된 세션 | count | 5분 | - |
| `conversations_completed` | 완료된 세션 | count | 5분 | - |
| `conversation_completion_rate` | 완료율 | % | 5분 | < 10% (⚠️ 경고) |
| `conversation_avg_duration_hours` | 평균 지속 시간 | hours | 5분 | > 168h (⚠️ 경고) |

### 1.2 메시지 메트릭

| 메트릭 | 설명 | 단위 | 수집 빈도 | 경보 임계값 |
|--------|------|------|---------|-----------|
| `conversation_messages_total` | 총 메시지 수 | count | 5분 | - |
| `conversation_messages_per_session` | 세션당 평균 | count | 5분 | < 1 (⚠️ 경고) |
| `conversation_unread_messages` | 읽지 않은 메시지 | count | 5분 | - |
| `conversation_unread_rate` | 읽지 않은 비율 | % | 5분 | > 50% (⚠️ 경고) |
| `conversation_insertion_rate_per_hour` | 시간당 삽입율 | msg/h | 5분 | > 1000 (⚠️ 경고) |
| `conversation_avg_message_length` | 평균 길이 | chars | 5분 | - |

### 1.3 성능 메트릭

| 메트릭 | 설명 | 단위 | 수집 빈도 | 경보 임계값 |
|--------|------|------|---------|-----------|
| `conversation_table_size_mb` | 테이블 크기 | MB | 5분 | > 1000 (⚠️ 경고) |
| `conversation_index_size_mb` | 인덱스 크기 | MB | 5분 | > 500 (⚠️ 경고) |
| `conversation_dead_tuples` | 데드 튜플 | count | 5분 | > 100K (⚠️ 경고) |
| `conversation_health_status` | 건강 상태 | 0/1 | 5분 | 0 (🚨 심각) |
| `conversation_warnings_count` | 경고 수 | count | 5분 | > 3 (⚠️ 경고) |
| `conversation_critical_issues_count` | 심각 문제 | count | 5분 | > 0 (🚨 심각) |

---

## 2. Prometheus 메트릭 엔드포인트

### 2.1 엔드포인트 설정

**URL**: `GET /api/metrics/conversations?format=prometheus`

**인증**: 선택사항 (프라이빗 네트워크 권장)

**응답 형식**: Prometheus text format

### 2.2 Prometheus 설정 (prometheus.yml)

```yaml
global:
  scrape_interval: 5m
  evaluation_interval: 5m

scrape_configs:
  - job_name: 'conversation-sessions'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics/conversations'
    params:
      format: ['prometheus']
    scrape_interval: 5m
    scrape_timeout: 10s
    honor_timestamps: true

  # 다른 메트릭 (pg_stat_statements 등)
  - job_name: 'postgres'
    static_configs:
      - targets: ['localhost:5432']
```

---

## 3. 경보 규칙

### 3.1 경보 규칙 파일 (alerts.yml)

```yaml
groups:
  - name: conversation_sessions
    interval: 5m
    rules:
      # ===== 세션 관련 경보 =====

      - alert: LowCompletionRate
        expr: conversation_completion_rate < 10
        for: 1h
        labels:
          severity: warning
          component: conversations
        annotations:
          summary: "Low conversation completion rate"
          description: |
            Conversation completion rate is {{ $value }}% (expected > 10%)
            Possible causes:
            - Users abandoning conversations
            - Session timeout issues
            - Poor user experience

      - alert: LongAverageDuration
        expr: conversation_avg_duration_hours > 168
        for: 2h
        labels:
          severity: warning
          component: conversations
        annotations:
          summary: "Average conversation duration exceeds 1 week"
          description: "Average duration: {{ $value }} hours"

      # ===== 메시지 관련 경보 =====

      - alert: HighUnreadMessageRate
        expr: conversation_unread_rate > 50
        for: 30m
        labels:
          severity: warning
          component: messages
        annotations:
          summary: "High unread message rate in conversations"
          description: |
            {{ $value }}% of messages are unread
            Action items:
            - Check read status notification system
            - Verify message delivery
            - Review agent responsiveness

      - alert: LowMessagesPerSession
        expr: conversation_messages_per_session < 1
        for: 2h
        labels:
          severity: info
          component: messages
        annotations:
          summary: "Very few messages per session"
          description: "Average: {{ $value }} messages/session"

      - alert: HighMessageInsertionRate
        expr: conversation_insertion_rate_per_hour > 1000
        for: 10m
        labels:
          severity: warning
          component: messages
        annotations:
          summary: "Unusually high message insertion rate"
          description: |
            {{ $value }} messages/hour (expected < 1000)
            Possible causes:
            - Burst traffic
            - Message duplication bug
            - Spam/flood attack

      # ===== 성능 관련 경보 =====

      - alert: DatabaseTableSizeWarning
        expr: conversation_table_size_mb > 1000
        for: 1h
        labels:
          severity: warning
          component: database
        annotations:
          summary: "Conversation table size exceeds 1GB"
          description: |
            Current size: {{ $value }}MB
            Action items:
            - Review archival/retention policy
            - Consider partitioning old conversations
            - Run VACUUM to reclaim space

      - alert: DatabaseIndexSizeWarning
        expr: conversation_index_size_mb > 500
        for: 1h
        labels:
          severity: warning
          component: database
        annotations:
          summary: "Conversation indexes total > 500MB"
          description: "Index size: {{ $value }}MB"

      - alert: HighDeadTuplesCount
        expr: conversation_dead_tuples > 100000
        for: 30m
        labels:
          severity: warning
          component: database
        annotations:
          summary: "High number of dead tuples in conversation tables"
          description: |
            Dead tuples: {{ $value }}
            Action: Run VACUUM on conversation tables

      # ===== 건강 상태 경보 =====

      - alert: ConversationSystemUnhealthy
        expr: conversation_health_status == 0
        for: 5m
        labels:
          severity: critical
          component: conversations
        annotations:
          summary: "Conversation system is in unhealthy state"
          description: |
            System has encountered critical issues.
            Check logs and metrics immediately.

      - alert: MultipleWarningsDetected
        expr: conversation_warnings_count > 3
        for: 30m
        labels:
          severity: warning
          component: system
        annotations:
          summary: "Multiple warnings in conversation system"
          description: "{{ $value }} warnings detected"

      - alert: CriticalIssuesDetected
        expr: conversation_critical_issues_count > 0
        for: 1m
        labels:
          severity: critical
          component: system
        annotations:
          summary: "Critical issues in conversation system"
          description: "{{ $value }} critical issues detected"
```

### 3.2 경보 임계값 해석

| 임계값 | 심각도 | 의미 | 대응 |
|--------|--------|------|------|
| `< 10%` (완료율) | ⚠️ 경고 | 매우 많은 세션이 미완료 | 세션 종료 정책 검토 |
| `> 50%` (읽지 않음) | ⚠️ 경고 | 절반 이상 메시지가 읽혀지지 않음 | 알림 시스템 점검 |
| `> 1000 msg/h` | ⚠️ 경고 | 비정상적으로 높은 메시지율 | 스팸/중복 확인 |
| `> 1000 MB` (테이블) | ⚠️ 경고 | DB 크기 증가 | 아카이빙 정책 실행 |
| `health_status = 0` | 🚨 심각 | 시스템 비정상 | 즉시 조치 필요 |

---

## 4. 대시보드 구성

### 4.1 Grafana 대시보드 설정

**데이터 소스**: Prometheus

**패널 구성**:

```json
{
  "dashboard": {
    "title": "Conversation Sessions Monitoring",
    "panels": [
      {
        "title": "Active Conversations",
        "targets": [
          {
            "expr": "conversations_active"
          }
        ],
        "type": "stat"
      },
      {
        "title": "Completion Rate Over Time",
        "targets": [
          {
            "expr": "conversation_completion_rate"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Messages Per Session",
        "targets": [
          {
            "expr": "conversation_messages_per_session"
          }
        ],
        "type": "gauge"
      },
      {
        "title": "System Health Status",
        "targets": [
          {
            "expr": "conversation_health_status"
          }
        ],
        "type": "stat",
        "thresholds": [
          {
            "value": 0,
            "color": "red"
          },
          {
            "value": 1,
            "color": "green"
          }
        ]
      },
      {
        "title": "Database Table Size",
        "targets": [
          {
            "expr": "conversation_table_size_mb"
          }
        ],
        "type": "graph"
      }
    ]
  }
}
```

### 4.2 API 대시보드 엔드포인트

**URL**: `GET /api/dashboard/conversations`

응답 예:
```json
{
  "title": "Conversation Sessions Dashboard",
  "timestamp": "2025-02-28T12:00:00Z",
  "summary": {
    "totalSessions": 1234,
    "activeSessions": 567,
    "completionRate": 45.6,
    "unreadMessages": 890
  },
  "alerts": {
    "critical": 0,
    "warnings": 2,
    "info": 5
  },
  "recentMetrics": [
    {
      "timestamp": "2025-02-28T11:55:00Z",
      "sessions": 1234,
      "messages": 45678,
      "health": "healthy"
    }
  ]
}
```

---

## 5. 경고 채널 설정

### 5.1 Slack 알림

**Webhook URL**: `https://hooks.slack.com/services/YOUR/WEBHOOK/URL`

**설정 (alertmanager.yml)**:

```yaml
global:
  resolve_timeout: 5m

route:
  receiver: 'default'
  group_by: ['alertname', 'severity']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  routes:
    - match:
        severity: critical
      receiver: 'slack-critical'
      repeat_interval: 1h

    - match:
        severity: warning
      receiver: 'slack-warning'
      repeat_interval: 4h

receivers:
  - name: 'default'
    slack_configs:
      - api_url: 'YOUR_WEBHOOK_URL'
        channel: '#monitoring'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

  - name: 'slack-critical'
    slack_configs:
      - api_url: 'YOUR_WEBHOOK_URL'
        channel: '#ops-critical'
        title: '🚨 {{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

  - name: 'slack-warning'
    slack_configs:
      - api_url: 'YOUR_WEBHOOK_URL'
        channel: '#ops-warnings'
        title: '⚠️ {{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
```

### 5.2 이메일 알림

```yaml
receivers:
  - name: 'email-critical'
    email_configs:
      - to: 'oncall@company.com'
        from: 'alerts@company.com'
        smarthost: 'smtp.company.com:587'
        auth_username: 'alerts@company.com'
        auth_password: 'password'
        headers:
          Subject: '[CRITICAL] {{ .GroupLabels.alertname }}'
```

### 5.3 PagerDuty 통합

```yaml
receivers:
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: 'YOUR_SERVICE_KEY'
        description: '{{ .GroupLabels.alertname }}: {{ .Alerts.Status }}'
        details:
          firing: '{{ template "pagerduty.default.instances" .Alerts.Firing }}'
```

---

## 6. 모니터링 체크리스트

### 일일 체크

- [ ] 경고 수 확인 (임계값: < 3개)
- [ ] 완료율 추이 확인 (최소 10%)
- [ ] 메시지 읽음 상태 확인 (읽지 않음 < 50%)
- [ ] DB 테이블 크기 확인 (< 1GB)

### 주간 체크

- [ ] 성능 트렌드 분석 (지난 7일)
- [ ] 참여자별 활동 통계 검토
- [ ] 데드 튜플 정리 (VACUUM)
- [ ] 경고 규칙 유효성 검증

### 월간 체크

- [ ] 용량 계획 (월별 증가율)
- [ ] 인덱스 효율성 분석
- [ ] 보관 정책 검토
- [ ] 메트릭 히스토리 정리

---

## 7. 문제 해결

### 7.1 높은 경고 수

**증상**: 동시에 여러 경고 발생

**해결 방법**:
1. 최신 메트릭 확인: `/api/metrics/conversations`
2. 건강 상태 상세 정보 확인: `health.warnings`
3. 해당 메트릭 조사 (테이블 크기, 읽지 않은 메시지 등)

### 7.2 메트릭 수집 중단

**증상**: Prometheus에서 메트릭을 받지 못함

**해결 방법**:
```bash
# 1. 메트릭 엔드포인트 테스트
curl http://localhost:3000/api/metrics/conversations?format=prometheus

# 2. 메트릭 수집 프로세스 확인
ps aux | grep collect-conversation-metrics

# 3. 로그 확인
tail -f logs/metrics-collection.log
```

### 7.3 거짓 경보

**증상**: 실제 문제 없는데 경보 발생

**해결 방법**:
1. 임계값 조정 (alerts.yml)
2. 지연 시간 증가 (for: 15m)
3. 경고 규칙 검토 및 재평가

---

## 8. 성능 최적화 팁

### 데이터베이스 최적화

```sql
-- 1. 통계 업데이트
ANALYZE conversation_messages;

-- 2. 데드 튜플 정리
VACUUM FULL conversation_messages;

-- 3. 인덱스 재구성
REINDEX TABLE conversation_messages;

-- 4. 느린 쿼리 찾기
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
WHERE query LIKE '%conversation%'
ORDER BY mean_time DESC
LIMIT 10;
```

### 메트릭 수집 최적화

- 수집 빈도 조정 (기본 5분)
- 메트릭 히스토리 보관 기간 설정 (기본 90일)
- 불필요한 메트릭 제외

---

## 9. 참고 자료

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Dashboard Documentation](https://grafana.com/docs/)
- [Alertmanager Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [PostgreSQL Monitoring](https://www.postgresql.org/docs/current/monitoring.html)
