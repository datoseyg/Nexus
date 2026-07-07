import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { createParamPusher, INSIGHTS_SEARCH_COLUMNS } from "@/lib/equipment-lifecycle-filters";
import { buildSearchCondition } from "@/lib/filter-utils";
import type { LifecycleInsightRow } from "@/types/equipment-lifecycle";

// Frases explicativas generadas por reglas (gold.equipment_part_lifecycle_insights)
// para el panel de insights - filtrable por máquina y/o repuesto y por `q`.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const equipment = searchParams.get("equipment") || undefined;
    const dolibarrRef = searchParams.get("dolibarrRef") || undefined;
    const q = searchParams.get("q")?.trim() || undefined;

    const pusher = createParamPusher();
    const conditions: string[] = [];
    if (equipment) conditions.push(`equipment_internal_id = ${pusher.push(equipment)}`);
    if (dolibarrRef) conditions.push(`dolibarr_ref = ${pusher.push(dolibarrRef)}`);
    const searchCondition = buildSearchCondition(q, INSIGHTS_SEARCH_COLUMNS, pusher);
    if (searchCondition) conditions.push(searchCondition);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<LifecycleInsightRow>(
      `SELECT * FROM gold.equipment_part_lifecycle_insights ${whereClause} ORDER BY equipment_internal_id, dolibarr_ref`,
      pusher.params
    );

    return NextResponse.json({ rows });
  } catch (error) {
    return handleApiError(error);
  }
}
