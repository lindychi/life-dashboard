/**
 * GET /api/okr/projects/[projectId]/objectives - Get objectives linked to project
 * POST /api/okr/projects/[projectId]/objectives - Link objective to project
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getObjectivesByProject,
  linkProjectToObjective,
} from "@/lib/okr";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { projectId } = await params;
    const objectives = await getObjectivesByProject(projectId);
    return NextResponse.json({ objectives });
  } catch (error) {
    console.error("GET /api/okr/projects/[projectId]/objectives error:", error);
    return NextResponse.json(
      { error: "Failed to fetch project objectives" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { projectId } = await params;
    const body: {
      objective_id: string;
      relevant_key_result_ids?: string[];
    } = await request.json();

    if (!body.objective_id) {
      return NextResponse.json(
        { error: "Missing required field: objective_id" },
        { status: 400 }
      );
    }

    const link = await linkProjectToObjective(
      projectId,
      body.objective_id,
      body.relevant_key_result_ids
    );

    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    console.error("POST /api/okr/projects/[projectId]/objectives error:", error);
    return NextResponse.json(
      { error: "Failed to link objective to project" },
      { status: 500 }
    );
  }
}
