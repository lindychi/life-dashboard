"use client";

import React, { useState, useRef, useCallback } from "react";

// 10MB default — matches server-side UPLOAD_MAX_SIZE
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

const ACCEPTED_TYPES: Record<string, string> = {
  // Images
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
  // Documents
  "application/pdf": "PDF",
  "text/plain": "TXT",
  "text/csv": "CSV",
  "text/markdown": "MD",
  "application/json": "JSON",
  // Archives
  "application/zip": "ZIP",
};

// Accept attribute for file input
const ACCEPT_STRING = Object.keys(ACCEPTED_TYPES).join(",");

export interface AttachedFile {
  file: File;
  id: string; // client-side ID for tracking
  preview?: string; // data URL for image previews
}

export interface UploadedAttachment {
  refKey: string;
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
}

interface FileAttachmentProps {
  attachedFiles: AttachedFile[];
  onFilesChange: (files: AttachedFile[]) => void;
  maxFileSize?: number;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "\u{1F5BC}\uFE0F";
  if (mimeType === "application/pdf") return "\u{1F4C4}";
  if (mimeType.startsWith("text/")) return "\u{1F4DD}";
  if (mimeType === "application/json") return "\u{1F4CB}";
  if (mimeType === "application/zip") return "\u{1F4E6}";
  return "\u{1F4CE}";
}

export default function FileAttachment({
  attachedFiles,
  onFilesChange,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  disabled = false,
}: FileAttachmentProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const errors: string[] = [];
      const validFiles: AttachedFile[] = [];

      for (const file of files) {
        // Size check
        if (file.size > maxFileSize) {
          errors.push(
            `${file.name}: ${formatFileSize(maxFileSize)} 초과 (${formatFileSize(file.size)})`
          );
          continue;
        }

        // Type check (warn but allow)
        if (!ACCEPTED_TYPES[file.type]) {
          // Allow unknown types but show a note
        }

        const attached: AttachedFile = {
          file,
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        };

        // Generate preview for images
        if (file.type.startsWith("image/") && file.size < 5 * 1024 * 1024) {
          const reader = new FileReader();
          reader.onload = (e) => {
            attached.preview = e.target?.result as string;
            // Trigger re-render by updating with new array
            onFilesChange([...attachedFiles, ...validFiles]);
          };
          reader.readAsDataURL(file);
        }

        validFiles.push(attached);
      }

      if (errors.length > 0) {
        setError(errors.join("\n"));
        setTimeout(() => setError(null), 5000);
      }

      if (validFiles.length > 0) {
        onFilesChange([...attachedFiles, ...validFiles]);
      }
    },
    [attachedFiles, maxFileSize, onFilesChange]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (disabled) return;

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        validateAndAddFiles(e.dataTransfer.files);
      }
    },
    [disabled, validateAndAddFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        validateAndAddFiles(e.target.files);
      }
      // Reset input so same file can be selected again
      e.target.value = "";
    },
    [validateAndAddFiles]
  );

  const handleRemoveFile = useCallback(
    (fileId: string) => {
      onFilesChange(attachedFiles.filter((f) => f.id !== fileId));
    },
    [attachedFiles, onFilesChange]
  );

  return (
    <div className="space-y-2">
      {/* Drop zone & file select button */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`
          relative cursor-pointer rounded-lg border-2 border-dashed px-3 py-2 text-center text-sm transition-colors
          ${isDragOver
            ? "border-blue-500 bg-blue-500/10 text-blue-300"
            : "border-gray-600 text-gray-500 hover:border-gray-500 hover:text-gray-400"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_STRING}
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />
        <div className="flex items-center justify-center gap-2">
          <span>{"\u{1F4CE}"}</span>
          <span>
            {isDragOver
              ? "여기에 놓으세요"
              : "파일 첨부 (드래그 또는 클릭)"}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          이미지, PDF, 텍스트, JSON, CSV · 최대 {formatFileSize(maxFileSize)}
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
          <span className="shrink-0 mt-0.5">{"\u26A0\uFE0F"}</span>
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {/* Attached files list */}
      {attachedFiles.length > 0 && (
        <div className="space-y-1">
          {attachedFiles.map((attached) => (
            <div
              key={attached.id}
              className="flex items-center gap-2 rounded-lg bg-gray-700/50 px-3 py-1.5 text-sm group"
            >
              {/* Image preview or file icon */}
              {attached.preview ? (
                <img
                  src={attached.preview}
                  alt={attached.file.name}
                  className="w-6 h-6 rounded object-cover"
                />
              ) : (
                <span className="text-base shrink-0">
                  {getFileIcon(attached.file.type)}
                </span>
              )}

              {/* File info */}
              <span className="text-gray-200 truncate flex-1 min-w-0">
                {attached.file.name}
              </span>
              <span className="text-gray-500 text-xs shrink-0">
                {formatFileSize(attached.file.size)}
              </span>

              {/* Remove button */}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFile(attached.id);
                  }}
                  className="text-gray-500 hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title="파일 제거"
                >
                  {"\u2715"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Upload attached files to the server and return ref_keys.
 * Used by the parent component before sending the orchestrate command.
 */
export async function uploadFiles(
  files: AttachedFile[],
  onProgress?: (index: number, total: number) => void
): Promise<UploadedAttachment[]> {
  const results: UploadedAttachment[] = [];

  for (let i = 0; i < files.length; i++) {
    onProgress?.(i, files.length);

    const formData = new FormData();
    formData.append("file", files[i].file);

    const res = await fetch("/api/attachments", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        data.error || `파일 업로드 실패: ${files[i].file.name} (${res.status})`
      );
    }

    const data = await res.json();
    results.push({
      refKey: data.attachment.refKey,
      originalFilename: data.attachment.originalFilename,
      sizeBytes: data.attachment.sizeBytes,
      mimeType: data.attachment.mimeType,
    });
  }

  onProgress?.(files.length, files.length);
  return results;
}
