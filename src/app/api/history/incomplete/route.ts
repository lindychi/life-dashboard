import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getIncompleteTasks } from '@/lib/history';
import { isDbConnectionError } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/history/incomplete
 *
 * Find incomplete tasks (task_started without task_completed).
 * This endpoint is optimized with a single SQL query + batch entry retrieval.
 *
 * Query parameters:
 *   - days: Only include tasks started in the last N days (default: 7, max: 365)
 *   - agentId: Filter by specific agent (optional)
 *   - status: Filter by status 'in_progress' | 'abandoned' (optional)
 *   - limit: Max number of task groups to return (default: 50)
 *   - includeEntries: Include detailed entries for each task (default: true)
 *   - entriesPerTask: Max entries per task when included (default: 10, max: 50)
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '7', 10)));
    const agentId = searchParams.get('agentId') || undefined;
    const status = (searchParams.get('status') || undefined) as 'in_progress' | 'abandoned' | undefined;
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '50', 10)));

    // Call optimized library function
    const result = await getIncompleteTasks({
      days,
      agentId,
      status,
      limit,
    });

    return NextResponse.json({
      ...result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        {
          totalCount: 0,
          recentCount: 0,
          abandonedCount: 0,
          byAgent: {},
          tasks: [],
          generatedAt: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
    console.error('Incomplete tasks GET error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
