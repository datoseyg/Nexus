import { NextRequest, NextResponse } from "next/server";
import { requireCapability, NexusAuthorizationError } from "@/lib/auth/capabilities";
import { runGovernanceQuery } from "@/lib/governance-db";
import { handleApiError } from "@/lib/api-error";
import { mapRunSummaryRow, toIso } from "../route";
import type { DataRefreshRunDetail, DataRefreshRunStage } from "@/types/data-refresh";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireCapability("data:refresh:observe");
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const responseBody = error.status === 401 ? { error: "Unauthorized", code: "UNAUTHORIZED" } : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(responseBody, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: `ID de corrida inválido: "${id}"`, code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    // Las dos consultas solo dependen de `id`, no una de la otra - se piden
    // en paralelo (si la corrida no existe, stageRows simplemente vendrá
    // vacío y se descarta abajo).
    const [runRows, stageRows] = await Promise.all([
      runGovernanceQuery<Record<string, unknown>>(
        "pipeline_requester",
        `SELECT refresh_run_id, environment, mode, executor_type, status, requested_by_role, requested_at, reason,
                started_at, finished_at, last_heartbeat_at, current_stage, error_code, error_summary, validation_status,
                sources_requested, sources_completed, rows_extracted, rows_loaded, source_snapshot_id
         FROM pipeline.refresh_runs WHERE refresh_run_id = $1`,
        [id]
      ),
      runGovernanceQuery<Record<string, unknown>>(
        "pipeline_requester",
        `SELECT stage_name, status, started_at, finished_at, error_message
         FROM pipeline.refresh_run_stages WHERE refresh_run_id = $1 ORDER BY started_at ASC`,
        [id]
      )
    ]);

    const runRow = runRows[0];
    if (!runRow) {
      return NextResponse.json({ error: `No existe la corrida "${id}".`, code: "NOT_FOUND" }, { status: 404 });
    }

    const stages: DataRefreshRunStage[] = stageRows.map(row => ({
      stageName: String(row.stage_name),
      status: row.status as DataRefreshRunStage["status"],
      startedAt: toIso(row.started_at) as string,
      finishedAt: toIso(row.finished_at),
      errorMessage: (row.error_message as string) ?? null
    }));

    const detail: DataRefreshRunDetail = {
      ...mapRunSummaryRow(runRow),
      reason: (runRow.reason as string) ?? null,
      sourcesRequested: (runRow.sources_requested as string[]) ?? null,
      sourcesCompleted: (runRow.sources_completed as string[]) ?? null,
      rowsExtracted: (runRow.rows_extracted as number) ?? null,
      rowsLoaded: (runRow.rows_loaded as number) ?? null,
      sourceSnapshotId: (runRow.source_snapshot_id as string) ?? null,
      stages
    };

    return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
