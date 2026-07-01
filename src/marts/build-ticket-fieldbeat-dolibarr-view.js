import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";

const OPERATIONAL_VIEW_FILE = "data/marts/Ticket_FieldBeat_Operational_View.csv";
const USED_PARTS_MATCH_FILE = "data/marts/Used_Parts_Dolibarr_Match.csv";

const OUTPUT_VIEW_FILE = "data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv";
const SUMMARY_FILE = "data/reports/ticket_fieldbeat_dolibarr_summary.json";

function cleanId(value) {
  return String(value ?? "").trim();
}

function isTrue(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function uniqueNonEmpty(values) {
  const seen = new Set();

  for (const value of values) {
    const clean = String(value ?? "").trim();
    if (clean) seen.add(clean);
  }

  return Array.from(seen);
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

// Ticket_FieldBeat_Operational_View.csv ya trae fieldbeat_task_ids (pipe-joined)
// por ticket; con eso alcanza para reconstruir task_id -> ticket_id sin volver
// a leer la tabla puente directamente (no era parte de los archivos a leer).
function buildTaskToTicketMap(ticketRows) {
  const map = new Map();

  for (const ticket of ticketRows) {
    const ticketId = cleanId(ticket.zendesk_ticket_id);
    const taskIds = String(ticket.fieldbeat_task_ids || "")
      .split("|")
      .map(cleanId)
      .filter(Boolean);

    for (const taskId of taskIds) {
      map.set(taskId, ticketId);
    }
  }

  return map;
}

function groupPartsByTicket(usedPartRows, taskToTicket) {
  const map = new Map();

  for (const row of usedPartRows) {
    const ticketId = taskToTicket.get(cleanId(row.fieldbeat_task_id));
    if (!ticketId) continue;

    if (!map.has(ticketId)) map.set(ticketId, []);
    map.get(ticketId).push(row);
  }

  return map;
}

// Cascada por severidad (AMBIGUOUS_MATCH > NO_MATCH > PLACEHOLDER_VALUE > MATCHED):
// las categorias "malas" (ambiguous/unmatched) dominan apenas hay una presente;
// los estados "puros" (ALL_PARTS_MATCHED / HAS_PLACEHOLDERS_ONLY) requieren que
// TODAS las partes sean de ese tipo; MIXED_QUALITY es el resto (mezcla de
// matched + placeholder, sin nada peor).
function computePartMatchQualityStatus(counts) {
  if (counts.total === 0) return "NO_USED_PARTS";
  if (counts.ambiguous > 0) return "HAS_AMBIGUOUS_PARTS";
  if (counts.unmatched > 0) return "HAS_UNMATCHED_PARTS";
  if (counts.matched === counts.total) return "ALL_PARTS_MATCHED";
  if (counts.placeholder === counts.total) return "HAS_PLACEHOLDERS_ONLY";
  return "MIXED_QUALITY";
}

// REVIEW_REQUIRED cubre el caso de partes en estado MATCHED pero de baja
// confianza (REF_LIKE), que no encaja en ninguna otra categoria pero igual
// necesita revisión humana.
function computeDataQualityStatus(hasFieldbeatReport, counts) {
  if (!hasFieldbeatReport) return "NO_FIELDBEAT_REPORT";
  if (counts.ambiguous > 0) return "HAS_AMBIGUOUS_PARTS";
  if (counts.unmatched > 0) return "HAS_UNMATCHED_PARTS";
  if (counts.placeholder > 0) return "HAS_PLACEHOLDERS";
  if (counts.reviewRequired > 0) return "REVIEW_REQUIRED";
  return "OK";
}

function aggregatePartsForTicket(parts) {
  const counts = {
    total: parts.length,
    matched: 0,
    placeholder: 0,
    unmatched: 0,
    ambiguous: 0,
    manualAlias: 0,
    refExact: 0,
    refLike: 0,
    reviewRequired: 0
  };

  for (const part of parts) {
    if (part.match_status === "MATCHED") counts.matched++;
    if (part.match_status === "PLACEHOLDER_VALUE") counts.placeholder++;
    if (part.match_status === "NO_MATCH") counts.unmatched++;
    if (part.match_status === "AMBIGUOUS_MATCH") counts.ambiguous++;
    if (part.match_method === "MANUAL_ALIAS_EXACT") counts.manualAlias++;
    if (part.match_method === "REF_EXACT") counts.refExact++;
    if (part.match_method === "REF_LIKE") counts.refLike++;
    if (isTrue(part.needs_manual_review)) counts.reviewRequired++;
  }

  const fields = {
    used_parts_count: counts.total,
    matched_used_parts_count: counts.matched,
    placeholder_used_parts_count: counts.placeholder,
    unmatched_used_parts_count: counts.unmatched,
    ambiguous_used_parts_count: counts.ambiguous,
    manual_alias_match_count: counts.manualAlias,
    ref_exact_match_count: counts.refExact,
    ref_like_match_count: counts.refLike,
    review_required_used_parts_count: counts.reviewRequired,
    dolibarr_product_ids: uniqueNonEmpty(parts.map(p => p.dolibarr_product_id)).join("|"),
    dolibarr_refs: uniqueNonEmpty(parts.map(p => p.dolibarr_ref)).join("|"),
    used_part_numbers: uniqueNonEmpty(parts.map(p => p.raw_part_identifier)).join("|"),
    used_part_names: uniqueNonEmpty(parts.map(p => p.part_name)).join("|"),
    part_match_methods: uniqueNonEmpty(parts.map(p => p.match_method)).join("|"),
    part_match_statuses: uniqueNonEmpty(parts.map(p => p.match_status)).join("|"),
    part_match_quality_status: computePartMatchQualityStatus(counts)
  };

  return { counts, fields };
}

async function buildTicketFieldBeatDolibarrView() {
  console.log("=== Construyendo vista Ticket <-> FieldBeat <-> Dolibarr ===");

  const ticketRows = await readCsv(OPERATIONAL_VIEW_FILE);
  const usedPartRows = await readCsv(USED_PARTS_MATCH_FILE);

  console.log(`Tickets (Ticket_FieldBeat_Operational_View): ${ticketRows.length}`);
  console.log(`Filas Used_Parts_Dolibarr_Match: ${usedPartRows.length}`);

  const taskToTicket = buildTaskToTicketMap(ticketRows);
  const partsByTicket = groupPartsByTicket(usedPartRows, taskToTicket);

  const outputRows = ticketRows.map(ticket => {
    const ticketId = cleanId(ticket.zendesk_ticket_id);
    const parts = partsByTicket.get(ticketId) || [];
    const { counts, fields } = aggregatePartsForTicket(parts);
    const hasFieldbeatReport = isTrue(ticket.has_fieldbeat_report);

    return {
      ...ticket,
      ...fields,
      data_quality_status: computeDataQualityStatus(hasFieldbeatReport, counts)
    };
  });

  await writeCsv(OUTPUT_VIEW_FILE, outputRows);

  const totalTickets = outputRows.length;
  const ticketsWithFieldbeatReport = outputRows.filter(r => isTrue(r.has_fieldbeat_report)).length;
  const ticketsWithUsedParts = outputRows.filter(r => Number(r.used_parts_count) > 0).length;
  const ticketsWithAllPartsMatched = outputRows.filter(r => r.part_match_quality_status === "ALL_PARTS_MATCHED").length;
  const ticketsWithPlaceholders = outputRows.filter(r => Number(r.placeholder_used_parts_count) > 0).length;
  const ticketsWithUnmatchedParts = outputRows.filter(r => Number(r.unmatched_used_parts_count) > 0).length;
  const ticketsWithAmbiguousParts = outputRows.filter(r => Number(r.ambiguous_used_parts_count) > 0).length;
  const ticketsReviewRequired = outputRows.filter(r => Number(r.review_required_used_parts_count) > 0).length;

  const sumField = fieldName => outputRows.reduce((sum, r) => sum + Number(r[fieldName] || 0), 0);

  const totalUsedParts = sumField("used_parts_count");
  const matchedUsedParts = sumField("matched_used_parts_count");
  const placeholderUsedParts = sumField("placeholder_used_parts_count");
  const unmatchedUsedParts = sumField("unmatched_used_parts_count");
  const ambiguousUsedParts = sumField("ambiguous_used_parts_count");
  const reviewRequiredUsedParts = sumField("review_required_used_parts_count");

  const summary = {
    generated_at: new Date().toISOString(),
    total_tickets: totalTickets,
    tickets_with_fieldbeat_report: ticketsWithFieldbeatReport,
    tickets_without_fieldbeat_report: totalTickets - ticketsWithFieldbeatReport,
    tickets_with_used_parts: ticketsWithUsedParts,
    tickets_without_used_parts: totalTickets - ticketsWithUsedParts,
    tickets_with_all_parts_matched: ticketsWithAllPartsMatched,
    tickets_with_placeholders: ticketsWithPlaceholders,
    tickets_with_unmatched_parts: ticketsWithUnmatchedParts,
    tickets_with_ambiguous_parts: ticketsWithAmbiguousParts,
    tickets_review_required: ticketsReviewRequired,
    total_used_parts: totalUsedParts,
    matched_used_parts: matchedUsedParts,
    placeholder_used_parts: placeholderUsedParts,
    unmatched_used_parts: unmatchedUsedParts,
    ambiguous_used_parts: ambiguousUsedParts,
    match_rate: percent(matchedUsedParts, totalUsedParts),
    review_required_rate: percent(reviewRequiredUsedParts, totalUsedParts)
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log("=== Vista Ticket <-> FieldBeat <-> Dolibarr finalizada ===");
}

buildTicketFieldBeatDolibarrView().catch(error => {
  console.error("ERROR CONSTRUYENDO VISTA TICKET <-> FIELDBEAT <-> DOLIBARR:");
  console.error(error);
  process.exit(1);
});
