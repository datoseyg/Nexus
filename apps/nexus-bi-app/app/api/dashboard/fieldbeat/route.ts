import { NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";

// Todas las queries acá son fijas (sin input de usuario) - el único
// propósito de este route es alimentar el Dashboard Operacional
// FieldBeat con las 5 tablas GOLD report-céntricas.
export async function GET() {
  try {
    const kpiRows = await runQuery("SELECT * FROM gold.fieldbeat_report_analysis");

    const dataQuality = await runQuery(
      "SELECT * FROM gold.fieldbeat_data_quality ORDER BY report_count DESC"
    );

    const reportsByClient = await runQuery(`
      SELECT client_name, SUM(total_reports) AS total_reports
      FROM gold.client_report_volume_by_period
      GROUP BY client_name
      ORDER BY total_reports DESC
      LIMIT 10
    `);

    const partsConsumptionByClient = await runQuery(`
      SELECT client_name, SUM(used_parts_count) AS used_parts_count
      FROM gold.client_parts_consumption
      GROUP BY client_name
      ORDER BY used_parts_count DESC
      LIMIT 10
    `);

    const topEquipmentByParts = await runQuery(`
      SELECT equipment_internal_id, used_parts_count
      FROM gold.equipment_parts_consumption
      ORDER BY used_parts_count DESC
      LIMIT 10
    `);

    return NextResponse.json({
      kpis: kpiRows.length > 0 ? serializeRows(kpiRows)[0] : null,
      dataQuality: serializeRows(dataQuality),
      reportsByClient: serializeRows(reportsByClient),
      partsConsumptionByClient: serializeRows(partsConsumptionByClient),
      topEquipmentByParts: serializeRows(topEquipmentByParts)
    });
  } catch (error) {
    return handleApiError(error);
  }
}
