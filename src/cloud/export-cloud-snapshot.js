import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "../db/warehouse-config.js";
import { sanitizeValue } from "./sanitize-cloud-export.js";

// Exporta un snapshot JSON estático y sanitizado del warehouse DuckDB local
// para el modo NEXT_PUBLIC_DATA_MODE=static (demo read-only en Cloudflare
// Pages) - ver docs/CLOUD_SMOKE_TEST.md. Solo LEE data/warehouse/eyg_nexus.duckdb
// (READ_ONLY), nunca la modifica. Es un subconjunto deliberadamente
// simplificado de lo que exponen los Route Handlers reales (sin filtros
// cruzados ni paginación) - alcanza para una demo, no reemplaza el modo
// local-duckdb.

const OUT_DIR = path.join("apps", "nexus-bi-app", "public", "data", "cloud");
const TOP_PARTS_LIMIT = 50;
const TOP_CLIENTES_LIMIT = 15;
const FILTER_OPTIONS_LIMIT = 30;
const MANUAL_REVIEW_SAMPLE_LIMIT = 20;

function round1(value) {
  return Math.round(value * 10) / 10;
}

async function tableExists(connection, schema, table) {
  const reader = await connection.runAndReadAll(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${table}'`
  );
  return Number(reader.getRowObjects()[0].n) > 0;
}

async function query(connection, sql) {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowObjects();
}

// DuckDB devuelve BIGINT como `bigint` nativo de JS (no serializable por
// JSON.stringify) y TIMESTAMP/TIMESTAMPTZ como instancias propias de
// @duckdb/node-api - mismo caso que lib/duckdb.ts::serializeValue en la app.
function serializeDuckDbValue(value) {
  if (typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeDuckDbValue);
  if (typeof value === "object" && value.constructor !== Object) return String(value);
  if (typeof value === "object") {
    const result = {};
    for (const [key, nested] of Object.entries(value)) result[key] = serializeDuckDbValue(nested);
    return result;
  }
  return value;
}

async function writeSnapshotFile(fileName, data) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sanitized = sanitizeValue(serializeDuckDbValue(data));
  const filePath = path.join(OUT_DIR, fileName);
  await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), "utf8");
  console.log(`Exportado: ${filePath}`);
  return filePath;
}

async function buildOperationalSummary(connection) {
  const kpiRows = await query(
    connection,
    `
    SELECT
      COUNT(*) AS total_registros,
      COALESCE(SUM(used_parts_count), 0) AS repuestos_usados,
      SUM(CASE WHEN zendesk_join_status != 'NO_TICKET_REPORTED' THEN 1 ELSE 0 END) AS con_ticket_reportado,
      SUM(CASE WHEN zendesk_join_status = 'LINKED_TO_ACCESSIBLE_ZENDESK' THEN 1 ELSE 0 END) AS con_ticket_accesible
    FROM marts.fieldbeat_report_dolibarr_operational_view
    `
  );
  const totalTicketsRows = await query(connection, `SELECT COUNT(*) AS n FROM processed.zendesk_tickets`);

  const totalRegistros = Number(kpiRows[0]?.total_registros ?? 0);
  const conTicketReportado = Number(kpiRows[0]?.con_ticket_reportado ?? 0);
  const conTicketAccesible = Number(kpiRows[0]?.con_ticket_accesible ?? 0);

  const kpis = {
    totalRegistros,
    totalTickets: Number(totalTicketsRows[0]?.n ?? 0),
    repuestosUsados: Number(kpiRows[0]?.repuestos_usados ?? 0),
    pctConTicketReportado: totalRegistros > 0 ? (conTicketReportado / totalRegistros) * 100 : 0,
    pctConTicketAccesible: totalRegistros > 0 ? (conTicketAccesible / totalRegistros) * 100 : 0
  };

  const estados = await query(
    connection,
    `
    SELECT
      CASE
        WHEN status IN ('new', 'open') THEN 'Abierto'
        WHEN status = 'pending' THEN 'Pendiente'
        WHEN status = 'hold' THEN 'En espera'
        WHEN status = 'solved' THEN 'Resuelto'
        WHEN status = 'closed' THEN 'Cerrado'
        ELSE 'Otro'
      END AS estado,
      COUNT(*) AS cantidad
    FROM processed.zendesk_tickets
    GROUP BY 1
    ORDER BY 1
    `
  );

  const evolucion = await query(
    connection,
    `
    SELECT strftime(fieldbeat_task_date, '%Y-%m') AS periodo, COUNT(*) AS cantidad
    FROM marts.fieldbeat_report_dolibarr_operational_view
    WHERE fieldbeat_task_date IS NOT NULL
    GROUP BY periodo
    ORDER BY periodo
    `
  );

  const ticketsClienteRaw = await query(
    connection,
    `
    SELECT
      client_name,
      COUNT(*) AS total,
      SUM(CASE WHEN zendesk_join_status = 'LINKED_TO_ACCESSIBLE_ZENDESK' THEN 1 ELSE 0 END) AS accesibles
    FROM marts.fieldbeat_report_dolibarr_operational_view
    WHERE client_name != ''
    GROUP BY client_name
    ORDER BY total DESC
    LIMIT ${TOP_CLIENTES_LIMIT}
    `
  );
  const ticketsCliente = ticketsClienteRaw.map(row => ({
    cliente: row.client_name,
    total: Number(row.total),
    accesibles: Number(row.accesibles),
    pct: Number(row.total) > 0 ? round1((Number(row.accesibles) / Number(row.total)) * 100) : 0
  }));

  const qualityRows = await query(
    connection,
    `SELECT report_quality_status, COUNT(*) AS cantidad FROM marts.fieldbeat_report_dolibarr_operational_view GROUP BY report_quality_status`
  );
  const ESTADO_GENERAL_LABELS = { OK: "OK", HAS_PLACEHOLDERS: "Con placeholders", HAS_UNMATCHED_PARTS: "Repuestos sin match", HAS_AMBIGUOUS_PARTS: "Matches ambiguos" };
  const estadoGeneral = qualityRows.map(row => ({
    estado: ESTADO_GENERAL_LABELS[row.report_quality_status] ?? "Error",
    cantidad: Number(row.cantidad)
  }));

  return { kpis, estados, evolucion, ticketsCliente, estadoGeneral };
}

async function buildOperationalParts(connection) {
  const rows = await query(
    connection,
    `
    SELECT
      m.dolibarr_ref AS sku_dolibarr,
      COALESCE(MAX(m.dolibarr_label), MAX(m.part_name)) AS nombre_repuesto,
      SUM(COALESCE(p.quantity, 1)) AS cantidad_consumida,
      COUNT(DISTINCT m.fieldbeat_task_id) AS reportes_asociados,
      COUNT(DISTINCT r.client_name) AS clientes_asociados
    FROM marts.used_parts_dolibarr_match m
    LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
    LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
    WHERE m.match_status = 'MATCHED' AND m.dolibarr_ref IS NOT NULL AND TRIM(m.dolibarr_ref) != ''
    GROUP BY m.dolibarr_ref
    ORDER BY cantidad_consumida DESC
    LIMIT ${TOP_PARTS_LIMIT}
    `
  );
  return { rows, totalRows: rows.length };
}

async function buildAuditSummary(connection) {
  const qualityRows = await query(connection, `SELECT * FROM gold.fieldbeat_data_quality`);
  const REVIEW_REQUIRED_STATUSES = new Set(["HAS_PLACEHOLDERS", "HAS_UNMATCHED_PARTS", "HAS_AMBIGUOUS_PARTS", "REVIEW_REQUIRED"]);

  let totalFieldbeatReports = 0;
  let reportsOk = 0;
  let reportsReviewRequired = 0;
  let partsMatched = 0;
  let partsPlaceholder = 0;
  let partsUnmatched = 0;
  let partsAmbiguous = 0;

  for (const row of qualityRows) {
    const count = Number(row.report_count);
    totalFieldbeatReports += count;
    if (row.report_quality_status === "OK") reportsOk += count;
    if (REVIEW_REQUIRED_STATUSES.has(row.report_quality_status)) reportsReviewRequired += count;
    partsMatched += Number(row.matched_used_parts_count);
    partsPlaceholder += Number(row.placeholder_used_parts_count);
    partsUnmatched += Number(row.unmatched_used_parts_count);
    partsAmbiguous += Number(row.ambiguous_used_parts_count);
  }

  const scopeRows = await query(
    connection,
    `SELECT zendesk_backfill_tickets_forbidden, fieldbeat_tasks_without_zendesk_ticket, fieldbeat_tasks_linked_to_missing_zendesk_ticket FROM gold.scope_metadata`
  );
  const scope = scopeRows[0];

  return {
    reportsOk,
    reportsReviewRequired,
    partsMatched,
    partsUnmatched,
    partsAmbiguous,
    partsPlaceholder,
    ticketsForbiddenPending: Number(scope?.zendesk_backfill_tickets_forbidden ?? 0),
    reportsNoTicket: Number(scope?.fieldbeat_tasks_without_zendesk_ticket ?? 0),
    reportsLinkedMissingOrRestricted: Number(scope?.fieldbeat_tasks_linked_to_missing_zendesk_ticket ?? 0),
    totalFieldbeatReports
  };
}

// Muestra acotada y de columnas "seguras" (sin descripciones de ticket, sin
// nombre/RUT de cliente) de repuestos que requieren revisión manual - ver
// docs/MANUAL_REVIEW_VIEW.md.
async function buildAuditManualReviewSample(connection) {
  const rows = await query(
    connection,
    `
    SELECT
      used_part_id,
      fieldbeat_task_id,
      part_name,
      raw_part_identifier,
      normalized_part_identifier,
      dolibarr_ref,
      match_method,
      match_confidence,
      match_status,
      needs_manual_review
    FROM marts.used_parts_dolibarr_match
    WHERE needs_manual_review = true OR match_status IN ('AMBIGUOUS', 'UNMATCHED')
    ORDER BY fieldbeat_task_id
    LIMIT ${MANUAL_REVIEW_SAMPLE_LIMIT}
    `
  );
  return { rows, sampleSize: rows.length, note: "Muestra acotada de solo lectura - no representa el total de pendientes (ver audit-summary.json para conteos completos)." };
}

async function buildAfterHoursSummary(connection) {
  const rows = await query(
    connection,
    `
    SELECT
      COALESCE(SUM(duration_minutes), 0) AS total_duration_minutes,
      COALESCE(SUM(business_minutes), 0) AS total_business_minutes,
      COALESCE(SUM(after_hours_total_minutes), 0) AS total_after_hours_minutes,
      COUNT(*) AS tasks_total,
      COUNT(*) FILTER (WHERE is_after_hours_task = true) AS tasks_with_after_hours,
      COUNT(*) FILTER (WHERE calculation_status = 'NOT_CALCULABLE') AS tasks_not_calculable
    FROM marts.fieldbeat_working_hours_analysis
    `
  );
  const row = rows[0];
  const totalDurationMinutes = Number(row?.total_duration_minutes ?? 0);
  const totalAfterHoursMinutes = Number(row?.total_after_hours_minutes ?? 0);

  let businessHoursStatus = "MISSING";
  let holidaysStatus = "MISSING";
  try {
    const businessHours = JSON.parse(await fs.readFile(path.join("data", "config", "business-hours.json"), "utf8"));
    businessHoursStatus = businessHours?.status || "MISSING";
  } catch {
    // se mantiene MISSING
  }
  try {
    const holidays = JSON.parse(await fs.readFile(path.join("data", "config", "holidays.json"), "utf8"));
    holidaysStatus = holidays?.status || "MISSING";
  } catch {
    try {
      const holidaysExample = JSON.parse(await fs.readFile(path.join("data", "config", "holidays.example.json"), "utf8"));
      holidaysStatus = holidaysExample?.status || "MISSING";
    } catch {
      // se mantiene MISSING
    }
  }

  return {
    businessHoursStatus,
    holidaysStatus,
    kpis: {
      totalHours: totalDurationMinutes / 60,
      businessHours: Number(row?.total_business_minutes ?? 0) / 60,
      afterHoursHours: totalAfterHoursMinutes / 60,
      afterHoursRate: totalDurationMinutes > 0 ? totalAfterHoursMinutes / totalDurationMinutes : 0,
      tasksWithAfterHours: Number(row?.tasks_with_after_hours ?? 0),
      tasksNotCalculable: Number(row?.tasks_not_calculable ?? 0)
    }
  };
}

async function buildEquipmentLifecycleSummary(connection) {
  if (!(await tableExists(connection, "gold", "equipment_part_lifecycle_summary"))) return null;

  const rows = await query(connection, `SELECT * FROM gold.equipment_part_lifecycle_summary LIMIT 1`);
  const row = rows[0];

  const clientes = await query(
    connection,
    `SELECT DISTINCT client_name AS v FROM marts.equipment_part_lifecycle_events WHERE client_name IS NOT NULL AND client_name != '' ORDER BY v LIMIT ${FILTER_OPTIONS_LIMIT}`
  );
  const tiposTarea = await query(
    connection,
    `SELECT DISTINCT task_type AS v FROM marts.equipment_part_lifecycle_events WHERE task_type IS NOT NULL AND task_type != '' ORDER BY v LIMIT ${FILTER_OPTIONS_LIMIT}`
  );

  return {
    total_machine_part_combinations: Number(row?.total_machine_part_combinations ?? 0),
    total_machines_analyzed: Number(row?.total_machines_analyzed ?? 0),
    total_parts_analyzed: Number(row?.total_parts_analyzed ?? 0),
    total_clients_analyzed: Number(row?.total_clients_analyzed ?? 0),
    prediction_status_breakdown: row?.prediction_status_breakdown ? JSON.parse(row.prediction_status_breakdown) : {},
    confidence_label_breakdown: row?.confidence_label_breakdown ? JSON.parse(row.confidence_label_breakdown) : {},
    total_insights_generated: Number(row?.total_insights_generated ?? 0),
    filterOptions: {
      clientes: clientes.map(r => r.v),
      tiposTarea: tiposTarea.map(r => r.v)
    }
  };
}

async function buildScopeWarnings(connection) {
  const rows = await query(connection, `SELECT * FROM gold.scope_metadata LIMIT 1`);
  const row = rows[0] ?? {};
  return {
    total_fieldbeat_tasks: Number(row.total_fieldbeat_tasks ?? 0),
    fieldbeat_tasks_with_zendesk_ticket: Number(row.fieldbeat_tasks_with_zendesk_ticket ?? 0),
    fieldbeat_tasks_without_zendesk_ticket: Number(row.fieldbeat_tasks_without_zendesk_ticket ?? 0),
    fieldbeat_tasks_linked_to_missing_zendesk_ticket: Number(row.fieldbeat_tasks_linked_to_missing_zendesk_ticket ?? 0),
    zendesk_backfill_tickets_forbidden: Number(row.zendesk_backfill_tickets_forbidden ?? 0),
    zendesk_backfill_tickets_not_found: Number(row.zendesk_backfill_tickets_not_found ?? 0),
    scope_warning: row.scope_warning ?? null,
    phase_2_pending_action: row.phase_2_pending_action ?? null
  };
}

export async function exportCloudSnapshot() {
  console.log("=== Exportando snapshot cloud-demo estático ===");
  console.log(`Origen (solo lectura): ${DB_PATH}`);

  const instance = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();

  const exportedFiles = [];

  try {
    exportedFiles.push(await writeSnapshotFile("dashboard-operacional-summary.json", await buildOperationalSummary(connection)));
    exportedFiles.push(await writeSnapshotFile("dashboard-operacional-parts.json", await buildOperationalParts(connection)));
    exportedFiles.push(await writeSnapshotFile("audit-summary.json", await buildAuditSummary(connection)));
    exportedFiles.push(await writeSnapshotFile("audit-manual-review.sample.json", await buildAuditManualReviewSample(connection)));
    exportedFiles.push(await writeSnapshotFile("after-hours-summary.json", await buildAfterHoursSummary(connection)));

    const equipmentLifecycle = await buildEquipmentLifecycleSummary(connection);
    if (equipmentLifecycle) {
      exportedFiles.push(await writeSnapshotFile("equipment-lifecycle-summary.json", equipmentLifecycle));
    } else {
      console.log("gold.equipment_part_lifecycle_summary no existe - se omite equipment-lifecycle-summary.json");
    }

    exportedFiles.push(await writeSnapshotFile("scope-warnings.json", await buildScopeWarnings(connection)));
  } finally {
    connection.closeSync();
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    dataMode: "static",
    sourceWarehouse: path.basename(DB_PATH),
    sanitized: true,
    files: exportedFiles.map(f => path.basename(f))
  };
  const metadataPath = await writeSnapshotFile("metadata.json", metadata);
  exportedFiles.push(metadataPath);

  console.log(`=== Snapshot exportado: ${exportedFiles.length} archivo(s) en ${OUT_DIR} ===`);
  return { outDir: OUT_DIR, files: exportedFiles };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  exportCloudSnapshot().catch(error => {
    console.error("ERROR EXPORTANDO SNAPSHOT CLOUD:");
    console.error(error);
    process.exit(1);
  });
}
