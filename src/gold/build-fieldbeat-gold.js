import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";

const REPORT_MART_FILE = "data/marts/FieldBeat_Report_Dolibarr_Operational_View.csv";
const USED_PARTS_MATCH_FILE = "data/marts/Used_Parts_Dolibarr_Match.csv";

const OUTPUT_DIR = "data/gold";
const BUILD_SUMMARY_FILE = "data/reports/fieldbeat_gold_build_summary.json";

const REPORT_QUALITY_STATUSES = [
  "OK",
  "NO_USED_PARTS",
  "HAS_PLACEHOLDERS",
  "HAS_UNMATCHED_PARTS",
  "HAS_AMBIGUOUS_PARTS",
  "REVIEW_REQUIRED"
];

function num(value) {
  return Number(value || 0);
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function splitPipe(value) {
  return String(value ?? "")
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
}

// Bucket mensual (YYYY-MM) derivado de fieldbeat_task_date, para que
// GOLD_Client_Parts_Consumption / GOLD_Client_Report_Volume_By_Period se
// puedan filtrar por ventana de tiempo en la herramienta BI (sumando los
// meses que correspondan) sin tener que reconstruir el pipeline.
function toPeriod(dateValue) {
  const value = String(dateValue ?? "").trim();
  if (!value) return "(sin fecha)";

  const match = value.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "(fecha invalida)";
}

function buildFieldBeatReportAnalysis(reportRows) {
  const totalReports = reportRows.length;
  const noTicket = reportRows.filter(r => r.zendesk_join_status === "NO_TICKET_REPORTED").length;
  const linkedAccessible = reportRows.filter(r => r.zendesk_join_status === "LINKED_TO_ACCESSIBLE_ZENDESK").length;
  const linkedMissing = reportRows.filter(r => r.zendesk_join_status === "LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK").length;
  const reportsWithUsedParts = reportRows.filter(r => num(r.used_parts_count) > 0).length;
  const reportsOk = reportRows.filter(r => r.report_quality_status === "OK").length;
  const reportsReviewRequired = reportRows.filter(r => num(r.review_required_used_parts_count) > 0).length;

  const sumField = field => reportRows.reduce((sum, r) => sum + num(r[field]), 0);

  const totalUsedParts = sumField("used_parts_count");
  const matchedUsedParts = sumField("matched_used_parts_count");
  const placeholderUsedParts = sumField("placeholder_used_parts_count");
  const unmatchedUsedParts = sumField("unmatched_used_parts_count");
  const ambiguousUsedParts = sumField("ambiguous_used_parts_count");
  const reviewRequiredUsedParts = sumField("review_required_used_parts_count");

  return [{
    total_fieldbeat_reports: totalReports,
    reports_no_ticket_reported: noTicket,
    reports_linked_to_accessible_zendesk: linkedAccessible,
    reports_linked_to_missing_or_restricted_zendesk: linkedMissing,
    reports_with_used_parts: reportsWithUsedParts,
    reports_ok: reportsOk,
    reports_review_required: reportsReviewRequired,
    total_used_parts: totalUsedParts,
    matched_used_parts: matchedUsedParts,
    placeholder_used_parts: placeholderUsedParts,
    unmatched_used_parts: unmatchedUsedParts,
    ambiguous_used_parts: ambiguousUsedParts,
    zendesk_link_rate: percent(linkedAccessible, totalReports),
    used_parts_match_rate: percent(matchedUsedParts, totalUsedParts),
    review_required_rate: percent(reviewRequiredUsedParts, totalUsedParts)
  }];
}

function buildFieldBeatDataQuality(reportRows) {
  const totalReports = reportRows.length;

  return REPORT_QUALITY_STATUSES.map(status => {
    const rows = reportRows.filter(r => r.report_quality_status === status);
    const sumField = field => rows.reduce((sum, r) => sum + num(r[field]), 0);

    return {
      report_quality_status: status,
      report_count: rows.length,
      percent_of_total_reports: percent(rows.length, totalReports),
      used_parts_count: sumField("used_parts_count"),
      matched_used_parts_count: sumField("matched_used_parts_count"),
      placeholder_used_parts_count: sumField("placeholder_used_parts_count"),
      unmatched_used_parts_count: sumField("unmatched_used_parts_count"),
      ambiguous_used_parts_count: sumField("ambiguous_used_parts_count")
    };
  });
}

// Grano (cliente, período mensual) — deliberado: permite responder tanto
// "qué cliente usa más repuestos" (sumando todos los períodos) como
// "qué cliente usa más repuestos en una ventana de tiempo" (filtrando
// período en la herramienta BI), sin necesitar dos tablas separadas.
function buildClientPartsConsumption(reportRows) {
  const groups = new Map();

  for (const report of reportRows) {
    const clientName = String(report.client_name || "").trim();
    if (!clientName) continue;

    const period = toPeriod(report.fieldbeat_task_date);
    const key = `${clientName}||${period}`;

    if (!groups.has(key)) {
      groups.set(key, {
        client_name: clientName,
        client_rut: report.client_rut || "",
        period,
        total_reports: 0,
        used_parts_count: 0,
        matched_used_parts_count: 0,
        placeholder_used_parts_count: 0,
        unmatched_used_parts_count: 0,
        ambiguous_used_parts_count: 0
      });
    }

    const group = groups.get(key);
    group.total_reports += 1;
    group.used_parts_count += num(report.used_parts_count);
    group.matched_used_parts_count += num(report.matched_used_parts_count);
    group.placeholder_used_parts_count += num(report.placeholder_used_parts_count);
    group.unmatched_used_parts_count += num(report.unmatched_used_parts_count);
    group.ambiguous_used_parts_count += num(report.ambiguous_used_parts_count);
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.client_name !== b.client_name) return a.client_name.localeCompare(b.client_name);
    return a.period.localeCompare(b.period);
  });
}

function buildClientReportVolumeByPeriod(reportRows) {
  const groups = new Map();

  for (const report of reportRows) {
    const clientName = String(report.client_name || "").trim();
    if (!clientName) continue;

    const period = toPeriod(report.fieldbeat_task_date);
    const key = `${clientName}||${period}`;

    if (!groups.has(key)) {
      groups.set(key, {
        client_name: clientName,
        period,
        total_reports: 0,
        reports_with_used_parts: 0,
        reports_review_required: 0
      });
    }

    const group = groups.get(key);
    group.total_reports += 1;
    if (num(report.used_parts_count) > 0) group.reports_with_used_parts += 1;
    if (num(report.review_required_used_parts_count) > 0) group.reports_review_required += 1;
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.client_name !== b.client_name) return a.client_name.localeCompare(b.client_name);
    return a.period.localeCompare(b.period);
  });
}

function buildEquipmentPartsConsumption(reportRows) {
  const groups = new Map();

  for (const report of reportRows) {
    for (const equipmentId of splitPipe(report.equipment_internal_ids)) {
      if (!groups.has(equipmentId)) {
        groups.set(equipmentId, {
          equipment_internal_id: equipmentId,
          total_reports: 0,
          used_parts_count: 0,
          matched_used_parts_count: 0,
          placeholder_used_parts_count: 0,
          unmatched_used_parts_count: 0,
          ambiguous_used_parts_count: 0
        });
      }

      const group = groups.get(equipmentId);
      group.total_reports += 1;
      group.used_parts_count += num(report.used_parts_count);
      group.matched_used_parts_count += num(report.matched_used_parts_count);
      group.placeholder_used_parts_count += num(report.placeholder_used_parts_count);
      group.unmatched_used_parts_count += num(report.unmatched_used_parts_count);
      group.ambiguous_used_parts_count += num(report.ambiguous_used_parts_count);
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.used_parts_count - a.used_parts_count);
}

async function buildFieldBeatGold() {
  console.log("=== Construyendo GOLD FieldBeat-first (report-centric) ===");

  const reportRows = await readCsv(REPORT_MART_FILE);
  const usedPartsMatchRows = await readCsv(USED_PARTS_MATCH_FILE);

  console.log(`Reportes FieldBeat: ${reportRows.length}`);
  console.log(`Used parts (global): ${usedPartsMatchRows.length}`);

  const outputs = [
    { file: `${OUTPUT_DIR}/GOLD_FieldBeat_Report_Analysis.csv`, rows: buildFieldBeatReportAnalysis(reportRows) },
    { file: `${OUTPUT_DIR}/GOLD_Client_Parts_Consumption.csv`, rows: buildClientPartsConsumption(reportRows) },
    { file: `${OUTPUT_DIR}/GOLD_Client_Report_Volume_By_Period.csv`, rows: buildClientReportVolumeByPeriod(reportRows) },
    { file: `${OUTPUT_DIR}/GOLD_Equipment_Parts_Consumption.csv`, rows: buildEquipmentPartsConsumption(reportRows) },
    { file: `${OUTPUT_DIR}/GOLD_FieldBeat_Data_Quality.csv`, rows: buildFieldBeatDataQuality(reportRows) }
  ];

  for (const output of outputs) {
    await writeCsv(output.file, output.rows);
  }

  // Chequeo cruzado: la suma de used_parts_count del mart report-centric
  // (que no excluye ningún task) debe calzar exacto con el total global
  // de Used_Parts_Dolibarr_Match.csv.
  const usedPartsFromReports = reportRows.reduce((sum, r) => sum + num(r.used_parts_count), 0);
  const usedPartsCrossCheckMatches = usedPartsFromReports === usedPartsMatchRows.length;

  const buildSummary = {
    generated_at: new Date().toISOString(),
    inputs_used: [REPORT_MART_FILE, USED_PARTS_MATCH_FILE],
    outputs: outputs.map(o => ({ file: o.file, row_count: o.rows.length })),
    used_parts_cross_check: {
      used_parts_summed_from_reports: usedPartsFromReports,
      used_parts_global_source_count: usedPartsMatchRows.length,
      matches: usedPartsCrossCheckMatches
    }
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(BUILD_SUMMARY_FILE, JSON.stringify(buildSummary, null, 2), "utf8");

  console.log(JSON.stringify(buildSummary, null, 2));
  console.log(`Resumen de build guardado en ${BUILD_SUMMARY_FILE}`);
  console.log("=== GOLD FieldBeat-first finalizado ===");
}

buildFieldBeatGold().catch(error => {
  console.error("ERROR CONSTRUYENDO GOLD FIELDBEAT-FIRST:");
  console.error(error);
  process.exit(1);
});
