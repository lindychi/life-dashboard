"use client";

/**
 * Shared LiveOutput rendering logic used by AgentSection and LiveMonitor.
 *
 * Handles two data shapes:
 *   1. Structured recentEvents array (preferred)
 *   2. Fallback lastChunk plain-text lines
 */

export interface LiveEvent {
  type: "tool_use" | "text" | "health" | "warning" | "stderr";
  timestamp: string;
  tool?: string;
  target?: string;
  content?: string;
}

interface LiveOutputRendererProps {
  /** Structured events (newest first). When present, used in preference to lastChunk. */
  recentEvents?: LiveEvent[];
  /** Raw text fallback; newline-delimited lines. */
  lastChunk?: string;
  /**
   * Maximum number of events/lines to show.
   * @default 8
   */
  maxItems?: number;
  /**
   * Maximum characters to show for text events.
   * @default 300
   */
  maxTextChars?: number;
}

/**
 * Render a single fallback text line with colour coding based on prefix/emoji.
 */
function FallbackLine({ line }: { line: string }) {
  const isToolLine =
    /^[📖✏️🔧🔍📂💻📝🚀🌐🔎🔌]/.test(line) || line.startsWith("[tool]");
  const isTextLine = line.startsWith("[text] ");
  const isHealthLine = line.startsWith("[health]") || line.startsWith("[warning]");
  const isRetryLine = line.startsWith("[retry]");

  if (isToolLine) {
    const content = line.replace(/^\[tool\]\s*/, "");
    const colonIdx = content.indexOf(":");
    const toolPart = colonIdx > 0 ? content.slice(0, colonIdx) : content;
    const detailPart = colonIdx > 0 ? content.slice(colonIdx + 1).trim() : "";
    return (
      <div className="flex items-baseline gap-1.5 py-0.5 text-blue-300">
        <span className="flex-shrink-0">{toolPart}</span>
        {detailPart && (
          <>
            <span className="text-gray-600">:</span>
            <span className="text-gray-400 truncate">{detailPart}</span>
          </>
        )}
      </div>
    );
  }
  if (isTextLine) {
    return (
      <div className="text-green-400 py-0.5 whitespace-pre-wrap break-words">
        {line.slice(7, 307)}
      </div>
    );
  }
  if (isHealthLine) {
    return (
      <div className="text-yellow-600 py-0.5 opacity-60">
        {line}
      </div>
    );
  }
  if (isRetryLine) {
    return (
      <div className="text-orange-400 py-0.5">
        {line}
      </div>
    );
  }
  return (
    <div className="text-green-400 py-0.5 whitespace-pre-wrap break-words">
      {line}
    </div>
  );
}

export default function LiveOutputRenderer({
  recentEvents,
  lastChunk = "",
  maxItems = 8,
  maxTextChars = 300,
}: LiveOutputRendererProps) {
  if (recentEvents && recentEvents.length > 0) {
    // Data arrives newest-first; reverse for chronological display, then take last maxItems
    const events = [...recentEvents].reverse().slice(-maxItems);
    return (
      <>
        {events.map((evt, i) => {
          if (evt.type === "tool_use") {
            return (
              <div key={i} className="flex items-baseline gap-1.5 py-0.5 text-blue-300">
                <span className="flex-shrink-0 text-blue-400">🔧 {evt.tool || "tool"}</span>
                {evt.target && (
                  <>
                    <span className="text-gray-600">→</span>
                    <span className="text-gray-400 truncate">{evt.target}</span>
                  </>
                )}
                {evt.content && !evt.tool && (
                  <span className="text-gray-400 truncate">{evt.content}</span>
                )}
              </div>
            );
          }
          if (evt.type === "text") {
            const text = (evt.content || "").slice(0, maxTextChars);
            return (
              <div key={i} className="text-green-400 py-0.5 whitespace-pre-wrap break-words">
                {text}
                {(evt.content || "").length > maxTextChars && (
                  <span className="text-gray-600">…</span>
                )}
              </div>
            );
          }
          if (evt.type === "warning" || evt.type === "health") {
            return (
              <div key={i} className="text-yellow-600 py-0.5 opacity-60">
                ⚠️ {evt.content}
              </div>
            );
          }
          if (evt.type === "stderr") {
            return (
              <div key={i} className="text-gray-500 py-0.5 opacity-50 text-[10px]">
                {evt.content}
              </div>
            );
          }
          return null;
        })}
      </>
    );
  }

  // Fallback: parse lastChunk lines
  const lines = lastChunk.split("\n").filter(Boolean).slice(-maxItems);
  return (
    <>
      {lines.map((line, i) => (
        <FallbackLine key={i} line={line} />
      ))}
    </>
  );
}
