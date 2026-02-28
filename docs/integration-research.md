# Life Dashboard 외부 서비스 & MCP 통합 리서치 보고서

**작성일**: 2025년 2월
**대상**: Life Dashboard (Next.js 16, PostgreSQL, Node.js)
**목적**: 업무 자동화를 위한 통합 기술 스택 조사

---

## 1. 옵시디언(Obsidian) 파일 시스템 통합

### 1.1 개요
Obsidian은 로컬 Markdown 기반 Vault 시스템으로, Node.js 환경에서 파일 시스템 접근을 통해 직접 통합 가능합니다.

### 1.2 기술 스택 선택

#### 방식 1: 직접 파일 시스템 접근 (권장 - 경량)
```typescript
// src/lib/obsidian.ts
import * as fs from 'fs/promises';
import * as path from 'path';

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '~/groundone';

export async function getVaultPath(): Promise<string> {
  return VAULT_PATH.replace('~', process.env.HOME || '');
}

export async function readVaultFile(relativePath: string): Promise<string> {
  const fullPath = path.join(await getVaultPath(), relativePath);
  return fs.readFile(fullPath, 'utf-8');
}

export async function writeVaultFile(
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(await getVaultPath(), relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}
```

**장점**:
- 외부 의존성 없음
- 빠른 성능
- 직접 제어 가능

**단점**:
- Obsidian 앱 실행 중 파일 잠금 가능성
- 디렉토리 감시 필요 시 polling 필요

#### 방식 2: Obsidian 플러그인 + API
플러그인이 백엔드 API 호출하는 방식으로, 실시간 동기화와 안전한 파일 잠금 처리가 가능합니다.

**권장**: 초기에는 **방식 1 (직접 파일 접근)** 사용 후, 필요시 플러그인으로 확장

### 1.3 일일노트 자동화
사용자의 Obsidian Vault 경로 (~/ groundone)를 기반으로 자동 생성:

```typescript
// src/lib/obsidian-daily.ts

export async function generateDailyNote(date: Date): Promise<void> {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const noteDir = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const notePath = `${noteDir}/daily-${dateStr}.md`;

  const template = `# ${dateStr}

## 일일 회고

### 완료한 작업
-

### 배운 점
-

### 내일 계획
-

---
작성: ${new Date().toLocaleString('ko-KR')}
`;

  await writeVaultFile(notePath, template);
}

// 주간 회고
export async function generateWeeklyReview(weekStartDate: Date): Promise<void> {
  const weekStart = weekStartDate.toISOString().split('T')[0];
  const weekEnd = new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const notePath = `reviews/week-${weekStart}.md`;

  const template = `# 주간 회고: ${weekStart} ~ ${weekEnd}

## 요약
-

## 주요 성취
-

## 개선할 점
-

## 다음주 목표
-

---
생성: ${new Date().toLocaleString('ko-KR')}
`;

  await writeVaultFile(notePath, template);
}
```

### 1.4 보안 고려사항

- **OBSIDIAN_VAULT_PATH**: .env.local에만 저장 (git 제외)
- **파일 권한**: 민감한 정보는 Obsidian 메타데이터로 마킹
- **감시 로깅**: 모든 쓰기 작업 기록

---

## 2. 브라우저 자동화

### 2.1 Playwright vs Puppeteer 비교

| 항목 | Playwright | Puppeteer |
|------|-----------|-----------|
| **지원 브라우저** | Chrome/Chromium, Firefox, Safari, WebKit | Chrome/Chromium |
| **성능** | 우수 (병렬 최적화) | 양호 |
| **API 안정성** | 높음 (MS 지원) | 높음 (Google 지원) |
| **클라우드 배포** | 우수 | 우수 |
| **스크린샷/PDF** | 네이티브 지원 | 네이티브 지원 |
| **모바일 에뮬레이션** | 강력 | 제한적 |
| **비용** | 무료 | 무료 |

**권장**: **Playwright** (멀티 브라우저 지원, 웹 표준 우수)

### 2.2 설정

```typescript
// src/lib/browser-automation.ts
import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';

export class BrowserAutomation {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async initialize() {
    this.browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage' // Railway 환경
      ]
    });

    this.context = await this.browser.newContext({
      extraHTTPHeaders: {
        'User-Agent': 'LifeDashboard/1.0'
      }
    });
  }

  async captureScreenshot(url: string, outputPath: string): Promise<void> {
    if (!this.context) throw new Error('Browser not initialized');

    const page = await this.context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.screenshot({ path: outputPath, fullPage: true });
    } finally {
      await page.close();
    }
  }

  async generatePDF(url: string, outputPath: string): Promise<void> {
    if (!this.context) throw new Error('Browser not initialized');

    const page = await this.context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.pdf({ path: outputPath, format: 'A4' });
    } finally {
      await page.close();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}
```

---

## 3. 이메일 통합

### 3.1 현재 설정 (Resend) 확장

Life Dashboard는 이미 **Resend** 사용 중입니다.

```typescript
// src/lib/resend-extended.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendCustomEmail(
  to: string,
  subject: string,
  htmlContent: string
): Promise<string> {
  const response = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'noreply@example.com',
    to,
    subject,
    html: htmlContent
  });

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`);
  }

  return response.data?.id || '';
}
```

### 3.2 Gmail API 통합 (수신 및 파싱)

```typescript
// src/lib/gmail.ts
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';

const gmail = google.gmail('v1');

export class GmailClient {
  private auth: any;

  constructor(auth: any) {
    this.auth = auth;
  }

  async getEmails(query: string = 'is:unread', maxResults: number = 10) {
    const result = await gmail.users.messages.list({
      auth: this.auth,
      userId: 'me',
      q: query,
      maxResults
    });

    const messages = result.data.messages || [];

    const details = await Promise.all(
      messages.map((msg) =>
        gmail.users.messages.get({
          auth: this.auth,
          userId: 'me',
          id: msg.id!
        })
      )
    );

    return details.map((detail) => {
      const headers = detail.data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || '';

      return {
        id: detail.data.id,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        to: getHeader('To'),
        date: getHeader('Date'),
        body: this.getEmailBody(detail.data.payload)
      };
    });
  }

  private getEmailBody(payload: any): string {
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain') {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
    }

    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    return '';
  }
}
```

### 3.3 비용 및 비교

| 서비스 | 비용 | 사용 사례 |
|------|------|---------|
| Resend | 무료 (5개 도메인) | 발송 전용, 마법 링크 |
| Gmail API | 무료 | 수신, 파싱, 자동 응답 |
| SendGrid | $20/월 | 고급 분석, 템플릿 |
| AWS SES | $0.10/1000 | 대량 발송 |

**권장**: Resend (발송) + Gmail API (수신) 조합

---

## 4. Google Calendar API 통합

### 4.1 기본 설정

```typescript
// src/lib/calendar.ts
import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';

const calendar = google.calendar('v3');

export class CalendarClient {
  private auth: any;

  constructor(auth: any) {
    this.auth = auth;
  }

  async createEvent(
    summary: string,
    description: string,
    startTime: Date,
    endTime: Date,
    calendarId: string = 'primary'
  ): Promise<calendar_v3.Schema$Event> {
    const event: calendar_v3.Schema$Event = {
      summary,
      description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: process.env.TZ || 'Asia/Seoul'
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: process.env.TZ || 'Asia/Seoul'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'notification', minutes: 15 }
        ]
      }
    };

    const result = await calendar.events.insert({
      auth: this.auth,
      calendarId,
      requestBody: event
    });

    return result.data;
  }

  async listEvents(
    calendarId: string = 'primary',
    timeMin: Date = new Date(),
    maxResults: number = 10
  ): Promise<calendar_v3.Schema$Event[]> {
    const result = await calendar.events.list({
      auth: this.auth,
      calendarId,
      timeMin: timeMin.toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return result.data.items || [];
  }

  async updateEvent(
    eventId: string,
    updates: Partial<calendar_v3.Schema$Event>,
    calendarId: string = 'primary'
  ): Promise<calendar_v3.Schema$Event> {
    const event = await calendar.events.get({
      auth: this.auth,
      calendarId,
      eventId
    });

    const updated = { ...event.data, ...updates };

    const result = await calendar.events.update({
      auth: this.auth,
      calendarId,
      eventId,
      requestBody: updated
    });

    return result.data;
  }
}
```

### 4.2 자동화 예: 프로젝트 마감일 → 캘린더

```typescript
// src/lib/project-calendar-sync.ts
import { CalendarClient } from './calendar';

export async function syncProjectsToCalendar(
  auth: any,
  projects: any[]
) {
  const calendarClient = new CalendarClient(auth);

  for (const project of projects) {
    if (project.deadline) {
      const deadlineDate = new Date(project.deadline);
      const eventStart = new Date(deadlineDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      const eventEnd = new Date(eventStart.getTime() + 1 * 60 * 60 * 1000);

      await calendarClient.createEvent(
        `[Deadline] ${project.name}`,
        `Project: ${project.description || ''}`,
        eventStart,
        eventEnd
      );
    }
  }
}
```

---

## 5. Slack/Discord 알림 통합

### 5.1 Slack Webhook

```typescript
// src/lib/slack.ts
export class SlackNotifier {
  private webhookUrl: string;

  constructor(webhookUrl: string = process.env.SLACK_WEBHOOK_URL || '') {
    this.webhookUrl = webhookUrl;
  }

  async notify(
    message: string,
    channel?: string,
    blocks?: any[]
  ): Promise<void> {
    const payload = {
      channel,
      text: message,
      blocks: blocks || [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        }
      ]
    };

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Slack error: ${response.statusText}`);
    }
  }

  async notifyWithButtons(
    message: string,
    actions: Array<{ label: string; value: string }>
  ): Promise<void> {
    const blocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: message }
      },
      {
        type: 'actions',
        elements: actions.map((action) => ({
          type: 'button',
          text: { type: 'plain_text', text: action.label },
          value: action.value,
          action_id: `action_${action.value}`
        }))
      }
    ];

    await this.notify(message, undefined, blocks);
  }
}
```

### 5.2 Discord Webhook

```typescript
// src/lib/discord.ts
export class DiscordNotifier {
  private webhookUrl: string;

  constructor(webhookUrl: string = process.env.DISCORD_WEBHOOK_URL || '') {
    this.webhookUrl = webhookUrl;
  }

  async notify(
    message: string,
    options?: {
      title?: string;
      color?: number;
      author?: string;
      footer?: string;
    }
  ): Promise<void> {
    const embed = {
      title: options?.title || 'Notification',
      description: message,
      color: options?.color || 0x0099FF,
      author: options?.author ? { name: options.author } : undefined,
      footer: options?.footer ? { text: options.footer } : undefined,
      timestamp: new Date().toISOString()
    };

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });

    if (!response.ok) {
      throw new Error(`Discord error: ${response.statusText}`);
    }
  }
}
```

---

## 6. 웹훅 & 이벤트 기반 아키텍처

### 6.1 웹훅 수신 구조

```typescript
// src/lib/webhook.ts
import crypto from 'crypto';

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: Date;
  data: any;
  source: string;
}

export class WebhookReceiver {
  static verifySignature(
    body: string,
    signature: string,
    secret: string
  ): boolean {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    return `sha256=${hash}` === signature;
  }

  static async saveWebhookEvent(event: WebhookEvent): Promise<void> {
    await db.query(
      `INSERT INTO webhook_events
       (id, type, data, source, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())`,
      [event.id, event.type, JSON.stringify(event.data), event.source]
    );
  }
}
```

### 6.2 API 라우트: 웹훅 수신

```typescript
// src/app/api/webhooks/[source]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver, WebhookEvent } from '@/lib/webhook';

export async function POST(
  req: NextRequest,
  { params }: { params: { source: string } }
) {
  const { source } = params;
  const signature = req.headers.get('x-signature') || '';
  const body = await req.text();

  const secret = process.env[`WEBHOOK_SECRET_${source.toUpperCase()}`];
  if (!WebhookReceiver.verifySignature(body, signature, secret || '')) {
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 }
    );
  }

  const event: WebhookEvent = {
    id: crypto.randomUUID(),
    type: req.headers.get('x-webhook-type') || 'unknown',
    timestamp: new Date(),
    data: JSON.parse(body),
    source
  };

  await WebhookReceiver.saveWebhookEvent(event);

  return NextResponse.json({ received: true });
}
```

### 6.3 이벤트 큐 디자인

```typescript
// src/lib/event-queue.ts
export interface QueuedEvent {
  id: string;
  type: string;
  data: any;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead-letter';
  retries: number;
  maxRetries: number;
  createdAt: Date;
  processedAt?: Date;
  error?: string;
}

export class EventQueue {
  async enqueue(
    type: string,
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

  async processQueue(batchSize: number = 10) {
    const events = await db.query<QueuedEvent>(
      `SELECT * FROM event_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1`,
      [batchSize]
    );

    for (const event of events) {
      try {
        await this.processEvent(event);

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

  private async handleRetry(event: QueuedEvent, error: any) {
    const newRetries = event.retries + 1;

    if (newRetries >= event.maxRetries) {
      await db.query(
        `UPDATE event_queue
         SET status = 'dead-letter', error = $1, processed_at = NOW()
         WHERE id = $2`,
        [String(error), event.id]
      );
    } else {
      const delay = Math.pow(2, newRetries);

      await db.query(
        `UPDATE event_queue
         SET status = 'pending',
             retries = $1,
             scheduled_at = NOW() + INTERVAL '${delay} minutes'
         WHERE id = $2`,
        [newRetries, event.id]
      );
    }
  }

  private async processEvent(event: QueuedEvent) {
    switch (event.type) {
      case 'task_completed':
        await this.handleTaskCompleted(event.data);
        break;
      case 'project_updated':
        await this.handleProjectUpdated(event.data);
        break;
      default:
        throw new Error(`Unknown event type: ${event.type}`);
    }
  }

  private async handleTaskCompleted(data: any) {
    // 작업 완료 처리
  }

  private async handleProjectUpdated(data: any) {
    // 프로젝트 업데이트 처리
  }
}
```

---

## 7. MCP 서버 아키텍처

### 7.1 MCP (Model Context Protocol) 개요

MCP는 Claude와 외부 도구 간 표준 프로토콜입니다.

### 7.2 MCP 서버 구현 (stdio 기반)

```typescript
// scripts/mcp-server.ts
import { Server } from '@anthropic-sdk/sdk';

const server = new Server({
  name: 'life-dashboard',
  version: '1.0.0'
});

// 리소스: 프로젝트 목록
server.setRequestHandler('resources/list', async () => {
  const projects = await db.query('SELECT * FROM projects');
  return {
    resources: projects.map((p) => ({
      uri: `dashboard://projects/${p.id}`,
      name: p.name,
      mimeType: 'application/json',
      description: p.description
    }))
  };
});

// 도구: 프로젝트 생성
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request;

  if (name === 'create_project') {
    const { title, description, deadline } = args;
    const project = await db.query(
      `INSERT INTO projects (name, description, deadline)
       VALUES ($1, $2, $3) RETURNING *`,
      [title, description, deadline]
    );
    return { content: [{ type: 'text', text: JSON.stringify(project.rows[0]) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// 프롬프트: 일일 정리
server.setRequestHandler('prompts/get', async (request) => {
  if (request.name === 'daily-summary') {
    const today = new Date().toISOString().split('T')[0];
    const history = await db.query(
      `SELECT * FROM history WHERE DATE(created_at) = $1`,
      [today]
    );

    return {
      description: 'Daily activity summary',
      arguments: [],
      messages: [
        {
          role: 'user',
          content: `Summarize today's activities`
        }
      ]
    };
  }

  throw new Error(`Unknown prompt: ${request.name}`);
});

server.connect(transport);
```

---

## 8. 보안 고려사항

### 8.1 API 키 관리

```typescript
// src/lib/secrets.ts
import crypto from 'crypto';

export class SecretManager {
  private encryptionKey: string;

  constructor(key: string = process.env.ENCRYPTION_KEY || '') {
    this.encryptionKey = key;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey),
      iv
    );

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
  }

  decrypt(encrypted: string): string {
    const [ivHex, ciphertext] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');

    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey),
      iv
    );

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
```

### 8.2 환경 변수 관리

```bash
# .env.local (git 제외)
OBSIDIAN_VAULT_PATH=~/groundone
ENCRYPTION_KEY=your-32-byte-hex-key
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
SLACK_SIGNING_SECRET=...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
RESEND_API_KEY=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
CRON_SECRET=your-cron-token
```

### 8.3 OAuth2 안전성

```typescript
// src/lib/oauth-state.ts
import crypto from 'crypto';

export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyOAuthState(state: string, storedState: string): boolean {
  return crypto.timingSafeEqual(
    Buffer.from(state),
    Buffer.from(storedState)
  );
}
```

### 8.4 레이트 제한 & 로깅

```typescript
// src/lib/rate-limit.ts
export async function checkRateLimit(identifier: string): Promise<boolean> {
  // Redis나 PostgreSQL을 사용한 레이트 제한
  const key = `ratelimit:${identifier}`;
  const count = await getFromCache(key);

  if (count > 10) {
    return false;
  }

  await incrementInCache(key);
  return true;
}
```

---

## 9. 구현 로드맵

### Phase 1: 기본 통합 (1주)
- Obsidian 파일 읽기/쓰기
- Slack 기본 알림
- API 로깅 및 모니터링

### Phase 2: 자동화 (2주)
- Gmail API 수신
- Google Calendar 동기화
- 이벤트 큐 시스템

### Phase 3: 고급 기능 (2주)
- Playwright 스크린샷/PDF
- MCP 서버 구축
- Discord 인터랙티브 메시지

### Phase 4: 보안 & 운영 (1주)
- 토큰 암호화
- 레이트 제한
- 감시 대시보드

---

## 10. 비용 분석

| 서비스 | 비용 | 용도 |
|------|------|------|
| Resend | 무료 | 이메일 발송 |
| Gmail API | 무료 | 이메일 수신 |
| Google Calendar | 무료 | 캘린더 동기화 |
| Slack | 무료 (기본) | 알림 |
| Discord | 무료 | 알림 |
| Playwright | 무료 | 브라우저 자동화 |
| Railway | $5-50/월 | 호스팅 |
| **총계** | ~$10-50/월 | |

---

## 11. 결론 및 추천사항

### 핵심 선택지
1. **옵시디언**: 직접 파일 접근 (경량) → 필요시 플러그인 확장
2. **브라우저**: Playwright (멀티 브라우저)
3. **이메일**: Resend (발송) + Gmail API (수신)
4. **캘린더**: Google Calendar API
5. **알림**: Slack + Discord 듀얼
6. **아키텍처**: 이벤트 큐 (신뢰성), MCP (Claude 통합)

### 우선순위
1. **High**: Obsidian 자동화, Slack 알림, 이벤트 큐
2. **Medium**: Gmail API, Google Calendar, 웹훅 수신
3. **Low**: Playwright, MCP, 고급 보안
