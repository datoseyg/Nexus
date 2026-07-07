import { type Env, jsonResponse, errorResponse } from "./_shared";

// Mismo orden/lista que cloud/d1/schema.sql y TABLES en
// src/cloud/export-d1-seed.js - mantener sincronizado si se agrega/quita
// una tabla en alguno de los dos lados.
const D1_TABLES = [
  "gold_operational_dashboard",
  "gold_fieldbeat_report_analysis",
  "gold_fieldbeat_data_quality",
  "gold_client_report_volume_by_period",
  "gold_client_parts_consumption",
  "gold_equipment_parts_consumption",
  "gold_after_hours_work_analysis",
  "gold_after_hours_by_client",
  "gold_after_hours_by_period",
  "gold_scope_metadata",
  "marts_used_parts_dolibarr_match",
  "marts_fieldbeat_report_dolibarr_operational_view",
  "marts_fieldbeat_working_hours_analysis",
  "curation_placeholder_rules",
  "curation_part_identity_aliases",
  "rules_client_contracts",
  "rules_part_manufacturer_life"
];

// GET /api/d1/table-counts - diagnóstico de post-deploy: cuántas filas
// llegaron a cada tabla D1 después de aplicar schema.sql + seeds/*.sql con
// wrangler. Usa `DB.batch()` (un solo round-trip para las 17 tablas) en vez
// de 17 llamadas `.all()` sueltas - ver docs/CLOUDFLARE_D1_MIGRATION.md.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const statements = D1_TABLES.map(table => context.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`));
    const results = await context.env.DB.batch<{ n: number }>(statements);

    const counts = D1_TABLES.map((table, i) => ({
      table,
      rows: results[i]?.results?.[0]?.n ?? 0
    }));

    return jsonResponse({ counts });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
