import { type Env, jsonResponse, errorResponse } from "./_shared";

// GET /api/d1/operational-summary - equivalente D1 (agregado, sin filtros
// cruzados) de /api/dashboard/operacional/summary en modo local-duckdb. Ver
// docs/CLOUDFLARE_D1_MIGRATION.md.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const kpis = await context.env.DB.prepare("SELECT * FROM gold_operational_dashboard LIMIT 1").all();

    const estadoGeneral = await context.env.DB
      .prepare("SELECT report_quality_status, report_count FROM gold_fieldbeat_data_quality ORDER BY report_count DESC")
      .all();

    const ticketsCliente = await context.env.DB
      .prepare(
        `SELECT client_name, COUNT(*) AS total,
                SUM(CASE WHEN zendesk_join_status = 'LINKED_TO_ACCESSIBLE_ZENDESK' THEN 1 ELSE 0 END) AS accesibles
         FROM marts_fieldbeat_report_dolibarr_operational_view
         WHERE client_name != ''
         GROUP BY client_name
         ORDER BY total DESC
         LIMIT 15`
      )
      .all();

    return jsonResponse({
      kpis: kpis.results[0] ?? null,
      estadoGeneral: estadoGeneral.results,
      ticketsCliente: ticketsCliente.results
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
