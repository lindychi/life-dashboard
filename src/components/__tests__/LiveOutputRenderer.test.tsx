// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LiveOutputRenderer, { type LiveEvent } from "@/components/LiveOutputRenderer";

describe("LiveOutputRenderer", () => {
  describe("Empty data handling", () => {
    it("renders nothing when both recentEvents and lastChunk are empty", () => {
      const { container } = render(
        <LiveOutputRenderer recentEvents={[]} lastChunk="" />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when recentEvents is undefined and lastChunk is empty string", () => {
      const { container } = render(<LiveOutputRenderer lastChunk="" />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when recentEvents is an empty array with no lastChunk", () => {
      const { container } = render(<LiveOutputRenderer recentEvents={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("recentEvents rendering", () => {
    it("renders tool_use event with tool name", () => {
      const events: LiveEvent[] = [
        { type: "tool_use", timestamp: "t1", tool: "Read", target: "src/index.ts" },
      ];
      render(<LiveOutputRenderer recentEvents={events} />);
      expect(screen.getByText(/Read/)).toBeInTheDocument();
      expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    });

    it("renders tool_use event with arrow separator between tool and target", () => {
      const events: LiveEvent[] = [
        { type: "tool_use", timestamp: "t1", tool: "Write", target: "output.txt" },
      ];
      render(<LiveOutputRenderer recentEvents={events} />);
      expect(screen.getByText("→")).toBeInTheDocument();
    });

    it("renders text event content in green", () => {
      const events: LiveEvent[] = [
        { type: "text", timestamp: "t1", content: "Hello from the agent" },
      ];
      render(<LiveOutputRenderer recentEvents={events} />);
      const el = screen.getByText("Hello from the agent");
      expect(el.className).toContain("text-green-400");
    });

    it("truncates text event content to maxTextChars and shows ellipsis", () => {
      const longContent = "A".repeat(400);
      const events: LiveEvent[] = [
        { type: "text", timestamp: "t1", content: longContent },
      ];
      render(<LiveOutputRenderer recentEvents={events} maxTextChars={300} />);
      // The rendered text should be truncated
      expect(screen.getByText("A".repeat(300))).toBeInTheDocument();
      expect(screen.getByText("…")).toBeInTheDocument();
    });

    it("does not show ellipsis when text event content fits within maxTextChars", () => {
      const events: LiveEvent[] = [
        { type: "text", timestamp: "t1", content: "Short text" },
      ];
      render(<LiveOutputRenderer recentEvents={events} maxTextChars={300} />);
      expect(screen.queryByText("…")).not.toBeInTheDocument();
    });

    it("renders warning event with warning icon prefix", () => {
      const events: LiveEvent[] = [
        { type: "warning", timestamp: "t1", content: "Memory pressure detected" },
      ];
      render(<LiveOutputRenderer recentEvents={events} />);
      expect(screen.getByText(/Memory pressure detected/)).toBeInTheDocument();
      expect(screen.getByText(/⚠️/)).toBeInTheDocument();
    });

    it("renders health event same as warning", () => {
      const events: LiveEvent[] = [
        { type: "health", timestamp: "t1", content: "CPU spike" },
      ];
      render(<LiveOutputRenderer recentEvents={events} />);
      expect(screen.getByText(/CPU spike/)).toBeInTheDocument();
    });

    it("renders stderr event with low opacity style", () => {
      const events: LiveEvent[] = [
        { type: "stderr", timestamp: "t1", content: "stderr output line" },
      ];
      render(<LiveOutputRenderer recentEvents={events} />);
      const el = screen.getByText("stderr output line");
      expect(el.className).toContain("text-gray-500");
    });

    it("respects maxItems and shows only the last N events", () => {
      // events[0] = newest ("Event number 0"), events[11] = oldest ("Event number 11")
      // Component does: [...events].reverse() → [11,10,...,1,0] (oldest-first)
      // then .slice(-maxItems) with maxItems=8 → keeps last 8 = [7,6,5,4,3,2,1,0]
      // So "Event number 0" through "Event number 7" ARE shown,
      // and "Event number 8" through "Event number 11" are NOT shown.
      const events: LiveEvent[] = Array.from({ length: 12 }, (_, i) => ({
        type: "text" as const,
        timestamp: `t${i}`,
        content: `Event number ${i}`,
      }));
      render(<LiveOutputRenderer recentEvents={events} maxItems={8} />);

      // Events 8-11 (oldest) should be hidden after slicing
      expect(screen.queryByText("Event number 8")).not.toBeInTheDocument();
      expect(screen.queryByText("Event number 11")).not.toBeInTheDocument();
      // Events 0-7 (newest) should be visible
      expect(screen.getByText("Event number 0")).toBeInTheDocument();
      expect(screen.getByText("Event number 7")).toBeInTheDocument();
    });

    it("renders multiple events in chronological order (oldest first)", () => {
      // recentEvents arrives newest-first; renderer reverses for display
      const events: LiveEvent[] = [
        { type: "text", timestamp: "t2", content: "Newer event" },
        { type: "text", timestamp: "t1", content: "Older event" },
      ];
      render(<LiveOutputRenderer recentEvents={events} />);
      const items = screen.getAllByText(/event/i);
      // After reverse: older comes first in DOM
      expect(items[0]).toHaveTextContent("Older event");
      expect(items[1]).toHaveTextContent("Newer event");
    });

    it("renders tool_use without target when target is absent", () => {
      const events: LiveEvent[] = [
        { type: "tool_use", timestamp: "t1", tool: "Bash" },
      ];
      render(<LiveOutputRenderer recentEvents={events} />);
      expect(screen.getByText(/Bash/)).toBeInTheDocument();
      expect(screen.queryByText("→")).not.toBeInTheDocument();
    });
  });

  describe("lastChunk fallback rendering", () => {
    it("renders plain text lines from lastChunk when recentEvents is absent", () => {
      render(<LiveOutputRenderer lastChunk={"Line one\nLine two"} />);
      expect(screen.getByText("Line one")).toBeInTheDocument();
      expect(screen.getByText("Line two")).toBeInTheDocument();
    });

    it("renders plain text lines from lastChunk when recentEvents is empty", () => {
      render(<LiveOutputRenderer recentEvents={[]} lastChunk={"Fallback line"} />);
      expect(screen.getByText("Fallback line")).toBeInTheDocument();
    });

    it("applies blue styling for tool lines starting with emoji", () => {
      render(<LiveOutputRenderer lastChunk={"📖 Read: src/file.ts"} />);
      // The inner <span> is a child; the parent <div> carries text-blue-300
      const span = screen.getByText("📖 Read");
      const container = span.closest("div");
      expect(container?.className).toContain("text-blue-300");
    });

    it("applies blue styling for [tool] prefixed lines", () => {
      render(<LiveOutputRenderer lastChunk={"[tool] Write: dest.ts"} />);
      // The tool name span is a child; the wrapping <div> carries text-blue-300
      const span = screen.getByText("Write");
      const container = span.closest("div");
      expect(container?.className).toContain("text-blue-300");
    });

    it("renders [text] prefixed lines with content trimmed of prefix", () => {
      render(<LiveOutputRenderer lastChunk={"[text] Agent says hello"} />);
      expect(screen.getByText("Agent says hello")).toBeInTheDocument();
    });

    it("applies yellow styling for [health] lines", () => {
      render(<LiveOutputRenderer lastChunk={"[health] all good"} />);
      const el = screen.getByText("[health] all good");
      expect(el.className).toContain("text-yellow-600");
    });

    it("applies yellow styling for [warning] lines", () => {
      render(<LiveOutputRenderer lastChunk={"[warning] low memory"} />);
      const el = screen.getByText("[warning] low memory");
      expect(el.className).toContain("text-yellow-600");
    });

    it("applies orange styling for [retry] lines", () => {
      render(<LiveOutputRenderer lastChunk={"[retry] attempt 2"} />);
      const el = screen.getByText("[retry] attempt 2");
      expect(el.className).toContain("text-orange-400");
    });

    it("respects maxItems and shows only last N lines of lastChunk", () => {
      const lines = Array.from({ length: 12 }, (_, i) => `Line ${i}`).join("\n");
      render(<LiveOutputRenderer lastChunk={lines} maxItems={5} />);
      // slice(-5) shows lines 7..11
      expect(screen.queryByText("Line 0")).not.toBeInTheDocument();
      expect(screen.queryByText("Line 6")).not.toBeInTheDocument();
      expect(screen.getByText("Line 7")).toBeInTheDocument();
      expect(screen.getByText("Line 11")).toBeInTheDocument();
    });

    it("ignores empty lines in lastChunk", () => {
      render(<LiveOutputRenderer lastChunk={"Line A\n\nLine B\n"} />);
      expect(screen.getByText("Line A")).toBeInTheDocument();
      expect(screen.getByText("Line B")).toBeInTheDocument();
    });
  });

  describe("recentEvents takes priority over lastChunk", () => {
    it("renders recentEvents and ignores lastChunk when both provided with non-empty events", () => {
      const events: LiveEvent[] = [
        { type: "text", timestamp: "t1", content: "From events" },
      ];
      render(
        <LiveOutputRenderer
          recentEvents={events}
          lastChunk={"From lastChunk"}
        />
      );
      expect(screen.getByText("From events")).toBeInTheDocument();
      expect(screen.queryByText("From lastChunk")).not.toBeInTheDocument();
    });
  });
});
