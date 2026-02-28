/**
 * DELETE /api/okr/projects/[projectId]/objectives/[objectiveId] - Unlink objective from project
 */

import { NextRequest, NextResponse } from "next/server";
import { unlinkProjectFromObjective } from "@/lib/okr";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ projectId: string; objectiveId: string }>;
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { projectId, objectiveId } = await params;
    const unlinked = await unlinkProjectFromObjective(projectId, objectiveId);

    if (!unlinked) {
      return NextResponse.json(
        { error: "Link not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/okr/projects/[projectId]/objectives/[objectiveId] error:", error);
    return NextResponse.json(
      { error: "Failed to unlink objective from project" },
      { status: 500 }
    );
  }
}
