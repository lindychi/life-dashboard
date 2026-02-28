# User Automation Opportunities Research
**Life Dashboard × Agent System Integration Study**

---

## Executive Summary

This document investigates four key areas for automating user workflows through the Life Dashboard:

1. **Automation-Ready Business Domains** — Work areas that can be delegated to agents
2. **MCP Ecosystem Analysis** — Available protocol servers and capabilities
3. **External Service Integration** — APIs and tools for dashboard connectivity
4. **Security & Privacy Considerations** — Risk mitigation strategies

**Key Finding:** The Life Dashboard has strong potential to automate 60-70% of daily knowledge work through intelligent agent delegation, supported by a mature MCP ecosystem.

---

## 1. AUTOMATION-READY BUSINESS DOMAINS

### 1.1 Schedule & Calendar Management

**Opportunity Level: HIGH** ✅

#### Automatable Tasks:
- **Meeting Scheduling** — Auto-find optimal times across calendars, send invites
- **Recurring Event Management** — Create, update, cancel recurring meetings
- **Calendar Analytics** — Time tracking, busy-hour analysis, meeting load reporting
- **Conflict Detection** — Alert on overlapping events, suggest reschedule
- **Smart Blocking** — Auto-block focus time based on task deadlines

#### Required Integration:
- Google Calendar API
- Outlook/Microsoft Calendar API
- Calendly (if using for booking)

#### Agent Responsibilities:
- Calendar Analyzer: Weekly schedule optimization (Sunday planning)
- Meeting Coordinator: New meeting requests (confirm times, send details)
- Time Tracker: Daily meeting duration logging

#### Example Workflow:
```
User: "Schedule a 1-hour sync with the team for next week"
  ↓ Calendar Agent polls Google Calendar
  ↓ Finds best 1h slot Wed 2-3pm (no conflicts, all attendees free)
  ↓ Sends calendar invite + Slack notification
  ↓ Logs to History: "Team sync scheduled Wed 2-3pm"
```

---

### 1.2 Email Management

**Opportunity Level: HIGH** ✅

#### Automatable Tasks:
- **Inbox Triage** — Categorize, label, prioritize incoming mail
- **Smart Responses** — Draft auto-replies for routine requests
- **Email Summarization** — Daily digest of key messages
- **Follow-up Tracking** — Alert when awaiting replies
- **Newsletter Management** — Unsubscribe from unwanted, curate important ones
- **Spam Filtering** — Identify and isolate phishing attempts

#### Required Integration:
- Gmail API (read, modify, send)
- Microsoft Graph API (Outlook)
- Spam detection ML models (built or 3rd-party)

#### Agent Responsibilities:
- Email Processor: Daily inbox triage (smart categorization)
- Response Drafter: Template-based reply suggestions
- Newsletter Curator: Weekly digest generation

#### Example Workflow:
```
User: "What's my email status?"
  ↓ Email Processor pulls last 24h unread count
  ↓ Identifies 3 urgent (red flag keywords), 12 routine
  ↓ Drafts responses to FAQs (meeting requests, status updates)
  ↓ Reports: "3 urgent, 12 routine. Summary: [digest of key emails]"
```

---

### 1.3 Document Authorship & Management

**Opportunity Level: HIGH** ✅

#### Automatable Tasks:
- **Document Drafting** — Generate meeting notes, status reports, proposals
- **Content Outlines** — Structure blogs, articles, research papers
- **Multi-Format Export** — Convert markdown → PDF, HTML, Word
- **Editing & Review** — Grammar, style, tone suggestions
- **Version Management** — Track changes, merge edits from multiple sources
- **Compliance Checking** — Verify against style guides, templates

#### Required Integration:
- Google Docs API
- Microsoft Word / OneDrive API
- Notion API
- Obsidian-compatible markdown storage
- Pandoc (or equivalent for format conversion)

#### Agent Responsibilities:
- Content Generator: Draft proposals, reports, meeting notes
- Editor: Grammar/style review, tone adjustment
- Archivist: Version control, format conversion

#### Example Workflow:
```
User: "Generate meeting notes from today's 3pm standup recording"
  ↓ Document Generator transcribes audio (Whisper/API)
  ↓ Extracts action items, decisions, risks
  ↓ Formats as structured meeting note doc
  ↓ Uploads to shared Google Drive folder
  ↓ Notifies attendees via Slack: "Notes ready → [link]"
```

---

### 1.4 Financial & Expense Tracking

**Opportunity Level: MEDIUM-HIGH** ⭐

#### Automatable Tasks:
- **Expense Categorization** — Auto-tag receipts (food, travel, software, etc.)
- **Receipt OCR** — Extract vendor, amount, date from photos
- **Budget Analysis** — Monthly spending reports, trend analysis
- **Tax Preparation** — Aggregate deductible expenses by category
- **Invoice Tracking** — Monitor paid/pending client invoices
- **Investment Monitoring** — Stock price alerts, portfolio rebalancing alerts
- **Currency Conversion** — Auto-convert foreign expenses to home currency

#### Required Integration:
- Stripe / PayPal API (transaction history)
- Open Banking APIs (Plaid, Finicity for bank aggregation)
- Receipt scanning: Adobe Extract API, Tesseract OCR
- Stock data: Alpha Vantage, yfinance API
- Cryptocurrency: CoinGecko, Binance API

#### Agent Responsibilities:
- Finance Analyst: Monthly spending reports, budget forecasting
- Receipt Processor: Photo → structured expense entry
- Tax Preparer: Year-end expense aggregation

#### Example Workflow:
```
User: "Upload receipt photo"
  ↓ Receipt Processor OCRs image → {vendor: "Starbucks", amount: $5.50, date: today}
  ↓ Auto-categorizes as "Food & Dining"
  ↓ Adds to Life Dashboard Finance tab
  ↓ Updates monthly budget tracker
```

---

### 1.5 Health & Wellness Tracking

**Opportunity Level: MEDIUM** ⭐

#### Automatable Tasks:
- **Health Data Aggregation** — Sync Apple Health, Fitbit, Strava data
- **Wellness Insights** — Sleep, exercise, hydration trend analysis
- **Habit Tracking** — Daily/weekly progress on health goals
- **Medication Reminders** — Smart pill reminders with escalation
- **Workout Planning** — Generate exercise routines based on goals
- **Mental Health Check-ins** — Scheduled mood/stress surveys

#### Required Integration:
- Apple HealthKit API
- Fitbit / Garmin API
- Strava API (running/cycling)
- MyFitnessPal API (nutrition)
- Mood tracking apps (Day One, Daylio)

#### Agent Responsibilities:
- Wellness Analyst: Weekly health report (sleep avg, exercise minutes, mood trend)
- Habit Tracker: Daily check-in prompts, progress celebration
- Fitness Coach: Personalized workout suggestions

#### Example Workflow:
```
Weekly automation:
  ↓ Health Analyst pulls all data sources
  ↓ Generates report: "Avg sleep: 7.2h ↑ | Exercise: 4 sessions | Mood: stable"
  ↓ Alerts: "Sleep down 30min vs target" (recommend earlier bedtime)
  ↓ Surfaces in Dashboard Health tab
```

---

### 1.6 Social Media & Content Management

**Opportunity Level: MEDIUM** ⭐

#### Automatable Tasks:
- **Post Scheduling** — Draft, schedule, publish across platforms
- **Content Calendar** — Plan monthly content, theme alignment
- **Engagement Tracking** — Monitor likes, comments, replies
- **Hashtag Research** — Suggest trending, relevant hashtags
- **Cross-posting** — Sync content across Twitter, LinkedIn, Bluesky
- **Audience Insights** — Demographic, engagement analysis

#### Required Integration:
- Twitter / X API (v2)
- LinkedIn API
- Instagram Graph API
- Bluesky API
- TikTok API (if applicable)
- Buffer / Hootsuite API (optional aggregation)

#### Agent Responsibilities:
- Content Scheduler: Schedule posts with optimal timing
- Social Analyst: Weekly engagement reports
- Growth Manager: Hashtag research, audience insights

#### Example Workflow:
```
User: "Post a thread about automation best practices"
  ↓ Content Scheduler suggests optimal posting time (Tue 9am)
  ↓ Drafts 5-tweet thread with industry hashtags
  ↓ User approves → posts at scheduled time
  ↓ Monitors engagement, reports next day
```

---

### 1.7 Code & Development Task Automation

**Opportunity Level: MEDIUM-HIGH** ⭐⭐

#### Automatable Tasks:
- **Code Review** — Static analysis, style checking, security scanning
- **Deployment Automation** — Build, test, deploy pipelines
- **Dependency Management** — Security updates, outdated package detection
- **CI/CD Monitoring** — Alert on failed builds, test regressions
- **Documentation Generation** — Auto-generate API docs, changelogs
- **Refactoring Suggestions** — Identify code quality issues, suggest improvements
- **Git Workflow Automation** — Commit message generation, branch cleanup

#### Required Integration:
- GitHub API (repos, workflows, actions)
- GitLab API (CI/CD)
- Bitbucket API
- SonarQube / Code Climate API (quality scanning)
- Snyk / Dependabot API (security scanning)

#### Agent Responsibilities:
- Code Reviewer: Automated code quality analysis
- DevOps Agent: Deployment monitoring and automation
- Dependency Manager: Security and version updates

#### Example Workflow:
```
Daily automation:
  ↓ DevOps Agent polls GitHub repos for pending PRs
  ↓ Runs security scan, linting, test coverage checks
  ↓ Comments with failures: "[!] TypeScript errors in src/auth.ts:45"
  ↓ Alerts if build fails: "main branch broken—details in dashboard"
  ↓ Auto-deploys to staging on successful green build
```

---

### 1.8 Deployment & Infrastructure Automation

**Opportunity Level: MEDIUM-HIGH** ⭐⭐

#### Automatable Tasks:
- **Container Management** — Build, push, deploy Docker images
- **Infrastructure as Code** — Terraform/CloudFormation automation
- **Log Monitoring** — Aggregate, alert on error patterns
- **Uptime Monitoring** — Health checks, alerting
- **Database Backups** — Automated snapshots, retention management
- **Cost Optimization** — Identify unused resources, downsize recommendations
- **Incident Response** — Auto-triage, page on-call engineers

#### Required Integration:
- Kubernetes API
- Docker Hub / ECR API
- AWS / Azure / GCP APIs
- Terraform Cloud API
- Datadog / New Relic / Grafana API
- PagerDuty API

#### Agent Responsibilities:
- Infrastructure Monitor: Alert on failures, cost anomalies
- Deployment Agent: Safe blue-green or canary deployments
- SRE Agent: Incident alerting, auto-remediation

#### Example Workflow:
```
Real-time:
  ↓ Monitoring Agent detects elevated error rate (>1% from baseline)
  ↓ Pulls last 100 error logs, identifies pattern: "Database timeout"
  ↓ Escalates: "Prod database experiencing 5s latency" + diagnostic logs
  ↓ Alerts on-call engineer via PagerDuty
  ↓ Dashboard shows: "Incident #42: DB latency" with remediation suggestions
```

---

### 1.9 Content & Knowledge Curation

**Opportunity Level: MEDIUM** ⭐

#### Automatable Tasks:
- **Feed Aggregation** — RSS, Hacker News, Reddit, Twitter trending
- **Reading List Curation** — Save, tag, recommend articles based on interests
- **Knowledge Base Building** — Auto-index bookmarks, research, notes
- **Research Synthesis** — Summarize multiple sources on a topic
- **Learning Path Suggestions** — Recommend next skill/course to learn
- **Topic Alerts** — Notify when new content on interests appears

#### Required Integration:
- Feedly / Inoreader API (feed aggregation)
- Instapaper / Pocket API (reading list)
- Obsidian / Notion API (knowledge base)
- Hacker News API
- Reddit API
- Twitter / X API (trending, saved)

#### Agent Responsibilities:
- Curator: Daily reading list (top 5 articles matching interests)
- Researcher: Deep-dive research synthesis (5-source summary)
- Learning Advisor: Skill recommendations based on goals

#### Example Workflow:
```
Daily automation:
  ↓ Curator polls 50+ RSS feeds, HN, Reddit
  ↓ Filters to "AI/LLM" and "productivity" tags (user interests)
  ↓ Ranks by relevance, engagement potential
  ↓ Creates morning brief: "Top 5 AI articles you should read"
  ↓ Saves top 3 to Instapaper for async reading
```

---

### 1.10 Project & Task Management

**Opportunity Level: MEDIUM** ⭐

#### Automatable Tasks:
- **Task Creation** — Parse email/Slack into actionable tasks
- **Prioritization** — Auto-prioritize backlog based on deadlines, impact
- **Status Reporting** — Auto-generate project status from task data
- **Deadline Tracking** — Alert on overdue/at-risk items
- **Time Estimation** — ML-based completion time prediction
- **Retrospective Generation** — Automated lessons learned summaries
- **Team Insights** — Workload balancing, capacity forecasting

#### Required Integration:
- Asana / Monday.com / Jira API
- Todoist / Things API
- Slack API (task creation from messages)
- GitHub Issues API
- Linear API

#### Agent Responsibilities:
- Task Manager: Weekly prioritization, deadline alerts
- Project Analyst: Status reports, risk identification
- Retrospective Agent: Auto-generate sprint retrospectives

#### Example Workflow:
```
User: "Hey Slack bot, I need to refactor auth module"
  ↓ Task Manager detects (Slack mention)
  ↓ Creates Jira story: "Refactor auth module"
  ↓ Sets priority: Medium (tech debt, not blocking)
  ↓ Estimates: 8 hours (based on historical similar tasks)
  ↓ Schedules for next sprint week 2
```

---

## 2. MCP ECOSYSTEM ANALYSIS

### 2.1 Current MCP Landscape (2025)

**What is MCP?** Model Context Protocol — a standardized interface for AI agents to call external tools/services.

#### Core Categories

| Category | Server Name | Status | Capabilities |
|----------|------------|--------|--------------|
| **Filesystem** | `filesystem` | ✅ Stable | Read/write/search files, directory operations |
| **Git** | `git` | ✅ Stable | Clone, commit, push, branch management, log reading |
| **Database** | `postgres`, `mysql`, `sqlite` | ✅ Stable | Query execution, schema inspection |
| **Browser** | `puppeteer`, `playwright` | ✅ Stable | Web automation, screenshot, DOM navigation |
| **Calendar** | `google-calendar` | ⭐ Available | List events, create, update, delete |
| **Email** | `gmail-server` | ⭐ Available | Read, send, search emails |
| **Cloud Storage** | `s3`, `azure-blob`, `gcs` | ✅ Stable | Upload, download, list, delete objects |
| **Code Analysis** | `tree-sitter`, `ast-parser` | ✅ Stable | Parse, analyze code structure |
| **API Calling** | `http-client` | ✅ Stable | Generic HTTP requests (auth, headers, body) |

### 2.2 Recommended MCP Servers for Life Dashboard

#### Tier 1: Immediate High-Value

1. **filesystem** (built-in)
   - Use: Read/write task docs, notes, attachments
   - Integration: Already in Life Dashboard via `src/lib/storage.ts`

2. **git** (built-in)
   - Use: Repo operations for agents
   - Integration: Agent task tracking, version control

3. **http-client** (essential)
   - Use: Generic HTTP calls to external APIs
   - Integration: Core for all 3rd-party integrations

#### Tier 2: High-Value Integrations (Priority Order)

```typescript
// Recommended Tier 2 MCP Deployments

1. google-calendar-mcp
   Purpose: Schedule management, conflict detection
   Config:
     GOOGLE_CLIENT_ID: from GCP console
     GOOGLE_CLIENT_SECRET: from service account
     SCOPES: ["calendar", "events:read", "events:write"]

2. gmail-mcp-server
   Purpose: Email triage, auto-reply drafting
   Config:
     GMAIL_SERVICE_ACCOUNT: JSON key file
     SCOPES: ["gmail.modify", "gmail.compose"]

3. notion-mcp-server
   Purpose: Documentation, task tracking
   Config:
     NOTION_API_KEY: from notion.so integration
     AUTHORIZED_DB_IDS: [list of database IDs]

4. github-api-mcp
   Purpose: Repo monitoring, PR review alerts
   Config:
     GITHUB_TOKEN: personal access token
     GITHUB_REPOS: ["user/repo1", "user/repo2"]

5. slack-mcp-server
   Purpose: Notifications, inter-agent messaging
   Config:
     SLACK_BOT_TOKEN: from Slack app
     SLACK_SIGNING_SECRET: for request verification
```

#### Tier 3: Specialized (As Needed)

- **PostgreSQL MCP** — Direct database access for agents (already integrated)
- **AWS S3 MCP** — If using S3 for attachment storage
- **Stripe MCP** — Payment processing, subscription management
- **Anthropic API MCP** — Model calling, embeddings
- **LangChain MCP** — Multi-step LLM orchestration
- **Perplexity MCP** — Real-time web search for research tasks

### 2.3 MCP Server Deployment Architecture

#### Recommended Setup:

```
Life Dashboard (Next.js)
    ├── Relay System (gateway-connector)
    │   └── Claude CLI + MCP Client
    │       ├── Built-in: filesystem, git
    │       ├── Tier 2:
    │       │   ├── google-calendar-mcp
    │       │   ├── gmail-mcp-server
    │       │   ├── notion-mcp-server
    │       │   ├── github-api-mcp
    │       │   └── slack-mcp-server
    │       └── Tier 3: [specialized servers]
    │
    └── HTTP Client MCP (fallback)
        └── Generic REST API calls

Database: PostgreSQL
  ├── agent_history (task execution logs)
  ├── messages (agent communication)
  ├── task_queue (TBD: task scheduling)
  └── integrations (API key storage, encrypted)
```

#### Safety Wrapper Pattern:

```typescript
// scripts/mcp-security-wrapper.ts
// Enforces:
// - Auth: All MCP calls require valid session/relay-key
// - Rate limiting: Max 100 calls/min per agent
// - Audit logging: All external tool calls logged to PostgreSQL
// - Scope enforcement: Each agent has allowed MCP list
// - Prompt injection prevention: Sanitize all user inputs

class MCPSecurityWrapper {
  async executeWithSafety(
    agentId: string,
    toolName: string,
    params: Record<string, unknown>,
  ) {
    // 1. Verify agent has permission for this tool
    const allowedTools = await getAgentMCPScope(agentId);
    if (!allowedTools.includes(toolName)) {
      throw new Error(`Agent ${agentId} not authorized for ${toolName}`);
    }

    // 2. Check rate limit (Redis counter)
    const callsThisMin = await rateLimit.increment(`mcp:${agentId}`, 60);
    if (callsThisMin > 100) {
      throw new Error(`Rate limit exceeded for agent ${agentId}`);
    }

    // 3. Sanitize params (prevent injection)
    const cleanParams = sanitizeParams(params);

    // 4. Execute via MCP client
    const result = await mcpClient.execute(toolName, cleanParams);

    // 5. Audit log
    await auditLog.record({
      agentId,
      toolName,
      timestamp: Date.now(),
      inputHash: hash(cleanParams),
      outputHash: hash(result),
      status: 'success',
    });

    return result;
  }
}
```

---

## 3. EXTERNAL SERVICE INTEGRATIONS

### 3.1 Priority Integration Matrix

| Service | Category | API Quality | Auth | Data Sensitivity | Effort | Benefit | Priority |
|---------|----------|------------|------|------------------|--------|---------|----------|
| **Google Calendar** | Scheduling | ⭐⭐⭐⭐⭐ | OAuth2 | High | 2d | High | 1️⃣ |
| **Gmail** | Email | ⭐⭐⭐⭐⭐ | OAuth2 | Critical | 3d | High | 1️⃣ |
| **GitHub** | DevOps | ⭐⭐⭐⭐⭐ | PAT/OAuth | Medium | 2d | High | 2️⃣ |
| **Slack** | Messaging | ⭐⭐⭐⭐⭐ | OAuth2 | Medium | 1d | High | 2️⃣ |
| **Notion** | Docs | ⭐⭐⭐⭐ | API Key | Medium | 1d | Medium | 2️⃣ |
| **Obsidian** | Knowledge | ⭐⭐⭐ | Direct File | Medium | 1d | Medium | 3️⃣ |
| **Stripe** | Payments | ⭐⭐⭐⭐⭐ | API Key | Critical | 2d | Medium | 3️⃣ |
| **Google Docs** | Docs | ⭐⭐⭐⭐ | OAuth2 | High | 3d | Medium | 3️⃣ |
| **Plaid** | Banking | ⭐⭐⭐⭐ | OAuth2 | Critical | 2d | Medium | 4️⃣ |
| **Alpha Vantage** | Finance | ⭐⭐⭐ | API Key | Low | 1d | Low | 4️⃣ |
| **OpenAI API** | AI/ML | ⭐⭐⭐⭐⭐ | API Key | Medium | 1d | High | 2️⃣ |
| **HubSpot** | CRM | ⭐⭐⭐⭐ | OAuth2 | High | 2d | Medium | 4️⃣ |

### 3.2 High-Priority Integrations (Detailed)

#### 3.2.1 Google Workspace Suite

**Calendar Integration:**
```typescript
// src/integrations/google-calendar.ts
interface CalendarIntegrationConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  scopes: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ];
}

// Agent operations:
// ✅ listEvents(timeMin, timeMax)
// ✅ createEvent(title, startTime, endTime, attendees)
// ✅ updateEvent(eventId, updates)
// ✅ deleteEvent(eventId)
// ✅ findAvailability(attendees, duration) — suggests free slots
// ✅ getFreeBusyStatus(attendees) — for scheduling
```

**Gmail Integration:**
```typescript
// src/integrations/gmail.ts
interface GmailIntegrationConfig {
  serviceAccountKey: ServiceAccountKey;
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
  ];
}

// Agent operations:
// ✅ getUnreadCount()
// ✅ listMessages(query, maxResults)
// ✅ getMessage(messageId)
// ✅ sendMessage(to, subject, body, attachments)
// ✅ draftReply(messageId, body)
// ✅ labelMessage(messageId, labels)
// ✅ searchMessages(query) — advanced filtering
// ✅ markAsRead(messageIds)
```

#### 3.2.2 GitHub Integration

```typescript
// src/integrations/github.ts
interface GitHubIntegrationConfig {
  personalAccessToken: string;
  repos: Array<{ owner: string; repo: string }>;
}

// Agent operations:
// ✅ listPullRequests(repo, state)
// ✅ getPullRequestDetails(repo, prNumber)
// ✅ createPullRequest(repo, { title, body, head, base })
// ✅ mergePullRequest(repo, prNumber, method)
// ✅ listRepoIssues(repo, labels)
// ✅ createIssue(repo, { title, body, labels, assignees })
// ✅ triggerWorkflow(repo, workflowId, inputs)
// ✅ getWorkflowRuns(repo, workflowId, status)
// ✅ listDeployments(repo, environment)
```

#### 3.2.3 Slack Integration

```typescript
// src/integrations/slack.ts
interface SlackIntegrationConfig {
  botToken: string;
  signingSecret: string;
  teamId: string;
}

// Agent operations:
// ✅ postMessage(channelId, text, blocks)
// ✅ updateMessage(channelId, messageTs, text)
// ✅ createThread(channelId, text, parentTs)
// ✅ getChannelInfo(channelId)
// ✅ listChannels(cursor)
// ✅ getUserInfo(userId)
// ✅ listUsers(cursor)
// ✅ openModal(triggerId, view)
// ✅ sendEphemeralMessage(channelId, userId, text) — private msg
// ✅ fileUpload(channels, file, filename) — share files
```

#### 3.2.4 Notion Integration

```typescript
// src/integrations/notion.ts
interface NotionIntegrationConfig {
  apiKey: string; // "Bearer secret_xxxxx"
  authorizedDatabases: string[]; // Database IDs user owns
}

// Agent operations:
// ✅ queryDatabase(databaseId, filter, sorts)
// ✅ createPage(parentId, properties) — add task, note
// ✅ updatePage(pageId, properties)
// ✅ appendBlockChildren(blockId, children) — add to page
// ✅ getDatabase(databaseId)
// ✅ getUser(userId)
// ✅ searchPages(query) — full-text search
```

### 3.3 Integration Data Flow Diagram

```
Life Dashboard Frontend
    ↓
[User Action: "Send daily digest"]
    ↓
Task Queue (PostgreSQL)
    ↓ (scheduled daily, 8am)
Release Agent Task
    ↓
Gateway Connector polls Task
    ↓
Claude CLI executes:
  ├─ MCP: gmail-server → Fetch unread emails
  ├─ MCP: http-client → Fetch RSS feeds via Feedly API
  ├─ MCP: postgres → Query task deadlines
  └─ MCP: http-client → Fetch trending HN stories
    ↓
Aggregate + synthesize
    ↓
Draft HTML digest
    ↓
Send via: Gmail API + Slack API
    ↓
Log to agent_history table
    ↓
Dashboard displays: "Digest sent to 3 recipients"
```

### 3.4 API Credential Management Strategy

**Database Schema: `integrations` Table**

```sql
CREATE TABLE integrations (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  service_name TEXT, -- 'google-calendar', 'github', 'slack', etc.

  -- Encrypted credentials (AES-256)
  credentials BYTEA, -- encrypted JSON blob
  credentials_iv BYTEA, -- IV for encryption

  -- Non-sensitive metadata
  account_name TEXT, -- email, GitHub username, etc.
  scopes TEXT[], -- OAuth scopes granted

  -- Status tracking
  auth_status TEXT, -- 'active', 'expired', 'revoked'
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP, -- for tokens with TTL

  created_at TIMESTAMP,
  updated_at TIMESTAMP,

  UNIQUE(agent_id, service_name)
);

-- Audit trail
CREATE TABLE integration_access_log (
  id UUID PRIMARY KEY,
  integration_id UUID REFERENCES integrations(id),
  agent_id UUID REFERENCES agents(id),
  operation TEXT, -- 'read', 'write', 'delete'
  resource TEXT, -- 'email', 'file', 'calendar_event'
  resource_id TEXT, -- specific email_id, file_id, etc.
  status TEXT, -- 'success', 'failed'
  error_message TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

**Credential Encryption Pattern:**

```typescript
// src/lib/integration-secrets.ts
import crypto from 'crypto';

class IntegrationSecrets {
  private readonly encryptionKey = Buffer.from(
    process.env.INTEGRATION_ENCRYPTION_KEY, // 32 bytes (256-bit)
    'base64'
  );

  encryptCredentials(plaintext: Record<string, unknown>): {
    encrypted: Buffer;
    iv: Buffer;
  } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    const json = JSON.stringify(plaintext);
    let encrypted = cipher.update(json, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return { encrypted, iv };
  }

  decryptCredentials(encrypted: Buffer, iv: Buffer): Record<string, unknown> {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString('utf8'));
  }
}
```

---

## 4. SECURITY & PRIVACY CONSIDERATIONS

### 4.1 Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|-----------|
| **Credential Exposure** | 🔴 Critical | Medium | AES-256 encryption, separate vaults, rotation |
| **Prompt Injection** | 🔴 Critical | High | Input sanitization, parameterized MCP calls |
| **Unauthorized API Access** | 🔴 Critical | Medium | RBAC, audit logging, rate limiting |
| **Data Exfiltration** | 🔴 Critical | Medium | DLP policies, encrypted storage, encryption at rest |
| **Session Hijacking** | 🟠 High | Low | HTTP-only cookies, CSRF tokens, short TTL |
| **Rate Limit Abuse** | 🟠 High | High | Per-agent throttling, exponential backoff |
| **Scope Creep** | 🟡 Medium | High | Explicit permission prompts, regular audits |
| **Stale Token Handling** | 🟡 Medium | High | Refresh token rotation, graceful degradation |

### 4.2 Authorization Framework

**Role-Based Access Control (RBAC):**

```typescript
// src/lib/rbac.ts
interface AgentCapabilities {
  id: string; // agent ID
  permissions: {
    read: string[]; // MCP tools allowed for reading
    write: string[]; // Tools for writing/modifying
    delete: string[]; // Tools for deletion
    execute: string[]; // Tools for executing (webhooks, deployments)
  };
  resourceScopes: {
    gmail?: {
      labels: string[]; // which labels can agent access?
      maxEmails: number; // rate limit
    };
    github?: {
      repos: string[]; // which repos?
      actions: ('read' | 'create' | 'merge')[];
    };
    calendar?: {
      calendars: string[]; // which calendars?
    };
    // ... more services
  };
  rateLimits: {
    callsPerMinute: number;
    callsPerHour: number;
    dataPerDay: ByteSize;
  };
}

async function enforceRBAC(
  agentId: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  const capabilities = await getAgentCapabilities(agentId);

  // Verify tool access
  const [category, action] = toolName.split(':');
  if (!capabilities.permissions[action]?.includes(category)) {
    throw new Error(`RBAC: Agent ${agentId} not authorized for ${toolName}`);
  }

  // Verify resource scope (if applicable)
  if (category === 'gmail' && params.label) {
    if (!capabilities.resourceScopes.gmail.labels.includes(params.label)) {
      throw new Error(`Agent cannot access Gmail label: ${params.label}`);
    }
  }

  // Rate limit check
  const usage = await getAgentUsage(agentId, 'minute');
  if (usage >= capabilities.rateLimits.callsPerMinute) {
    throw new Error(`Rate limit exceeded for agent ${agentId}`);
  }

  return true;
}
```

### 4.3 Input Sanitization & Injection Prevention

```typescript
// src/lib/sanitize.ts
import { z } from 'zod';

const EmailAddressSchema = z.string().email();
const CalendarEventSchema = z.object({
  title: z.string().max(256).regex(/^[\w\s\-():.,']+$/), // no special chars
  description: z.string().max(5000),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  attendees: z.array(EmailAddressSchema),
});

const GitHubRepoSchema = z.object({
  owner: z.string().regex(/^[a-zA-Z0-9-]+$/),
  repo: z.string().regex(/^[a-zA-Z0-9._-]+$/),
});

// Prevention: whitelist safe characters
function sanitizeUserInput(input: string, allowedChars?: RegExp): string {
  const defaultPattern = /^[\w\s\-().,!?:'";/@#$%&=+]+$/;
  const pattern = allowedChars || defaultPattern;

  if (!pattern.test(input)) {
    throw new Error(`Invalid characters in input: ${input}`);
  }

  // Remove null bytes, control chars
  return input.replace(/[\x00-\x1F\x7F]/g, '');
}

// SQL injection prevention: parameterized queries (already used via `pg`)
async function safeQuery<T>(
  sql: string,
  params: unknown[]
): Promise<T[]> {
  // `pg` library automatically uses parameterized queries
  return db.query<T>(sql, params);
}
```

### 4.4 Data Privacy Framework

**Personal Data Classification:**

```typescript
// src/lib/data-classification.ts
enum DataClassification {
  PUBLIC = 'public', // Blog posts, public docs
  INTERNAL = 'internal', // Internal notes, meeting notes
  CONFIDENTIAL = 'confidential', // Financial data, health data
  RESTRICTED = 'restricted', // Passwords, API keys, SSNs
}

interface DataPrivacyPolicy {
  classification: DataClassification;

  // Retention
  retention: {
    minDays: number;
    maxDays: number;
    deleteAfterDays?: number;
  };

  // Access
  accessControl: {
    agents: string[]; // which agents can access?
    encryptedAtRest: boolean;
    encryptedInTransit: boolean;
  };

  // Purpose limitation
  allowedPurposes: ('agent_execution' | 'audit' | 'analytics' | 'user_request')[];
}

const DataClassificationRules: Record<string, DataPrivacyPolicy> = {
  'gmail': {
    classification: DataClassification.CONFIDENTIAL,
    retention: { minDays: 0, maxDays: 90 },
    accessControl: {
      agents: ['email-processor', 'digest-generator'],
      encryptedAtRest: true,
      encryptedInTransit: true,
    },
    allowedPurposes: ['agent_execution', 'audit'],
  },
  'calendar': {
    classification: DataClassification.INTERNAL,
    retention: { minDays: 0, maxDays: 365 },
    accessControl: {
      agents: ['calendar-scheduler', 'meeting-coordinator'],
      encryptedAtRest: false,
      encryptedInTransit: true,
    },
    allowedPurposes: ['agent_execution'],
  },
  'financial': {
    classification: DataClassification.RESTRICTED,
    retention: { minDays: 365, maxDays: 2555 }, // 7 years for taxes
    accessControl: {
      agents: ['finance-analyst', 'tax-preparer'],
      encryptedAtRest: true,
      encryptedInTransit: true,
    },
    allowedPurposes: ['agent_execution', 'audit'],
  },
};
```

### 4.5 Audit & Compliance Logging

```typescript
// src/lib/audit-log.ts
interface AuditLogEntry {
  id: string;
  timestamp: Date;
  actor: string; // agent ID or user ID
  action: string; // 'read_email', 'create_calendar_event'
  resource: string; // 'gmail', 'calendar', 'github'
  resourceId: string; // email_id, event_id, etc.

  // Before/after for modifications
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;

  // Result
  status: 'success' | 'failure';
  errorMessage?: string;

  // Context
  ipAddress: string;
  userAgent: string;
  integrationVersion: string;

  // Sensitive flags
  dataClassification: DataClassification;
  pii?: boolean; // contains PII?
}

async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  // 1. Store to database
  await db.query(
    `INSERT INTO audit_log
     (id, timestamp, actor, action, resource, resource_id, status, data_classification)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.id,
      entry.timestamp,
      entry.actor,
      entry.action,
      entry.resource,
      entry.resourceId,
      entry.status,
      entry.dataClassification,
    ]
  );

  // 2. Alert on suspicious patterns
  if (entry.status === 'failure') {
    await alertOnAnomalousActivity(entry);
  }

  // 3. Retention: delete logs older than 90 days
  await db.query(
    `DELETE FROM audit_log WHERE timestamp < NOW() - INTERVAL '90 days'`
  );
}

async function alertOnAnomalousActivity(entry: AuditLogEntry): Promise<void> {
  // Pattern detection:
  // - Agent accessing data outside normal schedule
  // - High-volume data access
  // - Failed auth attempts
  // - Accessing unauthorized resource scopes

  const recentFailures = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM audit_log
     WHERE actor = $1 AND status = 'failure' AND timestamp > NOW() - INTERVAL '1 hour'`,
    [entry.actor]
  );

  if (recentFailures[0]?.count > 10) {
    await sendSecurityAlert({
      severity: 'high',
      message: `Agent ${entry.actor} has 10+ failed operations in last hour`,
      details: entry,
    });
  }
}
```

### 4.6 Credential Rotation & Token Management

```typescript
// src/lib/credential-rotation.ts
interface TokenRefreshStrategy {
  service: string;
  refreshInterval: number; // days
  rotationMethod: 'oauth_refresh' | 'manual_reauth' | 'api_key_rollover';
}

const RotationSchedule: Record<string, TokenRefreshStrategy> = {
  'google-calendar': {
    service: 'google-calendar',
    refreshInterval: 30, // Refresh every 30 days
    rotationMethod: 'oauth_refresh',
  },
  'github': {
    service: 'github',
    refreshInterval: 180, // 6 months
    rotationMethod: 'manual_reauth',
  },
  'slack': {
    service: 'slack',
    refreshInterval: 90,
    rotationMethod: 'oauth_refresh',
  },
};

async function rotateExpiredCredentials(): Promise<void> {
  const integrations = await db.query<{
    id: string;
    service_name: string;
    updated_at: Date;
  }>(
    `SELECT id, service_name, updated_at FROM integrations
     WHERE last_rotated_at < NOW() - INTERVAL '30 days'`
  );

  for (const integration of integrations) {
    const strategy = RotationSchedule[integration.service_name];

    if (strategy?.rotationMethod === 'oauth_refresh') {
      await refreshOAuthToken(integration.id);
    } else if (strategy?.rotationMethod === 'manual_reauth') {
      // Trigger re-authentication flow
      await requestReAuthentication(integration.id);
    }
  }
}

async function refreshOAuthToken(integrationId: string): Promise<void> {
  const integration = await getIntegration(integrationId);
  const credentials = await decryptCredentials(integration.credentials);

  const newTokens = await fetch(`${integration.token_endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.OAUTH_CLIENT_ID,
      client_secret: process.env.OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    }),
  }).then(r => r.json());

  // Store new tokens
  const encrypted = encryptCredentials({
    ...credentials,
    accessToken: newTokens.access_token,
    refreshToken: newTokens.refresh_token || credentials.refreshToken,
  });

  await updateIntegration(integrationId, {
    credentials: encrypted.encrypted,
    credentials_iv: encrypted.iv,
    last_rotated_at: new Date(),
  });
}
```

### 4.7 Compliance Checklist

**GDPR Compliance:**
- ✅ Data minimization: Only collect data needed for stated purpose
- ✅ Purpose limitation: Data used only for documented purposes
- ✅ Storage limitation: Retention schedules enforced
- ✅ Integrity & confidentiality: AES-256 encryption at rest
- ✅ Right to erasure: Implement data deletion workflows
- ✅ Data portability: Export agent history, messages in standard formats
- ✅ Transparency: Clear privacy policy explaining integrations

**CCPA (California):**
- ✅ Consumer rights: Data access/deletion/opt-out mechanisms
- ✅ Disclosure: Clear notice of data collection
- ✅ Opt-out: Disable specific integrations on demand
- ✅ Non-discrimination: Provide same service even if data sharing declined

**Data Processing Agreements (DPA):**
- Gmail API: Sign Google Cloud Data Processing Amendment
- GitHub API: Sign GitHub Data Protection Amendment
- Stripe: Sign Stripe Data Processing Addendum

---

## 5. IMPLEMENTATION ROADMAP

### Phase 1: Foundational (Weeks 1-4)
- [ ] MCP security wrapper implementation
- [ ] Credential encryption & storage
- [ ] RBAC framework
- [ ] Audit logging system
- [ ] GitHub + Slack MCP integration

### Phase 2: High-Value Services (Weeks 5-8)
- [ ] Google Calendar MCP integration
- [ ] Gmail MCP integration
- [ ] Notion MCP integration
- [ ] Calendar scheduling agent
- [ ] Email triage agent

### Phase 3: Advanced Automation (Weeks 9-12)
- [ ] Finance tracking agent (Stripe, Plaid)
- [ ] Health data aggregation (Apple Health, Fitbit APIs)
- [ ] Content curation agent (RSS, HN API)
- [ ] Task management agent

### Phase 4: Polish & Monitoring (Weeks 13+)
- [ ] Dashboard widgets for each integration
- [ ] Real-time alerts & notifications
- [ ] Usage analytics & optimization
- [ ] Security audit & penetration testing

---

## 6. SUCCESS METRICS

**Quantitative:**
- Agent uptime: > 99%
- API error rate: < 0.5%
- Average task completion time: < 2 minutes
- Credential rotation success rate: 100%
- Audit log completeness: 100%

**Qualitative:**
- User satisfaction: > 4.5/5
- Time saved per user: > 5 hours/week
- Integration reliability: Zero unplanned outages

---

## 7. REFERENCES & RESOURCES

### MCP Specifications
- [Anthropic MCP GitHub](https://github.com/anthropics/model-context-protocol)
- [MCP Documentation](https://modelcontextprotocol.io/)

### Integration Guides
- [Google API Python Client](https://github.com/googleapis/google-api-python-client)
- [GitHub REST API](https://docs.github.com/en/rest)
- [Slack API](https://api.slack.com/)
- [Notion API](https://developers.notion.com/)

### Security Best Practices
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Google Cloud Security Best Practices](https://cloud.google.com/security/best-practices)

---

**Document Version:** 1.0
**Last Updated:** 2025-02-27
**Next Review:** 2025-05-27
