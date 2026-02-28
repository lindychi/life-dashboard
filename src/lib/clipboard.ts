/**
 * Format content for clipboard copy
 * Strips emoji prefixes and delegation arrows while preserving the actual content
 */
export function formatContentForCopy(content: string): string {
  if (!content) return "";

  let result = content;

  // Strip leading emoji characters (common status emojis used in history)
  result = result.replace(/^[📋📨✅❌🔄🧠📊🏁⚠️📡🔌🚀💬🔑⏱️🎯]\s*/u, "");

  // Strip delegation arrow patterns: "AgentName → AgentName: "
  result = result.replace(/^\S+\s*→\s*\S+:\s*/, "");

  // Strip quoted delegation content pattern
  result = result.replace(/^[""](.+)[""]$/, "$1");

  return result.trim();
}

/**
 * Copy text content to clipboard
 * Returns true on success, false on failure
 */
export async function copyToClipboard(content: string): Promise<boolean> {
  const formatted = formatContentForCopy(content);

  try {
    if (!navigator?.clipboard?.writeText) {
      return false;
    }
    await navigator.clipboard.writeText(formatted);
    return true;
  } catch {
    return false;
  }
}

/**
 * Supported image MIME types for clipboard paste
 */
export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

/**
 * Maximum image size in bytes (10MB)
 */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/**
 * Error types for image paste operations
 */
export enum ImagePasteError {
  NO_IMAGE = "NO_IMAGE",
  UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE",
  TOO_LARGE = "TOO_LARGE",
  READ_ERROR = "READ_ERROR",
  API_NOT_SUPPORTED = "API_NOT_SUPPORTED",
}

/**
 * Result of image paste operation
 */
export interface ImagePasteResult {
  success: boolean;
  error?: ImagePasteError;
  file?: File;
  dataUrl?: string;
}

/**
 * Check if the browser supports clipboard image paste
 */
export function isClipboardImageSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    typeof navigator.clipboard.read === "function"
  );
}

/**
 * Validate image file size
 */
function validateImageSize(file: File): boolean {
  return file.size <= MAX_IMAGE_SIZE;
}

/**
 * Validate image MIME type
 */
function validateImageType(type: string): type is SupportedImageType {
  return SUPPORTED_IMAGE_TYPES.includes(type as SupportedImageType);
}

/**
 * Convert File to data URL for preview
 */
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Extract image from clipboard paste event
 * Supports PNG, JPEG, and WebP formats
 *
 * @returns ImagePasteResult with success status, optional file, and dataUrl
 */
export async function extractImageFromClipboard(
  event: ClipboardEvent
): Promise<ImagePasteResult> {
  // Check clipboard API support
  if (!isClipboardImageSupported()) {
    return { success: false, error: ImagePasteError.API_NOT_SUPPORTED };
  }

  try {
    const items = event.clipboardData?.items;

    if (!items) {
      return { success: false, error: ImagePasteError.NO_IMAGE };
    }

    // Find the first image item
    let imageItem: DataTransferItem | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        imageItem = item;
        break;
      }
    }

    if (!imageItem) {
      return { success: false, error: ImagePasteError.NO_IMAGE };
    }

    // Validate image type
    if (!validateImageType(imageItem.type)) {
      return { success: false, error: ImagePasteError.UNSUPPORTED_TYPE };
    }

    // Get file from clipboard item
    const file = imageItem.getAsFile();
    if (!file) {
      return { success: false, error: ImagePasteError.READ_ERROR };
    }

    // Validate file size
    if (!validateImageSize(file)) {
      return { success: false, error: ImagePasteError.TOO_LARGE };
    }

    // Convert to data URL for preview
    const dataUrl = await fileToDataUrl(file);

    return { success: true, file, dataUrl };
  } catch (error) {
    console.error("Image extraction error:", error);
    return { success: false, error: ImagePasteError.READ_ERROR };
  }
}

/**
 * Alternative method using Clipboard API (for programmatic access)
 * Note: Requires user permission
 */
export async function readImageFromClipboard(): Promise<ImagePasteResult> {
  if (!isClipboardImageSupported()) {
    return { success: false, error: ImagePasteError.API_NOT_SUPPORTED };
  }

  try {
    const clipboardItems = await navigator.clipboard.read();

    for (const item of clipboardItems) {
      // Find image type
      const imageType = item.types.find((type) =>
        SUPPORTED_IMAGE_TYPES.includes(type as SupportedImageType)
      );

      if (imageType && validateImageType(imageType)) {
        const blob = await item.getType(imageType);

        // Validate size
        if (!validateImageSize(blob as File)) {
          return { success: false, error: ImagePasteError.TOO_LARGE };
        }

        // Create File from Blob
        const file = new File([blob], `clipboard-image.${imageType.split("/")[1]}`, {
          type: imageType,
        });

        // Convert to data URL
        const dataUrl = await fileToDataUrl(file);

        return { success: true, file, dataUrl };
      }
    }

    return { success: false, error: ImagePasteError.NO_IMAGE };
  } catch (error) {
    console.error("Clipboard read error:", error);
    return { success: false, error: ImagePasteError.READ_ERROR };
  }
}

/**
 * Get human-readable error message for ImagePasteError
 */
export function getImagePasteErrorMessage(error: ImagePasteError): string {
  switch (error) {
    case ImagePasteError.NO_IMAGE:
      return "클립보드에 이미지가 없습니다";
    case ImagePasteError.UNSUPPORTED_TYPE:
      return "지원하지 않는 이미지 형식입니다 (PNG, JPEG, WebP만 지원)";
    case ImagePasteError.TOO_LARGE:
      return `이미지 크기가 너무 큽니다 (최대 ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`;
    case ImagePasteError.READ_ERROR:
      return "이미지를 읽는 중 오류가 발생했습니다";
    case ImagePasteError.API_NOT_SUPPORTED:
      return "브라우저가 클립보드 이미지를 지원하지 않습니다";
    default:
      return "알 수 없는 오류가 발생했습니다";
  }
}
