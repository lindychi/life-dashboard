/**
 * Gateway Connector Attachment Logic Tests
 *
 * Since gateway-connector.ts functions are not exported, we test the
 * attachment-related logic patterns by verifying:
 * 1. @file:refKey replacement logic
 * 2. resolveCommandAttachments pattern (sequential download)
 * 3. cleanupAttachmentFiles pattern (temp dir cleanup)
 * 4. Task text injection patterns
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

describe("Gateway Attachment Logic Patterns", () => {
  const ATTACHMENTS_TMP_DIR = path.join(os.tmpdir(), "ld-attachments");

  describe("@file:refKey replacement in task text", () => {
    it("should replace single @file:refKey with local file path", () => {
      let task = "분석해주세요\n\n첨부파일:\n@file:abcd1234";
      const files = [
        { refKey: "abcd1234", filePath: "/tmp/ld-attachments/abcd1234/report.pdf", filename: "report.pdf" },
      ];

      for (const f of files) {
        task = task.replace(new RegExp(`@file:${f.refKey}`, "g"), f.filePath);
      }

      expect(task).toContain("/tmp/ld-attachments/abcd1234/report.pdf");
      expect(task).not.toContain("@file:abcd1234");
    });

    it("should replace multiple @file:refKey references", () => {
      let task = "리뷰해주세요\n@file:ref1aaaa\n@file:ref2bbbb";
      const files = [
        { refKey: "ref1aaaa", filePath: "/tmp/ld-attachments/ref1aaaa/code.ts", filename: "code.ts" },
        { refKey: "ref2bbbb", filePath: "/tmp/ld-attachments/ref2bbbb/spec.md", filename: "spec.md" },
      ];

      for (const f of files) {
        task = task.replace(new RegExp(`@file:${f.refKey}`, "g"), f.filePath);
      }

      expect(task).toContain("/tmp/ld-attachments/ref1aaaa/code.ts");
      expect(task).toContain("/tmp/ld-attachments/ref2bbbb/spec.md");
      expect(task).not.toContain("@file:");
    });

    it("should handle repeated @file:refKey in same text", () => {
      let task = "@file:abcd1234 참조, 그리고 다시 @file:abcd1234 참조";
      const files = [
        { refKey: "abcd1234", filePath: "/tmp/report.pdf", filename: "report.pdf" },
      ];

      for (const f of files) {
        task = task.replace(new RegExp(`@file:${f.refKey}`, "g"), f.filePath);
      }

      expect(task).toBe("/tmp/report.pdf 참조, 그리고 다시 /tmp/report.pdf 참조");
    });
  });

  describe("Task text injection (file list append)", () => {
    it("should append file path summary when not already present", () => {
      let finalTask = "분석해주세요";
      const attachmentFiles = [
        { refKey: "ref1aaaa", filePath: "/tmp/ld-attachments/ref1aaaa/file.txt", filename: "file.txt" },
      ];

      if (attachmentFiles.length > 0) {
        const fileList = attachmentFiles.map((f) => `- ${f.filename}: ${f.filePath}`).join("\n");
        for (const f of attachmentFiles) {
          finalTask = finalTask.replace(new RegExp(`@file:${f.refKey}`, "g"), f.filePath);
        }
        if (!finalTask.includes(attachmentFiles[0].filePath)) {
          finalTask += `\n\n첨부파일 로컬 경로:\n${fileList}`;
        }
      }

      expect(finalTask).toContain("첨부파일 로컬 경로:");
      expect(finalTask).toContain("- file.txt: /tmp/ld-attachments/ref1aaaa/file.txt");
    });

    it("should NOT double-append when path already in text", () => {
      const expectedPath = "/tmp/ld-attachments/ref1aaaa/file.txt";
      let finalTask = `분석해주세요\n@file:ref1aaaa`;
      const attachmentFiles = [
        { refKey: "ref1aaaa", filePath: expectedPath, filename: "file.txt" },
      ];

      for (const f of attachmentFiles) {
        finalTask = finalTask.replace(new RegExp(`@file:${f.refKey}`, "g"), f.filePath);
      }
      // At this point finalTask contains the path from replacement
      if (!finalTask.includes(attachmentFiles[0].filePath)) {
        finalTask += `\n\n첨부파일 로컬 경로:\n- file.txt: ${expectedPath}`;
      }

      // Should only contain the path once (from replacement, not appended again)
      const count = (finalTask.match(new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      expect(count).toBe(1);
    });
  });

  describe("resolveCommandAttachments pattern", () => {
    it("should aggregate results from sequential downloads", async () => {
      // Simulate the resolveCommandAttachments pattern
      const downloadFn = vi.fn()
        .mockResolvedValueOnce({ filePath: "/tmp/a/f1.txt", filename: "f1.txt" })
        .mockResolvedValueOnce(null) // failed download
        .mockResolvedValueOnce({ filePath: "/tmp/c/f3.txt", filename: "f3.txt" });

      const refKeys = ["ref1aaaa", "ref2bbbb", "ref3cccc"];
      const results: Array<{ refKey: string; filePath: string; filename: string }> = [];

      for (const refKey of refKeys) {
        const downloaded = await downloadFn(refKey);
        if (downloaded) {
          results.push({ refKey, ...downloaded });
        }
      }

      expect(results).toHaveLength(2);
      expect(results[0].refKey).toBe("ref1aaaa");
      expect(results[1].refKey).toBe("ref3cccc");
    });

    it("should handle all downloads failing", async () => {
      const downloadFn = vi.fn().mockResolvedValue(null);

      const refKeys = ["ref1aaaa", "ref2bbbb"];
      const results: Array<{ refKey: string; filePath: string; filename: string }> = [];

      for (const refKey of refKeys) {
        const downloaded = await downloadFn(refKey);
        if (downloaded) {
          results.push({ refKey, ...downloaded });
        }
      }

      expect(results).toHaveLength(0);
    });
  });

  describe("cleanupAttachmentFiles pattern", () => {
    it("should construct correct temp directory paths for cleanup", () => {
      const refKeys = ["ref1aaaa", "ref2bbbb"];
      const paths: string[] = [];

      for (const refKey of refKeys) {
        paths.push(path.join(ATTACHMENTS_TMP_DIR, refKey));
      }

      expect(paths[0]).toBe(path.join(os.tmpdir(), "ld-attachments", "ref1aaaa"));
      expect(paths[1]).toBe(path.join(os.tmpdir(), "ld-attachments", "ref2bbbb"));
    });
  });

  describe("Spawn command attachment flow", () => {
    it("should handle spawn command with _attachmentRefKeys", () => {
      const command = {
        type: "spawn",
        payload: {
          agentId: "qa",
          task: "분석해주세요\n\n첨부파일:\n@file:abcd1234",
          _attachmentRefKeys: ["abcd1234"],
        },
      };

      const { agentId, task, _attachmentRefKeys } = command.payload as {
        agentId: string;
        task: string;
        _attachmentRefKeys?: string[];
      };

      expect(agentId).toBe("qa");
      expect(_attachmentRefKeys).toEqual(["abcd1234"]);
      expect(task).toContain("@file:abcd1234");
    });

    it("should handle spawn command without attachments", () => {
      const command = {
        type: "spawn",
        payload: {
          agentId: "qa",
          task: "run tests",
        },
      };

      const { _attachmentRefKeys } = command.payload as {
        _attachmentRefKeys?: string[];
      };

      expect(_attachmentRefKeys).toBeUndefined();
    });
  });

  describe("Orchestrate command attachment flow", () => {
    it("should handle orchestrate command with _attachmentRefKeys", () => {
      const command = {
        type: "orchestrate",
        payload: {
          task: "이 스펙대로 구현\n\n첨부파일:\n@file:spec1234",
          _attachmentRefKeys: ["spec1234"],
        },
      };

      const { task, _attachmentRefKeys: orchAttRefKeys } = command.payload as {
        task: string;
        _attachmentRefKeys?: string[];
      };

      expect(orchAttRefKeys).toEqual(["spec1234"]);
      expect(task).toContain("@file:spec1234");
    });
  });
});
