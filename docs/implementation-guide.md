# Life Dashboard 통합 구현 가이드

**작성일**: 2025년 2월
**대상**: 개발자
**목표**: 각 통합을 단계별로 구현하는 방법 제시

---

## Part 1: Obsidian 통합 (우선순위: HIGH)

### Step 1.1: 환경 설정

```bash
# .env.local 추가
OBSIDIAN_VAULT_PATH=~/groundone

# 패키지 설치 (필요 없음 - Node.js fs 내장)
```

### Step 1.2: Obsidian 라이브러리 생성

```typescript
// src/lib/obsidian.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '~/groundone';

/**
 * Vault 경로 확장 (~ → 홈 디렉토리)
 */
export async function getVaultPath(): Promise<string> {
  const expandedPath = VAULT_PATH.replace('~', os.homedir());

  // 경로 검증
  try {
    await fs.access(expandedPath);
    return expandedPath;
  } catch {
    throw new Error(`Obsidian Vault not found at: ${expandedPath}`);
  }
}

/**
 * 파일 읽기
 */
export async function readVaultFile(relativePath: string): Promise<string> {
  const basePath = await getVaultPath();
  const fullPath = path.join(basePath, relativePath);

  // 보안: 경로 탈출 방지
  if (!fullPath.startsWith(basePath)) {
    throw new Error('Path traversal detected');
  }

  return fs.readFile(fullPath, 'utf-8');
}

/**
 * 파일 쓰기
 */
export async function writeVaultFile(
  relativePath: string,
  content: string,
  options?: { append?: boolean; prepend?: boolean }
): Promise<void> {
  const basePath = await getVaultPath();
  const fullPath = path.join(basePath, relativePath);

  if (!fullPath.startsWith(basePath)) {
    throw new Error('Path traversal detected');
  }

  // 디렉토리 생성
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  if (options?.append) {
    const existing = await fs.readFile(fullPath, 'utf-8').catch(() => '');
    await fs.writeFile(fullPath, existing + '\n' + content, 'utf-8');
  } else if (options?.prepend) {
    const existing = await fs.readFile(fullPath, 'utf-8').catch(() => '');
    await fs.writeFile(fullPath, content + '\n' + existing, 'utf-8');
  } else {
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  // 변경 로깅
  await logFileOperation('write', relativePath);
}

/**
 * 파일 목록 조회
 */
export async function listVaultFiles(dir: string = ''): Promise<string[]> {
  const basePath = await getVaultPath();
  const fullPath = path.join(basePath, dir);

  if (!fullPath.startsWith(basePath)) {
    throw new Error('Path traversal detected');
  }

  try {
    const entries = await fs.readdir(fullPath, { recursive: true });
    return entries
      .filter((e) => typeof e === 'string' && e.endsWith('.md'))
      .map((e) => path.join(dir, e as string));
  } catch {
    return [];
  }
}

/**
 * 파일 삭제
 */
export async function deleteVaultFile(relativePath: string): Promise<void> {
  const basePath = await getVaultPath();
  const fullPath = path.join(basePath, relativePath);

  if (!fullPath.startsWith(basePath)) {
    throw new Error('Path traversal detected');
  }

  await fs.unlink(fullPath);
  await logFileOperation('delete', relativePath);
}

/**
 * 변경 로깅 (감시용)
 */
async function logFileOperation(operation: string, path: string) {
  // PostgreSQL에 로그 기록
  try {
    await db.query(
      'INSERT INTO file_operations (operation, vault_path, timestamp) VALUES ($1, $2, NOW())',
      [operation, path]
    );
  } catch (err) {
    console.error('Failed to log file operation:', err);
  }
}
```

### Step 1.3: 일일노트 자동화

```typescript
// src/lib/obsidian-daily.ts
import { writeVaultFile, readVaultFile } from './obsidian';

export interface DailyNoteConfig {
  dirFormat?: string; // 'YYYY/MM' | 'YYYY-MM' (기본)
  filenameFormat?: string; // 'YYYY-MM-DD' (기본) | 'YYYYMMDD'
  template?: string; // 커스텀 템플릿
}

/**
 * 일일노트 생성
 */
export async function createDailyNote(
  date: Date = new Date(),
  config?: DailyNoteConfig
): Promise<string> {
  const config_final = {
    dirFormat: 'YYYY-MM',
    filenameFormat: 'YYYY-MM-DD',
    ...config
  };

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  const dir =
    config_final.dirFormat === 'YYYY/MM'
      ? `${year}/${month}`
      : `${year}-${month}`;

  const filename =
    config_final.filenameFormat === 'YYYYMMDD'
      ? `${year}${month}${day}`
      : dateStr;

  const notePath = `${dir}/${filename}.md`;

  const template = config_final.template || getDefaultDailyTemplate(dateStr);

  await writeVaultFile(notePath, template);

  return notePath;
}

function getDefaultDailyTemplate(dateStr: string): string {
  return `# ${dateStr}

## 일일 회고

### 오늘의 주요 일정
-

### 완료한 작업
-

### 배운 점
-

### 내일 계획
-

### 메모
-

---
**작성**: ${new Date().toLocaleString('ko-KR')}
**상태**: 작성 중
`;
}

/**
 * 주간 회고 생성
 */
export async function createWeeklyReview(
  weekStartDate: Date = getMonday(new Date())
): Promise<string> {
  const weekEnd = new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000);

  const weekStart = weekStartDate.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const year = weekStartDate.getFullYear();
  const weekNum = getWeekNumber(weekStartDate);

  const notePath = `reviews/${year}-W${String(weekNum).padStart(2, '0')}-${weekStart}.md`;

  const template = `# 주간 회고: ${weekStart} ~ ${weekEndStr}

## 요약
전주의 주요 내용을 3-5줄로 요약

## 주요 성취
-

## 배운 점
-

## 개선할 점
-

## 다음주 우선순위
1.
2.
3.

## 통계
- 완료한 작업: ?개
- 이슈: ?개
- 회의: ?시간

---
**작성**: ${new Date().toLocaleString('ko-KR')}
`;

  await writeVaultFile(notePath, template);

  return notePath;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * 인덱스 파일에 링크 추가
 */
export async function linkDailyNoteToIndex(notePath: string): Promise<void> {
  const indexPath = '00-index/2025.md';

  try {
    let content = await readVaultFile(indexPath);

    // 섹션 찾기
    if (content.includes('## 최근 일일노트')) {
      const link = `- [[${notePath.replace('.md', '')}]]`;
      content = content.replace(
        '## 최근 일일노트\n',
        `## 최근 일일노트\n${link}\n`
      );
      await writeVaultFile(indexPath, content);
    }
  } catch {
    // 인덱스 없으면 생성
    const newIndex = `# 2025년

## 최근 일일노트
- [[${notePath.replace('.md', '')}]]

## 주간 회고
-

## 프로젝트
-
`;
    await writeVaultFile(indexPath, newIndex);
  }
}
```

### Step 1.4: API 라우트

```typescript
// src/app/api/obsidian/daily-note/route.ts
import { createDailyNote, linkDailyNoteToIndex } from '@/lib/obsidian-daily';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { date } = await req.json();
    const targetDate = new Date(date || new Date());

    const notePath = await createDailyNote(targetDate);
    await linkDailyNoteToIndex(notePath);

    return NextResponse.json({
      success: true,
      path: notePath,
      date: targetDate
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

// GET /api/obsidian/daily-note?date=2025-02-27
export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date');
    const targetDate = date ? new Date(date) : new Date();

    const notePath = await createDailyNote(targetDate);

    return NextResponse.json({
      success: true,
      path: notePath
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
```

### Step 1.5: 크론 작업 (매일 자동 생성)

```typescript
// src/app/api/cron/daily-note/route.ts
import { createDailyNote, linkDailyNoteToIndex } from '@/lib/obsidian-daily';

export async function GET(req: Request) {
  // Vercel/Railway 크론 토큰 검증
  const token = req.headers.get('authorization')?.split('Bearer ')[1];
  if (token !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const today = new Date();
    const notePath = await createDailyNote(today);
    await linkDailyNoteToIndex(notePath);

    return Response.json({
      success: true,
      path: notePath,
      timestamp: new Date()
    });
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

// railway.toml에서 호출
// GET /api/cron/daily-note - 매일 09:00 KST
```

---

## Part 2: Slack 통합 (우선순위: HIGH)

### Step 2.1: Webhook URL 설정

1. Slack 워크스페이스 → Apps & Integrations
2. Incoming Webhooks 설정
3. `.env.local`에 저장:
   ```bash
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
   SLACK_SIGNING_SECRET=your-signing-secret
   ```

### Step 2.2: Slack 알림 라이브러리

```typescript
// src/lib/slack.ts
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

export interface SlackMessage {
  text?: string;
  blocks?: any[];
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

export async function sendSlackMessage(message: SlackMessage): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn('SLACK_WEBHOOK_URL not configured');
    return;
  }

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: message.text || 'Notification',
      blocks: message.blocks,
      channel: message.channel,
      username: message.username || 'Life Dashboard',
      icon_emoji: message.icon_emoji || ':robot_face:'
    })
  });

  if (!response.ok) {
    throw new Error(`Slack error: ${response.statusText}`);
  }
}

/**
 * 간단한 메시지
 */
export async function notifySlack(
  message: string,
  emoji: string = ':bell:'
): Promise<void> {
  await sendSlackMessage({
    text: `${emoji} ${message}`
  });
}

/**
 * 구조화된 메시지
 */
export async function notifySlackStructured(
  title: string,
  details: Record<string, string>,
  color: string = '#36a64f'
): Promise<void> {
  const fields = Object.entries(details).map(([key, value]) => ({
    title: key,
    value: value,
    short: true
  }));

  await sendSlackMessage({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title}*`
        }
      },
      {
        type: 'section',
        fields: fields
      }
    ]
  });
}

/**
 * 액션 버튼 포함
 */
export async function notifySlackWithActions(
  message: string,
  actions: Array<{ label: string; value: string; url?: string }>
): Promise<void> {
  await sendSlackMessage({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: message
        }
      },
      {
        type: 'actions',
        elements: actions.map((action) => ({
          type: action.url ? 'button' : 'button',
          text: {
            type: 'plain_text',
            text: action.label
          },
          value: action.value,
          url: action.url,
          action_id: `action_${action.value}`
        }))
      }
    ]
  });
}
```

### Step 2.3: 사용 예

```typescript
// src/lib/notifications.ts
import { notifySlack, notifySlackStructured } from './slack';

export async function notifyProjectCompleted(projectName: string) {
  await notifySlack(`✅ Project "${projectName}" completed!`);
}

export async function notifyDailyReport(stats: {
  tasksCompleted: number;
  hoursWorked: number;
  issues: number;
}) {
  await notifySlackStructured(
    '📊 Daily Report',
    {
      'Tasks Completed': String(stats.tasksCompleted),
      'Hours Worked': String(stats.hoursWorked),
      'Issues': String(stats.issues)
    },
    '#0099FF'
  );
}
```

---

## Part 3: Gmail API 통합 (우선순위: MEDIUM)

### Step 3.1: Google Cloud 설정

1. Google Cloud Console → 새 프로젝트 생성
2. Gmail API 활성화
3. OAuth 2.0 클라이언트 ID 생성 (웹 애플리케이션)
4. .env.local:
   ```bash
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

### Step 3.2: Gmail 라이브러리

```typescript
// src/lib/gmail.ts
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';

const gmail = google.gmail('v1');

export interface ParsedEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  labels: string[];
}

export async function getUnreadEmails(
  auth: any,
  maxResults: number = 10
): Promise<ParsedEmail[]> {
  const result = await gmail.users.messages.list({
    auth,
    userId: 'me',
    q: 'is:unread',
    maxResults
  });

  const messages = result.data.messages || [];
  return Promise.all(
    messages.map((msg) => getEmailDetails(auth, msg.id!))
  );
}

async function getEmailDetails(
  auth: any,
  messageId: string
): Promise<ParsedEmail> {
  const message = await gmail.users.messages.get({
    auth,
    userId: 'me',
    id: messageId,
    format: 'full'
  });

  const headers = message.data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name === name)?.value || '';

  const body = extractEmailBody(message.data.payload);

  return {
    id: message.data.id!,
    threadId: message.data.threadId!,
    subject: getHeader('Subject'),
    from: getHeader('From'),
    to: getHeader('To'),
    date: getHeader('Date'),
    body,
    labels: message.data.labelIds || []
  };
}

function extractEmailBody(payload: any): string {
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
  }

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  return '';
}

/**
 * 이메일 자동 응답
 */
export async function sendReply(
  auth: any,
  threadId: string,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  const email = [
    `From: me`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${threadId}`,
    '',
    body
  ].join('\n');

  const encodedEmail = Buffer.from(email).toString('base64');

  await gmail.users.messages.send({
    auth,
    userId: 'me',
    requestBody: {
      raw: encodedEmail,
      threadId
    }
  });
}
```

### Step 3.3: OAuth 인증 흐름

```typescript
// src/lib/google-auth.ts
import { google } from 'googleapis';
import { cookies } from 'next/headers';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.DASHBOARD_URL}/api/auth/google/callback`
);

export function getAuthUrl(): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar'
    ],
    prompt: 'consent'
  });
}

export async function exchangeCodeForTokens(code: string): Promise<any> {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function saveGoogleTokens(tokens: any, userId: string) {
  const cookieJar = await cookies();

  // DB에 암호화하여 저장
  const secretManager = new SecretManager();
  const encryptedToken = secretManager.encrypt(JSON.stringify(tokens));

  await db.query(
    `UPDATE users
     SET google_tokens = $1, google_tokens_updated_at = NOW()
     WHERE id = $2`,
    [encryptedToken, userId]
  );

  // 쿠키에 토큰 ID 저장 (토큰 자체 아님)
  cookieJar.set('google_token_id', userId, {
    httpOnly: true,
    secure: true,
    maxAge: 30 * 24 * 60 * 60
  });
}

export async function getGoogleAuth(userId: string): Promise<any> {
  const user = await db.queryOne(
    'SELECT google_tokens FROM users WHERE id = $1',
    [userId]
  );

  if (!user?.google_tokens) {
    throw new Error('Google tokens not found');
  }

  const secretManager = new SecretManager();
  const tokens = JSON.parse(secretManager.decrypt(user.google_tokens));

  oauth2Client.setCredentials(tokens);

  // 토큰 갱신 (필요시)
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await saveGoogleTokens(credentials, userId);
    oauth2Client.setCredentials(credentials);
  }

  return oauth2Client;
}
```

---

## Part 4: 이벤트 큐 (우선순위: HIGH)

### Step 4.1: 데이터베이스 스키마

```sql
-- sql/005_event_queue.sql
CREATE TABLE event_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(255) NOT NULL,
  data JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  retries INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  scheduled_at TIMESTAMP,
  processed_at TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_queue_status ON event_queue(status);
CREATE INDEX idx_event_queue_created_at ON event_queue(created_at);
CREATE INDEX idx_event_queue_scheduled_at ON event_queue(scheduled_at);
```

### Step 4.2: 이벤트 큐 구현

```typescript
// src/lib/event-queue.ts
import crypto from 'crypto';

export type EventType = 'daily_note' | 'weekly_review' | 'project_updated' | 'task_completed';

export interface QueuedEvent {
  id: string;
  type: EventType;
  data: any;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead-letter';
  retries: number;
  maxRetries: number;
  createdAt: Date;
  processedAt?: Date;
  error?: string;
}

export class EventQueue {
  /**
   * 이벤트 큐에 추가
   */
  static async enqueue(
    type: EventType,
    data: any,
    maxRetries: number = 3
  ): Promise<string> {
    const id = crypto.randomUUID();

    await db.query(
      `INSERT INTO event_queue
       (id, type, data, status, retries, max_retries, created_at)
       VALUES ($1, $2, $3, 'pending', 0, $4, NOW())`,
      [id, type, JSON.stringify(data), maxRetries]
    );

    return id;
  }

  /**
   * 큐 처리
   */
  static async processQueue(batchSize: number = 10) {
    const events = await db.query<QueuedEvent>(
      `SELECT id, type, data, retries, max_retries
       FROM event_queue
       WHERE status = 'pending'
       AND (scheduled_at IS NULL OR scheduled_at <= NOW())
       ORDER BY created_at ASC
       LIMIT $1`,
      [batchSize]
    );

    for (const event of events) {
      try {
        // 상태 업데이트
        await db.query(
          `UPDATE event_queue SET status = 'processing' WHERE id = $1`,
          [event.id]
        );

        // 처리
        await this.processEvent(event);

        // 완료
        await db.query(
          `UPDATE event_queue
           SET status = 'completed', processed_at = NOW()
           WHERE id = $1`,
          [event.id]
        );
      } catch (error) {
        await this.handleRetry(event, error);
      }
    }
  }

  private static async processEvent(event: any) {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

    switch (event.type) {
      case 'daily_note':
        await this.handleDailyNote(data);
        break;
      case 'weekly_review':
        await this.handleWeeklyReview(data);
        break;
      case 'project_updated':
        await this.handleProjectUpdated(data);
        break;
      case 'task_completed':
        await this.handleTaskCompleted(data);
        break;
      default:
        throw new Error(`Unknown event type: ${event.type}`);
    }
  }

  private static async handleDailyNote(data: any) {
    const { date } = data;
    const { createDailyNote, linkDailyNoteToIndex } = await import('./obsidian-daily');

    const notePath = await createDailyNote(new Date(date));
    await linkDailyNoteToIndex(notePath);

    console.log(`Daily note created: ${notePath}`);
  }

  private static async handleWeeklyReview(data: any) {
    const { date } = data;
    const { createWeeklyReview } = await import('./obsidian-daily');

    const notePath = await createWeeklyReview(new Date(date));
    console.log(`Weekly review created: ${notePath}`);
  }

  private static async handleProjectUpdated(data: any) {
    const { projectId } = data;
    const { notifySlack } = await import('./slack');

    const project = await db.queryOne(
      'SELECT name FROM projects WHERE id = $1',
      [projectId]
    );

    if (project) {
      await notifySlack(`📝 Project updated: ${project.name}`);
    }
  }

  private static async handleTaskCompleted(data: any) {
    const { taskId } = data;
    const { notifySlack } = await import('./slack');

    const task = await db.queryOne(
      'SELECT title FROM tasks WHERE id = $1',
      [taskId]
    );

    if (task) {
      await notifySlack(`✅ Task completed: ${task.title}`);
    }
  }

  private static async handleRetry(event: any, error: any) {
    const newRetries = event.retries + 1;

    if (newRetries >= event.maxRetries) {
      // Dead-letter
      await db.query(
        `UPDATE event_queue
         SET status = 'dead-letter', error = $1, processed_at = NOW()
         WHERE id = $2`,
        [String(error), event.id]
      );

      // 알림
      const { notifySlack } = await import('./slack');
      await notifySlack(
        `⚠️ Event Dead-Lettered\nType: ${event.type}\nError: ${error.message}`
      );
    } else {
      // 재시도 스케줄링 (지수 백오프)
      const delayMinutes = Math.pow(2, newRetries);

      await db.query(
        `UPDATE event_queue
         SET status = 'pending',
             retries = $1,
             scheduled_at = NOW() + INTERVAL '${delayMinutes} minutes'
         WHERE id = $2`,
        [newRetries, event.id]
      );
    }
  }
}
```

### Step 4.3: 크론 작업

```typescript
// src/app/api/cron/process-events/route.ts
import { EventQueue } from '@/lib/event-queue';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.split('Bearer ')[1];

  if (token !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    await EventQueue.processQueue(50);
    return Response.json({ processed: true, timestamp: new Date() });
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

// railway.toml에 추가:
// [[env.production.crons]]
// schedule = "*/5 * * * *"  # 매 5분
// command = "curl -H \"Authorization: Bearer $CRON_SECRET\" https://your-domain.com/api/cron/process-events"
```

---

## Part 5: 보안 구현

### Step 5.1: 토큰 암호화

```typescript
// src/lib/secrets.ts
import crypto from 'crypto';

export class SecretManager {
  private encryptionKey: Buffer;

  constructor(key: string = process.env.ENCRYPTION_KEY || '') {
    if (key.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
    }
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      this.encryptionKey,
      iv
    );

    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
  }

  decrypt(encrypted: string): string {
    const [ivHex, ciphertext] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');

    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      this.encryptionKey,
      iv
    );

    let decrypted = decipher.update(ciphertext, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }
}

// 생성 명령어
// node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 5.2: 환경 변수 검증

```typescript
// src/lib/env.ts
export function validateEnv() {
  const required = [
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'DATABASE_URL',
    'CRON_SECRET'
  ];

  const optional = [
    'OBSIDIAN_VAULT_PATH',
    'SLACK_WEBHOOK_URL',
    'SLACK_SIGNING_SECRET',
    'DISCORD_WEBHOOK_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET'
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  console.log(`✅ Environment validation passed (${required.length} required, ${optional.length} optional)`);
}
```

---

## 체크리스트

### Phase 1: 기본 설정 (1일)
- [ ] Obsidian 라이브러리 작성 및 테스트
- [ ] Slack 통합 설정 및 테스트
- [ ] 환경 변수 설정
- [ ] 데이터베이스 스키마 생성

### Phase 2: 자동화 (2일)
- [ ] 일일노트 크론 작업 설정
- [ ] 이벤트 큐 구현
- [ ] Gmail API 설정 (선택)

### Phase 3: 보안 (1일)
- [ ] 토큰 암호화 구현
- [ ] API 로깅 추가
- [ ] 환경 변수 검증

### Phase 4: 테스트 (1일)
- [ ] 각 통합별 유닛 테스트
- [ ] 크론 작업 동작 검증
- [ ] 에러 처리 테스트

