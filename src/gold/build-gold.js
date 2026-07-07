import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";

const TICKET_MART_FILE = "data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv";
const REPORT_DETAIL_FILE = "data/marts/Ticket_FieldBeat_Report_Detail.csv";
const USED_PARTS_MATCH_FILE = "data/marts/Used_Parts_Dolibarr_Match.csv";
const SCOPE_SUMMARY_FILE = "data/reports/scope_reconciliation_summary.json";
const BACKFILL_SUMMARY_FILE = "data/reports/zendesk_backfill_by_fieldbeat_summary.json";
const DOLIBARR_MATCH_SUMMARY_FILE = "data/reports/dolibarr_parts_match_summary.json";

const OUTPUT_DIR = "data/gold";
const BUILD_SUMMARY_FILE = "data/reports/gold_build_summary.json";

const SCOPE_WARNING =
  "GOLD v1 representa únicamente el universo Zendesk accesible con las credenciales actuales. " +
  "Existen FieldBeat tasks vinculadas a tickets Zendesk no accesibles o no existentes que quedan " +
  "fuera del mart ticket-céntrico.";

const PHASE_2_PENDING_ACTION =
  "Revisar los 291 ticket IDs con 403 Forbidden usando un token Zendesk con permisos ampliados. " +
  "Lista en data/reports/zendesk_ticket_ids_not_accessible_403.json.";

const DATA_QUALITY_STATUSES = [
  "OK",
  "NO_FIELDBEAT_REPORT",
  "HAS_PLACEHOLDERS",
  "HAS_UNMATCHED_PARTS",
  "HAS_AMBIGUOUS_PARTS",
  "REVIEW_REQUIRED"
];

function isTrue(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

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

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function buildOperationalDashboard(ticketRows) {
  const totalTickets = ticketRows.length;
  const ticketsWithFieldbeat = ticketRows.filter(t => isTrue(t.has_fieldbeat_report)).length;
  const ticketsWithMultiple = ticketRows.filter(t => isTrue(t.has_multiple_fieldbeat_reports)).length;
  const ticketsWithUsedParts = ticketRows.filter(t => num(t.used_parts_count) > 0).length;
  const ticketsAllMatched = ticketRows.filter(t => t.part_match_quality_status === "ALL_PARTS_MATCHED").length;
  const ticketsReviewRequired = ticketRows.filter(t => num(t.review_required_used_parts_count) > 0).length;

  const sumField = field => ticketRows.reduce((sum, r) => sum + num(r[field]), 0);

  const totalUsedParts = sumField("used_parts_count");
  const matchedUsedParts = sumField("matched_used_parts_count");
  const placeholderUsedParts = sumField("placeholder_used_parts_count");
  const unmatchedUsedParts = sumField("unmatched_used_parts_count");
  const ambiguousUsedParts = sumField("ambiguous_used_parts_count");
  const reviewRequiredUsedParts = sumField("review_required_used_parts_count");

  return [{
    total_zendesk_tickets: totalTickets,
    tickets_with_fieldbeat_report: ticketsWithFieldbeat,
    tickets_without_fieldbeat_report: totalTickets - ticketsWithFieldbeat,
    tickets_with_multiple_fieldbeat_reports: ticketsWithMultiple,
    tickets_with_used_parts: ticketsWithUsedParts,
    tickets_with_all_parts_matched: ticketsAllMatched,
    tickets_review_required: ticketsReviewRequired,
    total_used_parts_in_ticket_scope: totalUsedParts,
    matched_used_parts: matchedUsedParts,
    placeholder_used_parts: placeholderUsedParts,
    unmatched_used_parts: unmatchedUsedParts,
    ambiguous_used_parts: ambiguousUsedParts,
    ticket_fieldbeat_coverage_rate: percent(ticketsWithFieldbeat, totalTickets),
    used_parts_match_rate: percent(matchedUsedParts, totalUsedParts),
    review_required_rate: percent(reviewRequiredUsedParts, totalUsedParts)
  }];
}

function buildDataQualityReport(ticketRows) {
  const totalTickets = ticketRows.length;

  return DATA_QUALITY_STATUSES.map(status => {
    const rows = ticketRows.filter(t => t.data_quality_status === status);
    const sumField = field => rows.reduce((sum, r) => sum + num(r[field]), 0);

    return {
      data_quality_status: status,
      ticket_count: rows.length,
      percent_of_total_tickets: percent(rows.length, totalTickets),
      used_parts_count: sumField("used_parts_count"),
      matched_used_parts_count: sumField("matched_used_parts_count"),
      placeholder_used_parts_count: sumField("placeholder_used_parts_count"),
      unmatched_used_parts_count: sumField("unmatched_used_parts_count"),
      ambiguous_used_parts_count: sumField("ambiguous_used_parts_count")
    };
  });
}

// Fan-out: client_names/equipment_internal_ids vienen pipe-joined por ticket
// (un ticket puede tener mas de un cliente/equipo si tuvo varios reportes
// FieldBeat). Cada ticket se cuenta una vez POR cada valor que menciona.
function buildClientServiceProfile(ticketRows) {
  const groups = new Map();

  for (const ticket of ticketRows) {
    for (const clientName of splitPipe(ticket.client_names)) {
      if (!groups.has(clientName)) {
        groups.set(clientName, {
          client_name: clientName,
          total_tickets: 0,
          tickets_with_fieldbeat: 0,
          fieldbeat_report_count: 0,
          tickets_with_multiple_fieldbeat_reports: 0,
          tickets_with_used_parts: 0,
          used_parts_count: 0,
          matched_used_parts_count: 0,
          placeholder_used_parts_count: 0,
          unmatched_used_parts_count: 0,
          ambiguous_used_parts_count: 0,
          review_required_tickets: 0
        });
      }

      const group = groups.get(clientName);
      group.total_tickets += 1;
      if (isTrue(ticket.has_fieldbeat_report)) group.tickets_with_fieldbeat += 1;
      group.fieldbeat_report_count += num(ticket.fieldbeat_report_count);
      if (isTrue(ticket.has_multiple_fieldbeat_reports)) group.tickets_with_multiple_fieldbeat_reports += 1;
      if (num(ticket.used_parts_count) > 0) group.tickets_with_used_parts += 1;
      group.used_parts_count += num(ticket.used_parts_count);
      group.matched_used_parts_count += num(ticket.matched_used_parts_count);
      group.placeholder_used_parts_count += num(ticket.placeholder_used_parts_count);
      group.unmatched_used_parts_count += num(ticket.unmatched_used_parts_count);
      group.ambiguous_used_parts_count += num(ticket.ambiguous_used_parts_count);
      if (num(ticket.review_required_used_parts_count) > 0) group.review_required_tickets += 1;
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.total_tickets - a.total_tickets);
}

function buildEquipmentServiceProfile(ticketRows) {
  const groups = new Map();

  for (const ticket of ticketRows) {
    for (const equipmentId of splitPipe(ticket.equipment_internal_ids)) {
      if (!groups.has(equipmentId)) {
        groups.set(equipmentId, {
          equipment_internal_id: equipmentId,
          total_tickets: 0,
          fieldbeat_report_count: 0,
          tickets_with_used_parts: 0,
          used_parts_count: 0,
          unmatched_used_parts_count: 0,
          ambiguous_used_parts_count: 0,
          review_required_tickets: 0
        });
      }

      const group = groups.get(equipmentId);
      group.total_tickets += 1;
      group.fieldbeat_report_count += num(ticket.fieldbeat_report_count);
      if (num(ticket.used_parts_count) > 0) group.tickets_with_used_parts += 1;
      group.used_parts_count += num(ticket.used_parts_count);
      group.unmatched_used_parts_count += num(ticket.unmatched_used_parts_count);
      group.ambiguous_used_parts_count += num(ticket.ambiguous_used_parts_count);
      if (num(ticket.review_required_used_parts_count) > 0) group.review_required_tickets += 1;
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.total_tickets - a.total_tickets);
}

// Análisis global de repuestos (todas las tasks FieldBeat, no solo las
// que caen dentro del alcance de tickets Zendesk accesibles) - es un
// catálogo de calidad de matching, complementario a las métricas
// ticket-céntricas del resto de GOLD.
function buildUsedPartsAnalysis(usedPartRows) {
  const groups = new Map();

  for (const row of usedPartRows) {
    const key = row.normalized_part_identifier || "(vacio)";

    if (!groups.has(key)) {
      groups.set(key, {
        normalized_part_identifier: key,
        rawIdentifiers: new Set(),
        partNames: new Set(),
        occurrences: 0,
        matched_count: 0,
        placeholder_count: 0,
        no_match_count: 0,
        ambiguous_count: 0,
        dolibarrRefs: new Set(),
        dolibarrProductIds: new Set(),
        matchStatuses: new Set(),
        matchMethods: new Set(),
        needsManualReview: false
      });
    }

    const group = groups.get(key);
    group.occurrences += 1;

    if (row.raw_part_identifier) group.rawIdentifiers.add(row.raw_part_identifier);
    if (row.part_name) group.partNames.add(row.part_name);
    if (row.dolibarr_ref) group.dolibarrRefs.add(row.dolibarr_ref);
    if (row.dolibarr_product_id) group.dolibarrProductIds.add(row.dolibarr_product_id);
    if (row.match_status) group.matchStatuses.add(row.match_status);
    if (row.match_method) group.matchMethods.add(row.match_method);

    if (row.match_status === "MATCHED") group.matched_count += 1;
    if (row.match_status === "PLACEHOLDER_VALUE") group.placeholder_count += 1;
    if (row.match_status === "NO_MATCH") group.no_match_count += 1;
    if (row.match_status === "AMBIGUOUS_MATCH") group.ambiguous_count += 1;

    if (isTrue(row.needs_manual_review)) group.needsManualReview = true;
  }

  return Array.from(groups.values())
    .map(group => ({
      normalized_part_identifier: group.normalized_part_identifier,
      raw_part_identifier: Array.from(group.rawIdentifiers).join("|"),
      part_name: Array.from(group.partNames).join("|"),
      occurrences: group.occurrences,
      matched_count: group.matched_count,
      placeholder_count: group.placeholder_count,
      no_match_count: group.no_match_count,
      ambiguous_count: group.ambiguous_count,
      dolibarr_refs: Array.from(group.dolibarrRefs).join("|"),
      dolibarr_product_ids: Array.from(group.dolibarrProductIds).join("|"),
      match_statuses: Array.from(group.matchStatuses).join("|"),
      match_methods: Array.from(group.matchMethods).join("|"),
      needs_manual_review: group.needsManualReview
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

function buildScopeMetadata(scopeSummary, backfillSummary) {
  return [{
    total_fieldbeat_tasks: scopeSummary.total_fieldbeat_tasks,
    total_fieldbeat_used_parts_global: scopeSummary.total_fieldbeat_used_parts_global,
    used_parts_in_ticket_mart: scopeSummary.used_parts_in_ticket_mart,
    used_parts_outside_ticket_mart: scopeSummary.used_parts_outside_ticket_mart,
    fieldbeat_tasks_with_zendesk_ticket: scopeSummary.fieldbeat_tasks_with_zendesk_ticket,
    fieldbeat_tasks_without_zendesk_ticket: scopeSummary.fieldbeat_tasks_without_zendesk_ticket,
    fieldbeat_tasks_linked_to_existing_zendesk_ticket: scopeSummary.fieldbeat_tasks_linked_to_existing_zendesk_ticket,
    fieldbeat_tasks_linked_to_missing_zendesk_ticket: scopeSummary.fieldbeat_tasks_linked_to_missing_zendesk_ticket,
    zendesk_backfill_unique_missing_ticket_ids: backfillSummary.unique_missing_ticket_ids,
    zendesk_backfill_tickets_found: backfillSummary.tickets_found_in_zendesk,
    zendesk_backfill_tickets_not_found: backfillSummary.tickets_not_found,
    zendesk_backfill_tickets_forbidden: backfillSummary.tickets_failed_by_error,
    scope_warning: SCOPE_WARNING,
    phase_2_pending_action: PHASE_2_PENDING_ACTION
  }];
}

async function buildGold() {
  console.log("=== Construyendo GOLD v1 ===");

  const ticketRows = await readCsv(TICKET_MART_FILE);
  const reportDetailRows = await readCsv(REPORT_DETAIL_FILE);
  const usedPartsMatchRows = await readCsv(USED_PARTS_MATCH_FILE);
  const scopeSummary = await readJson(SCOPE_SUMMARY_FILE);
  const backfillSummary = await readJson(BACKFILL_SUMMARY_FILE);
  const dolibarrMatchSummary = await readJson(DOLIBARR_MATCH_SUMMARY_FILE);

  console.log(`Tickets (mart 3 plataformas): ${ticketRows.length}`);
  console.log(`Relaciones Ticket<->FieldBeat detalladas: ${reportDetailRows.length}`);
  console.log(`Used parts (global): ${usedPartsMatchRows.length}`);

  const operationalDashboard = buildOperationalDashboard(ticketRows);
  const dataQualityReport = buildDataQualityReport(ticketRows);
  const clientServiceProfile = buildClientServiceProfile(ticketRows);
  const equipmentServiceProfile = buildEquipmentServiceProfile(ticketRows);
  const usedPartsAnalysis = buildUsedPartsAnalysis(usedPartsMatchRows);
  const scopeMetadata = buildScopeMetadata(scopeSummary, backfillSummary);

  const outputs = [
    { file: `${OUTPUT_DIR}/GOLD_Operational_Dashboard.csv`, rows: operationalDashboard },
    { file: `${OUTPUT_DIR}/GOLD_Data_Quality_Report.csv`, rows: dataQualityReport },
    { file: `${OUTPUT_DIR}/GOLD_Client_Service_Profile.csv`, rows: clientServiceProfile },
    { file: `${OUTPUT_DIR}/GOLD_Equipment_Service_Profile.csv`, rows: equipmentServiceProfile },
    { file: `${OUTPUT_DIR}/GOLD_Used_Parts_Analysis.csv`, rows: usedPartsAnalysis },
    { file: `${OUTPUT_DIR}/GOLD_Scope_Metadata.csv`, rows: scopeMetadata }
  ];

  for (const output of outputs) {
    await writeCsv(output.file, output.rows);
  }

  // Chequeo cruzado: Ticket_FieldBeat_Report_Detail.csv es la expansión
  // 1-fila-por-relación de los mismos datos que el mart resume como
  // fieldbeat_report_count por ticket. Si no calzan, algo se desincronizó
  // entre builds.
  const fieldbeatReportCountFromTicketMart = ticketRows.reduce(
    (sum, row) => sum + num(row.fieldbeat_report_count),
    0
  );
  const reportDetailTotalsMatch = fieldbeatReportCountFromTicketMart === reportDetailRows.length;

  const buildSummary = {
    generated_at: new Date().toISOString(),
    inputs_used: [
      TICKET_MART_FILE,
      REPORT_DETAIL_FILE,
      USED_PARTS_MATCH_FILE,
      SCOPE_SUMMARY_FILE,
      BACKFILL_SUMMARY_FILE,
      DOLIBARR_MATCH_SUMMARY_FILE
    ],
    outputs: outputs.map(o => ({ file: o.file, row_count: o.rows.length })),
    report_detail_cross_check: {
      report_detail_rows: reportDetailRows.length,
      fieldbeat_report_count_from_ticket_mart: fieldbeatReportCountFromTicketMart,
      totals_match: reportDetailTotalsMatch
    },
    source_summaries: {
      scope_reconciliation: {
        total_zendesk_tickets: scopeSummary.total_zendesk_tickets,
        total_fieldbeat_tasks: scopeSummary.total_fieldbeat_tasks,
        used_parts_in_ticket_mart: scopeSummary.used_parts_in_ticket_mart,
        used_parts_outside_ticket_mart: scopeSummary.used_parts_outside_ticket_mart
      },
      zendesk_backfill: {
        unique_missing_ticket_ids: backfillSummary.unique_missing_ticket_ids,
        tickets_found_in_zendesk: backfillSummary.tickets_found_in_zendesk,
        tickets_not_found: backfillSummary.tickets_not_found,
        tickets_failed_by_error: backfillSummary.tickets_failed_by_error
      },
      dolibarr_parts_match: {
        total_used_parts: dolibarrMatchSummary.total_used_parts,
        matched_count: dolibarrMatchSummary.matched_count,
        placeholder_values_count: dolibarrMatchSummary.placeholder_values_count,
        ambiguous_count: dolibarrMatchSummary.ambiguous_count,
        match_rate: dolibarrMatchSummary.match_rate
      }
    },
    scope_warning: SCOPE_WARNING,
    phase_2_pending_action: PHASE_2_PENDING_ACTION
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(BUILD_SUMMARY_FILE, JSON.stringify(buildSummary, null, 2), "utf8");

  console.log(JSON.stringify(buildSummary, null, 2));
  console.log(`Resumen de build guardado en ${BUILD_SUMMARY_FILE}`);
  console.log("=== GOLD v1 finalizado ===");
}

buildGold().catch(error => {
  console.error("ERROR CONSTRUYENDO GOLD:");
  console.error(error);
  process.exit(1);
});
