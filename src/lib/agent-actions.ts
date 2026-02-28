/**
 * Shared agent action utilities used across frontend components.
 * Consolidates common patterns like sending replies to agents.
 */

/**
 * Send a reply to an agent via the relay command API and log it as a history entry.
 *
 * @param agentId - Target agent ID
 * @param entryContent - Original message content (truncated to 500 chars for context)
 * @param replyText - User's reply text
 * @param agentDisplayName - Display name of the agent (for history logging)
 */
export async function sendAgentReply(
  agentId: string,
  entryContent: string,
  replyText: string,
  agentDisplayName: string
): Promise<void> {
  const response = await fetch("/api/relay/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "spawn",
      payload: {
        agentId,
        task: `사용자 피드백에 대해 응답하세요.\n\n이전 당신의 메시지:\n${entryContent.slice(0, 500)}\n\n사용자 답신:\n${replyText}`,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  await fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      type: "message_sent",
      content: `💬 사용자 → ${agentDisplayName}: ${replyText}`,
    }),
  });
}
