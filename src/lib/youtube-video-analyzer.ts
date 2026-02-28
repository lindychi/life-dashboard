/**
 * YouTube Video Analyzer Workflow
 * Orchestrates researcher agent delegation for video analysis
 */

import { query, queryOne } from "@/lib/db";
import { addConversationMessage, getConversation } from "@/lib/conversations";
import { sendMessage } from "@/lib/messages";
import { updateVideoAnalysis } from "@/lib/youtube-monitor";
import { broadcastSSE } from "@/lib/sse-broadcaster";
import { addHistoryEntry } from "@/lib/history";

export interface VideoAnalysisTask {
  videoId: string;
  youtubeVideoId: string;
  title: string;
  description?: string;
  watchUrl: string;
  conversationId: string;
}

export interface AnalysisResult {
  summary: string;
  keyInsights: string[];
  topics: string[];
  sentiment?: "positive" | "neutral" | "negative";
  duration?: number;
  transcript?: {
    available: boolean;
    language?: string;
    excerpts?: string[];
  };
  metadata: {
    analyzedAt: string;
    model: string;
    tokensUsed?: number;
  };
}

/**
 * Trigger researcher agent to analyze a video
 * This is called by the task queue orchestrator
 */
export async function triggerVideoAnalysis(task: VideoAnalysisTask): Promise<void> {
  const conversation = await getConversation(task.conversationId);
  if (!conversation) {
    throw new Error(`Conversation ${task.conversationId} not found`);
  }

  // Construct detailed analysis prompt
  const analysisPrompt = buildAnalysisPrompt(task);

  try {
    // Send message to researcher agent with analysis request
    await addConversationMessage({
      conversationId: task.conversationId,
      from: "system",
      content: analysisPrompt,
      type: "question",
      metadata: {
        videoId: task.videoId,
        requestType: "full_analysis",
      },
    });

    broadcastSSE({
      type: "youtube:analysis:started",
      data: {
        videoId: task.videoId,
        title: task.title,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await updateVideoAnalysis(task.videoId, "failed", undefined, errorMsg);
    throw error;
  }
}

/**
 * Build detailed analysis prompt for researcher agent
 */
function buildAnalysisPrompt(task: VideoAnalysisTask): string {
  return `
# YouTube Video Analysis Request

Please analyze the following YouTube video and provide comprehensive insights.

## Video Details
- **Title**: ${task.title}
- **URL**: ${task.watchUrl}
- **Description**: ${task.description || "N/A"}

## Analysis Tasks
Please provide:

1. **Summary** (2-3 sentences): Concise overview of the video content
2. **Key Insights** (3-5 bullet points): Most important takeaways or concepts discussed
3. **Topics & Themes**: List of major topics covered (comma-separated tags)
4. **Sentiment Analysis**: Overall tone (positive/neutral/negative) and reasoning
5. **Target Audience**: Who this video is intended for
6. **Actionable Takeaways**: 2-3 concrete actions or learnings for viewers
7. **Related Topics**: 3-5 similar or complementary topics to explore

## Output Format
Please structure your response as follows:

\`\`\`json
{
  "summary": "Brief 2-3 sentence summary",
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|neutral|negative",
  "targetAudience": "Description of intended audience",
  "actionableTakeaways": ["action 1", "action 2"],
  "relatedTopics": ["topic1", "topic2", "topic3"],
  "additionalNotes": "Any other observations or context"
}
\`\`\`

**Important**: Watch the video or review available metadata to provide accurate analysis. If the video is unavailable or transcript cannot be accessed, note this in your response.
`;
}

/**
 * Process completed analysis from researcher agent
 * Called after researcher submits their analysis
 */
export async function processAnalysisResult(
  videoId: string,
  analysisContent: string,
  metadata?: {
    model?: string;
    tokensUsed?: number;
    durationSeconds?: number;
  }
): Promise<AnalysisResult> {
  try {
    // Parse JSON from analysis content
    const jsonMatch = analysisContent.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error("Could not extract JSON from analysis response");
    }

    const parsed = JSON.parse(jsonMatch[1]);

    const result: AnalysisResult = {
      summary: parsed.summary || "",
      keyInsights: parsed.keyInsights || [],
      topics: parsed.topics || [],
      sentiment: parsed.sentiment || "neutral",
      metadata: {
        analyzedAt: new Date().toISOString(),
        model: metadata?.model || "unknown",
        tokensUsed: metadata?.tokensUsed,
      },
    };

    // Store analysis in database
    await updateVideoAnalysis(videoId, "analyzed", result);

    broadcastSSE({
      type: "youtube:video:analyzed",
      data: {
        videoId,
        analysis: result,
      },
    });

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "JSON parsing failed";
    await updateVideoAnalysis(videoId, "failed", undefined, errorMsg);
    throw error;
  }
}

/**
 * Get analysis for a video
 */
export async function getVideoAnalysis(
  videoId: string
): Promise<AnalysisResult | null> {
  const video = await queryOne<{
    analysis_result: string;
    status: string;
  }>(
    `SELECT analysis_result, status FROM youtube_videos WHERE id = $1`,
    [videoId]
  );

  if (!video || !video.analysis_result) {
    return null;
  }

  return JSON.parse(video.analysis_result);
}

/**
 * Get all analyzed videos with insights
 */
export async function getAnalyzedVideos(
  channelId?: string,
  limit: number = 20
): Promise<
  Array<{
    id: string;
    title: string;
    watchUrl: string;
    analysis: AnalysisResult;
    analyzedAt: string;
  }>
> {
  let query_str = `
    SELECT id, title, watch_url, analysis_result, analyzed_at
    FROM youtube_videos
    WHERE status = 'analyzed' AND analysis_result IS NOT NULL
  `;
  const params: any[] = [];

  if (channelId) {
    query_str += ` AND channel_id = $${params.length + 1}`;
    params.push(channelId);
  }

  query_str += ` ORDER BY analyzed_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const videos = await query<any>(query_str, params);

  return videos.map((v) => ({
    id: v.id,
    title: v.title,
    watchUrl: v.watch_url,
    analysis: JSON.parse(v.analysis_result),
    analyzedAt: v.analyzed_at,
  }));
}

/**
 * Generate insights summary across multiple videos
 */
export async function generateChannelInsights(channelId: string): Promise<{
  totalAnalyzed: number;
  commonTopics: Array<{ topic: string; frequency: number }>;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  topSummaries: string[];
}> {
  const analyzedVideos = await getAnalyzedVideos(channelId, 100);

  const topicFrequency: Record<string, number> = {};
  const sentiments: { positive: number; neutral: number; negative: number; [key: string]: number } = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  const summaries: string[] = [];

  for (const video of analyzedVideos) {
    // Collect topics
    for (const topic of video.analysis.topics) {
      topicFrequency[topic] = (topicFrequency[topic] || 0) + 1;
    }

    // Count sentiments
    const sentiment = video.analysis.sentiment || "neutral";
    sentiments[sentiment]++;

    // Collect summaries
    if (video.analysis.summary) {
      summaries.push(video.analysis.summary);
    }
  }

  // Sort topics by frequency
  const commonTopics = Object.entries(topicFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic, frequency]) => ({ topic, frequency }));

  return {
    totalAnalyzed: analyzedVideos.length,
    commonTopics,
    sentimentDistribution: {
      positive: sentiments["positive"] || 0,
      neutral: sentiments["neutral"] || 0,
      negative: sentiments["negative"] || 0,
    },
    topSummaries: summaries.slice(0, 5),
  };
}
