import * as fs from "fs/promises";
import * as path from "path";

interface UploadAttachmentOptions {
  dashboardUrl: string;
  relayApiKey: string;
  filePath: string;
  refKey?: string;
}

interface SendMessageWithAttachmentsOptions {
  dashboardUrl: string;
  relayApiKey: string;
  from: string;
  to: string;
  content: string;
  type: string;
  attachments?: Array<{ filePath: string; refKey?: string }>;
}

export async function uploadAttachment(options: UploadAttachmentOptions): Promise<{ refKey: string; attachment: unknown }> {
  const { dashboardUrl, relayApiKey, filePath, refKey } = options;
  const buffer = await fs.readFile(filePath);
  const filename = path.basename(filePath);

  const formData = new FormData();
  const blob = new Blob([buffer]);
  formData.append("file", blob, filename);
  if (refKey) {
    formData.append("refKey", refKey);
  }

  const response = await fetch(`${dashboardUrl}/api/attachments`, {
    method: "POST",
    headers: {
      "x-relay-key": relayApiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { attachment?: { refKey?: string } };
  const attachmentRefKey = data.attachment?.refKey;
  if (!attachmentRefKey) {
    throw new Error("Attachment upload did not return refKey");
  }

  return { refKey: attachmentRefKey, attachment: data.attachment };
}

export async function sendMessageWithAttachments(
  options: SendMessageWithAttachmentsOptions
): Promise<unknown> {
  const {
    dashboardUrl,
    relayApiKey,
    from,
    to,
    content,
    type,
    attachments,
  } = options;

  let finalContent = content;

  if (attachments && attachments.length > 0) {
    const refs: string[] = [];
    for (const attachment of attachments) {
      const result = await uploadAttachment({
        dashboardUrl,
        relayApiKey,
        filePath: attachment.filePath,
        refKey: attachment.refKey,
      });
      refs.push(result.refKey);
    }

    if (refs.length > 0) {
      finalContent = `${finalContent}\n\n${refs.map((ref) => `@file:${ref}`).join("\n")}`;
    }
  }

  const response = await fetch(`${dashboardUrl}/api/relay/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-relay-key": relayApiKey,
    },
    body: JSON.stringify({ from, to, content: finalContent, type }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}
