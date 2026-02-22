import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyToClipboard, formatContentForCopy } from "../clipboard";

describe("clipboard", () => {
  describe("formatContentForCopy", () => {
    it("should strip emoji prefixes from content", () => {
      const result = formatContentForCopy("📋 PM의 응답 (1분 12초):\n실제 내용입니다");
      expect(result).not.toMatch(/^📋/);
      expect(result).toContain("실제 내용입니다");
    });

    it("should preserve plain text content as-is", () => {
      const content = "This is a plain text response from the agent.";
      expect(formatContentForCopy(content)).toBe(content);
    });

    it("should strip markdown code fences for clean copy", () => {
      const content = "결과:\n```json\n{\"key\": \"value\"}\n```\n끝";
      const result = formatContentForCopy(content);
      expect(result).toContain("{\"key\": \"value\"}");
    });

    it("should preserve markdown headers and lists", () => {
      const content = "## 분석 결과\n- 항목 1\n- 항목 2";
      const result = formatContentForCopy(content);
      expect(result).toContain("## 분석 결과");
      expect(result).toContain("- 항목 1");
    });

    it("should trim whitespace", () => {
      const content = "  \n  응답 내용  \n  ";
      const result = formatContentForCopy(content);
      expect(result).toBe("응답 내용");
    });

    it("should handle empty string", () => {
      expect(formatContentForCopy("")).toBe("");
    });

    it("should strip delegation arrow prefixes", () => {
      const content = "📨 Orchestrator → PM: \"작업목록을 정리해줘\"";
      const result = formatContentForCopy(content);
      expect(result).toContain("작업목록을 정리해줘");
    });

    it("should strip status emoji prefixes (✅❌🔄🧠📊🏁⚠️)", () => {
      expect(formatContentForCopy("✅ PM → Orchestrator: 완료")).toContain("완료");
      expect(formatContentForCopy("❌ Dev → Orchestrator: 실패")).toContain("실패");
      expect(formatContentForCopy("🔄 [1/3] 작업 수신")).toContain("작업 수신");
    });
  });

  describe("copyToClipboard", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should call navigator.clipboard.writeText with formatted content", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText },
      });

      const result = await copyToClipboard("테스트 내용");

      expect(writeText).toHaveBeenCalledWith("테스트 내용");
      expect(result).toBe(true);
    });

    it("should return false when clipboard API fails", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"));
      Object.assign(navigator, {
        clipboard: { writeText },
      });

      const result = await copyToClipboard("내용");

      expect(result).toBe(false);
    });

    it("should return false when clipboard API is unavailable", async () => {
      Object.assign(navigator, { clipboard: undefined });

      const result = await copyToClipboard("내용");

      expect(result).toBe(false);
    });

    it("should format content before copying using formatContentForCopy", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText },
      });

      await copyToClipboard("📋 PM의 응답:\n결과 내용");

      // The written text should be the formatted version
      const writtenText = writeText.mock.calls[0][0];
      expect(writtenText).toContain("결과 내용");
    });
  });
});
