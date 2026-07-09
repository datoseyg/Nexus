// Constructor MARTS #3 - Ticket_FieldBeat_Dolibarr_Operational_View: une
// el resultado del constructor #2 (Ticket_FieldBeat_Operational_View) con
// el resultado del constructor #1 (Used_Parts_Dolibarr_Match), agregando
// por ticket la calidad de match de sus repuestos. Equivalente puro de
// build-ticket-fieldbeat-dolibarr-view.js (pipeline local).
//
// PURO: no importa nada de R2/Queues/Cloudflare, no hace I/O. No vuelve a
// leer la tabla puente BR_Ticket_FieldBeat_Task directamente: el ticket ya
// trae `fieldbeat_task_ids` (pipe-joined) desde el constructor #2, y con
// eso alcanza para reconstruir task_id -> ticket_id.

import { cleanId, isTrue, uniqueNonEmpty } from "./lib";
import type { TicketFieldBeatOperationalViewRow } from "./ticket-fieldbeat-view";
import type { UsedPartDolibarrMatchRow } from "./used-parts-match";

export type PartMatchQualityStatus =
  | "NO_USED_PARTS"
  | "HAS_AMBIGUOUS_PARTS"
  | "HAS_UNMATCHED_PARTS"
  | "ALL_PARTS_MATCHED"
  | "HAS_PLACEHOLDERS_ONLY"
  | "MIXED_QUALITY";

export type TicketDataQualityStatus =
  | "NO_FIELDBEAT_REPORT"
  | "HAS_AMBIGUOUS_PARTS"
  | "HAS_UNMATCHED_PARTS"
  | "HAS_PLACEHOLDERS"
  | "REVIEW_REQUIRED"
  | "OK";

export interface TicketFieldBeatDolibarrViewRow extends TicketFieldBeatOperationalViewRow {
  used_parts_count: number;
  matched_used_parts_count: number;
  placeholder_used_parts_count: number;
  unmatched_used_parts_count: number;
  ambiguous_used_parts_count: number;
  manual_alias_match_count: number;
  ref_exact_match_count: number;
  ref_like_match_count: number;
  review_required_used_parts_count: number;
  dolibarr_product_ids: string;
  dolibarr_refs: string;
  used_part_numbers: string;
  used_part_names: string;
  part_match_methods: string;
  part_match_statuses: string;
  part_match_quality_status: PartMatchQualityStatus;
  data_quality_status: TicketDataQualityStatus;
}

interface PartCounts {
  total: number;
  matched: number;
  placeholder: number;
  unmatched: number;
  ambiguous: number;
  manualAlias: number;
  refExact: number;
  refLike: number;
  reviewRequired: number;
}

// Cascada por severidad (AMBIGUOUS_MATCH > NO_MATCH > PLACEHOLDER_VALUE >
// MATCHED): las categorias "malas" (ambiguous/unmatched) dominan apenas
// hay una presente; los estados "puros" (ALL_PARTS_MATCHED /
// HAS_PLACEHOLDERS_ONLY) requieren que TODAS las partes sean de ese tipo;
// MIXED_QUALITY es el resto (mezcla de matched + placeholder, sin nada
// peor).
function computePartMatchQualityStatus(counts: PartCounts): PartMatchQualityStatus {
  if (counts.total === 0) return "NO_USED_PARTS";
  if (counts.ambiguous > 0) return "HAS_AMBIGUOUS_PARTS";
  if (counts.unmatched > 0) return "HAS_UNMATCHED_PARTS";
  if (counts.matched === counts.total) return "ALL_PARTS_MATCHED";
  if (counts.placeholder === counts.total) return "HAS_PLACEHOLDERS_ONLY";
  return "MIXED_QUALITY";
}

// REVIEW_REQUIRED cubre el caso de partes en estado MATCHED pero de baja
// confianza (REF_LIKE), que no encaja en ninguna otra categoria pero igual
// necesita revision humana.
function computeDataQualityStatus(hasFieldbeatReport: boolean, counts: PartCounts): TicketDataQualityStatus {
  if (!hasFieldbeatReport) return "NO_FIELDBEAT_REPORT";
  if (counts.ambiguous > 0) return "HAS_AMBIGUOUS_PARTS";
  if (counts.unmatched > 0) return "HAS_UNMATCHED_PARTS";
  if (counts.placeholder > 0) return "HAS_PLACEHOLDERS";
  if (counts.reviewRequired > 0) return "REVIEW_REQUIRED";
  return "OK";
}

function aggregatePartsForTicket(parts: UsedPartDolibarrMatchRow[]): {
  counts: PartCounts;
  fields: Record<string, unknown>;
} {
  const counts: PartCounts = {
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

function buildTaskToTicketMap(tickets: TicketFieldBeatOperationalViewRow[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const ticket of tickets) {
    const ticketId = cleanId(ticket.zendesk_ticket_id);
    const taskIds = String(ticket.fieldbeat_task_ids || "")
      .split("|")
      .map(cleanId)
      .filter(Boolean);

    for (const taskId of taskIds) map.set(taskId, ticketId);
  }

  return map;
}

function groupPartsByTicket(
  usedPartRows: UsedPartDolibarrMatchRow[],
  taskToTicket: Map<string, string>
): Map<string, UsedPartDolibarrMatchRow[]> {
  const map = new Map<string, UsedPartDolibarrMatchRow[]>();

  for (const row of usedPartRows) {
    const ticketId = taskToTicket.get(cleanId(row.fieldbeat_task_id));
    if (!ticketId) continue;

    const bucket = map.get(ticketId);
    if (bucket) bucket.push(row);
    else map.set(ticketId, [row]);
  }

  return map;
}

// Dos pasadas O(n) en total (n = tickets + repuestos matcheados), sin
// ciclo anidado: buildTaskToTicketMap y groupPartsByTicket construyen sus
// Maps en una unica pasada cada uno, y el `.map()` final por ticket hace
// UN lookup O(1) contra `partsByTicket` en vez de filtrar el array
// completo de repuestos por cada ticket.
export function buildTicketFieldBeatDolibarrView(
  tickets: TicketFieldBeatOperationalViewRow[],
  usedPartMatches: UsedPartDolibarrMatchRow[]
): TicketFieldBeatDolibarrViewRow[] {
  const taskToTicket = buildTaskToTicketMap(tickets);
  const partsByTicket = groupPartsByTicket(usedPartMatches, taskToTicket);

  return tickets.map(ticket => {
    const ticketId = cleanId(ticket.zendesk_ticket_id);
    const parts = partsByTicket.get(ticketId) || [];
    const { counts, fields } = aggregatePartsForTicket(parts);
    const hasFieldbeatReport = isTrue(ticket.has_fieldbeat_report);

    return {
      ...ticket,
      ...fields,
      data_quality_status: computeDataQualityStatus(hasFieldbeatReport, counts)
    } as TicketFieldBeatDolibarrViewRow;
  });
}
