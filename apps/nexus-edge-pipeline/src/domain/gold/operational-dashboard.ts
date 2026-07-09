// Constructor GOLD - GOLD_Operational_Dashboard: una sola fila con los
// KPIs globales del negocio (ver GOLD_DATA_CONTRACT.md). Equivalente puro
// de buildOperationalDashboard() en build-gold.js (pipeline local).
//
// PURO: no importa nada de R2/Queues/Cloudflare/D1, no hace I/O.

import { isTrue } from "../marts/lib";
import { num, percent, type TicketFieldBeatDolibarrMartRow } from "./lib";

export interface OperationalDashboardRow extends Record<string, unknown> {
  total_zendesk_tickets: number;
  tickets_with_fieldbeat_report: number;
  tickets_without_fieldbeat_report: number;
  tickets_with_multiple_fieldbeat_reports: number;
  tickets_with_used_parts: number;
  tickets_with_all_parts_matched: number;
  tickets_review_required: number;
  total_used_parts_in_ticket_scope: number;
  matched_used_parts: number;
  placeholder_used_parts: number;
  unmatched_used_parts: number;
  ambiguous_used_parts: number;
  ticket_fieldbeat_coverage_rate: string;
  used_parts_match_rate: string;
  review_required_rate: string;
}

// Una unica pasada O(n) sobre los tickets acumulando los 12 contadores a
// la vez, en vez de 6 recorridos `.filter()` independientes (cada uno
// O(n)) mas otros tantos `.reduce()` de suma - el resultado final es
// identico, pero con una sola constante en vez de ~12.
export function buildOperationalDashboard(ticketRows: TicketFieldBeatDolibarrMartRow[]): OperationalDashboardRow[] {
  const totalTickets = ticketRows.length;

  let ticketsWithFieldbeat = 0;
  let ticketsWithMultiple = 0;
  let ticketsWithUsedParts = 0;
  let ticketsAllMatched = 0;
  let ticketsReviewRequired = 0;
  let totalUsedParts = 0;
  let matchedUsedParts = 0;
  let placeholderUsedParts = 0;
  let unmatchedUsedParts = 0;
  let ambiguousUsedParts = 0;
  let reviewRequiredUsedParts = 0;

  for (const ticket of ticketRows) {
    if (isTrue(ticket.has_fieldbeat_report)) ticketsWithFieldbeat++;
    if (isTrue(ticket.has_multiple_fieldbeat_reports)) ticketsWithMultiple++;

    const usedPartsCount = num(ticket.used_parts_count);
    if (usedPartsCount > 0) ticketsWithUsedParts++;
    if (ticket.part_match_quality_status === "ALL_PARTS_MATCHED") ticketsAllMatched++;

    const reviewRequiredCount = num(ticket.review_required_used_parts_count);
    if (reviewRequiredCount > 0) ticketsReviewRequired++;

    totalUsedParts += usedPartsCount;
    matchedUsedParts += num(ticket.matched_used_parts_count);
    placeholderUsedParts += num(ticket.placeholder_used_parts_count);
    unmatchedUsedParts += num(ticket.unmatched_used_parts_count);
    ambiguousUsedParts += num(ticket.ambiguous_used_parts_count);
    reviewRequiredUsedParts += reviewRequiredCount;
  }

  return [
    {
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
    }
  ];
}
