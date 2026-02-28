import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  copyToClipboard,
  formatContentForCopy,
  extractImageFromClipboard,
  readImageFromClipboard,
  isClipboardImageSupported,
  getImagePasteErrorMessage,
  ImagePasteError,
  SUPPORTED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} from "../clipboard";

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

  describe("isClipboardImageSupported", () => {
    it("should return true when clipboard.read is available", () => {
      Object.assign(navigator, {
        clipboard: { read: vi.fn() },
      });

      expect(isClipboardImageSupported()).toBe(true);
    });

    it("should return false when clipboard is undefined", () => {
      Object.assign(navigator, { clipboard: undefined });

      expect(isClipboardImageSupported()).toBe(false);
    });

    it("should return false when clipboard.read is undefined", () => {
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn() },
      });

      expect(isClipboardImageSupported()).toBe(false);
    });
  });

  describe("extractImageFromClipboard", () => {
    const createMockClipboardEvent = (
      items: Array<{ kind: string; type: string; data?: Blob }>
    ): ClipboardEvent => {
      const clipboardItems: DataTransferItem[] = items.map((item) => ({
        kind: item.kind,
        type: item.type,
        getAsFile: vi.fn().mockReturnValue(
          item.data
            ? new File([item.data], `test.${item.type.split("/")[1]}`, {
                type: item.type,
              })
            : null
        ),
        getAsString: vi.fn(),
        webkitGetAsEntry: vi.fn(),
      })) as unknown as DataTransferItem[];

      return {
        clipboardData: {
          items: clipboardItems as unknown as DataTransferItemList,
          files: [] as unknown as FileList,
          types: items.map((i) => i.type),
          getData: vi.fn(),
          setData: vi.fn(),
          clearData: vi.fn(),
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as ClipboardEvent;
    };

    beforeEach(() => {
      Object.assign(navigator, {
        clipboard: { read: vi.fn() },
      });

      // Mock FileReader
      global.FileReader = class MockFileReader {
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
        onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
        result: string | ArrayBuffer | null = null;

        readAsDataURL(blob: Blob) {
          setTimeout(() => {
            this.result = `data:${blob.type};base64,mockBase64Data`;
            if (this.onload) {
              this.onload({} as ProgressEvent<FileReader>);
            }
          }, 0);
        }
      } as unknown as typeof FileReader;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return API_NOT_SUPPORTED when clipboard API is unavailable", async () => {
      Object.assign(navigator, { clipboard: undefined });

      const event = createMockClipboardEvent([]);
      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.API_NOT_SUPPORTED);
    });

    it("should return NO_IMAGE when no clipboard data items", async () => {
      const event = { clipboardData: null } as unknown as ClipboardEvent;
      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.NO_IMAGE);
    });

    it("should return NO_IMAGE when no image items found", async () => {
      const event = createMockClipboardEvent([
        { kind: "string", type: "text/plain" },
      ]);
      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.NO_IMAGE);
    });

    it("should successfully extract PNG image", async () => {
      const pngBlob = new Blob(["fake-png-data"], { type: "image/png" });
      const event = createMockClipboardEvent([
        { kind: "file", type: "image/png", data: pngBlob },
      ]);

      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(true);
      expect(result.file).toBeDefined();
      expect(result.file?.type).toBe("image/png");
      expect(result.dataUrl).toBeDefined();
      expect(result.dataUrl).toContain("data:image/png;base64");
    });

    it("should successfully extract JPEG image", async () => {
      const jpegBlob = new Blob(["fake-jpeg-data"], { type: "image/jpeg" });
      const event = createMockClipboardEvent([
        { kind: "file", type: "image/jpeg", data: jpegBlob },
      ]);

      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(true);
      expect(result.file?.type).toBe("image/jpeg");
    });

    it("should successfully extract WebP image", async () => {
      const webpBlob = new Blob(["fake-webp-data"], { type: "image/webp" });
      const event = createMockClipboardEvent([
        { kind: "file", type: "image/webp", data: webpBlob },
      ]);

      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(true);
      expect(result.file?.type).toBe("image/webp");
    });

    it("should return UNSUPPORTED_TYPE for unsupported image formats", async () => {
      const gifBlob = new Blob(["fake-gif-data"], { type: "image/gif" });
      const event = createMockClipboardEvent([
        { kind: "file", type: "image/gif", data: gifBlob },
      ]);

      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.UNSUPPORTED_TYPE);
    });

    it("should return TOO_LARGE for images exceeding MAX_IMAGE_SIZE", async () => {
      // Create a blob larger than MAX_IMAGE_SIZE
      const largeData = new Uint8Array(MAX_IMAGE_SIZE + 1);
      const largeBlob = new Blob([largeData], { type: "image/png" });
      const event = createMockClipboardEvent([
        { kind: "file", type: "image/png", data: largeBlob },
      ]);

      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.TOO_LARGE);
    });

    it("should return READ_ERROR when getAsFile returns null", async () => {
      const event = createMockClipboardEvent([
        { kind: "file", type: "image/png" }, // No data, will return null
      ]);
      // Override getAsFile to return null
      const item = event.clipboardData!.items[0];
      vi.mocked(item.getAsFile).mockReturnValue(null);

      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.READ_ERROR);
    });

    it("should handle FileReader errors gracefully", async () => {
      const pngBlob = new Blob(["fake-png-data"], { type: "image/png" });
      const event = createMockClipboardEvent([
        { kind: "file", type: "image/png", data: pngBlob },
      ]);

      // Mock FileReader to simulate error
      global.FileReader = class MockFileReader {
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
        onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
        result: string | ArrayBuffer | null = null;

        readAsDataURL() {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror({} as ProgressEvent<FileReader>);
            }
          }, 0);
        }
      } as unknown as typeof FileReader;

      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.READ_ERROR);
    });

    it("should prioritize first image when multiple images in clipboard", async () => {
      const png1 = new Blob(["png-1"], { type: "image/png" });
      const png2 = new Blob(["png-2"], { type: "image/png" });
      const event = createMockClipboardEvent([
        { kind: "file", type: "image/png", data: png1 },
        { kind: "file", type: "image/png", data: png2 },
      ]);

      const result = await extractImageFromClipboard(event);

      expect(result.success).toBe(true);
      // Should use first image
      expect(event.clipboardData!.items[0].getAsFile).toHaveBeenCalled();
    });
  });

  describe("readImageFromClipboard", () => {
    const createMockClipboardItem = (type: string, data: Blob) => ({
      types: [type],
      getType: vi.fn().mockResolvedValue(data),
    });

    beforeEach(() => {
      // Mock FileReader
      global.FileReader = class MockFileReader {
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
        onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
        result: string | ArrayBuffer | null = null;

        readAsDataURL(blob: Blob) {
          setTimeout(() => {
            this.result = `data:${blob.type};base64,mockBase64Data`;
            if (this.onload) {
              this.onload({} as ProgressEvent<FileReader>);
            }
          }, 0);
        }
      } as unknown as typeof FileReader;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return API_NOT_SUPPORTED when clipboard.read is unavailable", async () => {
      Object.assign(navigator, { clipboard: undefined });

      const result = await readImageFromClipboard();

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.API_NOT_SUPPORTED);
    });

    it("should successfully read PNG from clipboard", async () => {
      const pngBlob = new Blob(["fake-png-data"], { type: "image/png" });
      const clipboardItem = createMockClipboardItem("image/png", pngBlob);

      Object.assign(navigator, {
        clipboard: {
          read: vi.fn().mockResolvedValue([clipboardItem]),
        },
      });

      const result = await readImageFromClipboard();

      expect(result.success).toBe(true);
      expect(result.file).toBeDefined();
      expect(result.file?.type).toBe("image/png");
      expect(result.dataUrl).toContain("data:image/png;base64");
    });

    it("should successfully read JPEG from clipboard", async () => {
      const jpegBlob = new Blob(["fake-jpeg-data"], { type: "image/jpeg" });
      const clipboardItem = createMockClipboardItem("image/jpeg", jpegBlob);

      Object.assign(navigator, {
        clipboard: {
          read: vi.fn().mockResolvedValue([clipboardItem]),
        },
      });

      const result = await readImageFromClipboard();

      expect(result.success).toBe(true);
      expect(result.file?.type).toBe("image/jpeg");
    });

    it("should successfully read WebP from clipboard", async () => {
      const webpBlob = new Blob(["fake-webp-data"], { type: "image/webp" });
      const clipboardItem = createMockClipboardItem("image/webp", webpBlob);

      Object.assign(navigator, {
        clipboard: {
          read: vi.fn().mockResolvedValue([clipboardItem]),
        },
      });

      const result = await readImageFromClipboard();

      expect(result.success).toBe(true);
      expect(result.file?.type).toBe("image/webp");
    });

    it("should return NO_IMAGE when clipboard has no image", async () => {
      const clipboardItem = {
        types: ["text/plain"],
        getType: vi.fn().mockResolvedValue(new Blob(["text"], { type: "text/plain" })),
      };

      Object.assign(navigator, {
        clipboard: {
          read: vi.fn().mockResolvedValue([clipboardItem]),
        },
      });

      const result = await readImageFromClipboard();

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.NO_IMAGE);
    });

    it("should return TOO_LARGE for oversized images", async () => {
      const largeData = new Uint8Array(MAX_IMAGE_SIZE + 1);
      const largeBlob = new Blob([largeData], { type: "image/png" });
      const clipboardItem = createMockClipboardItem("image/png", largeBlob);

      Object.assign(navigator, {
        clipboard: {
          read: vi.fn().mockResolvedValue([clipboardItem]),
        },
      });

      const result = await readImageFromClipboard();

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.TOO_LARGE);
    });

    it("should return READ_ERROR on clipboard.read failure", async () => {
      Object.assign(navigator, {
        clipboard: {
          read: vi.fn().mockRejectedValue(new Error("Permission denied")),
        },
      });

      const result = await readImageFromClipboard();

      expect(result.success).toBe(false);
      expect(result.error).toBe(ImagePasteError.READ_ERROR);
    });
  });

  describe("getImagePasteErrorMessage", () => {
    it("should return correct message for NO_IMAGE", () => {
      expect(getImagePasteErrorMessage(ImagePasteError.NO_IMAGE)).toBe(
        "클립보드에 이미지가 없습니다"
      );
    });

    it("should return correct message for UNSUPPORTED_TYPE", () => {
      expect(getImagePasteErrorMessage(ImagePasteError.UNSUPPORTED_TYPE)).toContain(
        "지원하지 않는 이미지 형식"
      );
    });

    it("should return correct message for TOO_LARGE", () => {
      const message = getImagePasteErrorMessage(ImagePasteError.TOO_LARGE);
      expect(message).toContain("이미지 크기가 너무 큽니다");
      expect(message).toContain("10MB");
    });

    it("should return correct message for READ_ERROR", () => {
      expect(getImagePasteErrorMessage(ImagePasteError.READ_ERROR)).toContain(
        "이미지를 읽는 중 오류"
      );
    });

    it("should return correct message for API_NOT_SUPPORTED", () => {
      expect(getImagePasteErrorMessage(ImagePasteError.API_NOT_SUPPORTED)).toContain(
        "브라우저가 클립보드 이미지를 지원하지 않습니다"
      );
    });
  });

  describe("constants", () => {
    it("should have correct SUPPORTED_IMAGE_TYPES", () => {
      expect(SUPPORTED_IMAGE_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
    });

    it("should have correct MAX_IMAGE_SIZE (10MB)", () => {
      expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
    });
  });
});
