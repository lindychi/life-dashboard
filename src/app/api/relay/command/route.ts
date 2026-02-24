import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  queueCommand,
  getConnectedGateways,
  validateRelayKey,
  isDbAvailable,
  queueInstruction,
  isAgentBusy,
  linkAttachmentsToCommand,
} from "@/lib/relay";
import { isDbConnectionError } from "@/lib/db";
import { saveAttachment, getAttachmentByRefKey } from "@/lib/attachments";
import type { RelayCommandType } from "@/lib/types";

// Dashboard에서 Gateway로 명령 전송 (supports both user session and relay key auth)
export async function POST(request: NextRequest) {
  // 인증 체크: relay key 또는 user session
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { gatewayId, type, payload, queue, attachments } = await request.json() as {
      gatewayId?: string;
      type?: string;
      payload?: Record<string, unknown>;
      queue?: boolean;
      attachments?: Array<{ refKey: string }>;
    };

    // gatewayId 없으면 첫 번째 연결된 gateway 사용
    let targetGateway = gatewayId;
    if (!targetGateway) {
      const gateways = (await getConnectedGateways()).filter(
        (g) => g.status === "connected"
      );
      // If no connected gateways and DB is down, use default gateway
      if (gateways.length === 0) {
        if (!isDbAvailable()) {
          targetGateway = "default";
        } else {
          return NextResponse.json(
            { error: "No connected gateway" },
            { status: 400 }
          );
        }
      } else {
        targetGateway = gateways[0].id;
      }
    }

    if (!type || !payload) {
      return NextResponse.json(
        { error: "type and payload required" },
        { status: 400 }
      );
    }

    // Check if we should queue this instruction instead of sending immediately
    const shouldQueue =
      queue === true ||
      ((type === "orchestrate" || type === "spawn") &&
        payload.agentId &&
        (await isAgentBusy(targetGateway as string, payload.agentId as string)));

    const instruction =
      (payload.instruction as string | undefined) ||
      (payload.task as string | undefined);

    if (shouldQueue && payload.agentId && instruction) {
      // Queue instruction for later execution
      const { id, position } = await queueInstruction(
        targetGateway as string,
        payload.agentId as string,
        instruction,
        payload.metadata as Record<string, unknown> | undefined
      );

      return NextResponse.json({
        success: true,
        queued: true,
        position,
        instructionId: id,
      });
    }

    // Resolve attachment ref_keys and inject @file: references into task/instruction content
    let finalPayload = { ...payload };
    const attachmentIds: string[] = [];

    if (attachments && attachments.length > 0) {
      const refKeyRefs: string[] = [];
      for (const att of attachments) {
        const attachment = await getAttachmentByRefKey(att.refKey);
        if (attachment) {
          attachmentIds.push(attachment.id);
          refKeyRefs.push(`@file:${att.refKey}`);
        }
      }

      if (refKeyRefs.length > 0) {
        // Append @file: references to the task or instruction text in the payload
        const contentKey = finalPayload.task ? "task" : finalPayload.instruction ? "instruction" : null;
        if (contentKey && typeof finalPayload[contentKey] === "string") {
          finalPayload = {
            ...finalPayload,
            [contentKey]: `${finalPayload[contentKey]}\n\n첨부파일:\n${refKeyRefs.join("\n")}`,
          };
        }
        // Also store ref_keys in payload metadata for gateway to use
        finalPayload._attachmentRefKeys = refKeyRefs.map((r) => r.replace("@file:", ""));
      }
    }

    // Send command immediately
    const command = await queueCommand(targetGateway as string, { type: type as RelayCommandType, payload: finalPayload });

    // Link attachments to the command in DB (for traceability)
    if (attachmentIds.length > 0) {
      await linkAttachmentsToCommand(command.id, attachmentIds).catch((err) => {
        console.error("Failed to link attachments to command:", err);
      });
    }

    return NextResponse.json({
      success: true,
      command,
      attachments: attachmentIds.length > 0 ? { linked: attachmentIds.length } : undefined,
    });
  } catch (error) {
    console.error("Command error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
