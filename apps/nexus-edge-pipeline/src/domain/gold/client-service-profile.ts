// Constructor GOLD - GOLD_Client_Service_Profile: perfil de servicio por
// cliente (ver GOLD_DATA_CONTRACT.md). Equivalente puro de
// buildClientServiceProfile() en build-gold.js.
//
// PURO: no importa nada de R2/Queues/Cloudflare/D1, no hace I/O.
//
// Fan-out: `client_names` viene pipe-joined por ticket (un ticket puede
// aportar a mas de un cliente si tuvo reportes FieldBeat de clientes
// distintos). Cada ticket se cuenta una vez POR CADA cliente que menciona
// - por diseño, no es un bug: la granularidad de salida es
// (cliente, metricas), no (ticket, metricas).

import { isTrue } from "../marts/lib";
import { num, splitPipe, type TicketFieldBeatDolibarrMartRow } from "./lib";

export interface ClientServiceProfileRow extends Record<string, unknown> {
  client_name: string;
  total_tickets: number;
  tickets_with_fieldbeat: number;
  fieldbeat_report_count: number;
  tickets_with_multiple_fieldbeat_reports: number;
  tickets_with_used_parts: number;
  used_parts_count: number;
  matched_used_parts_count: number;
  placeholder_used_parts_count: number;
  unmatched_used_parts_count: number;
  ambiguous_used_parts_count: number;
  review_required_tickets: number;
}

interface ClientAccumulator {
  totalTickets: number;
  ticketsWithFieldbeat: number;
  fieldbeatReportCount: number;
  ticketsWithMultipleFieldbeatReports: number;
  ticketsWithUsedParts: number;
  usedPartsCount: number;
  matchedUsedPartsCount: number;
  placeholderUsedPartsCount: number;
  unmatchedUsedPartsCount: number;
  ambiguousUsedPartsCount: number;
  reviewRequiredTickets: number;
}

function emptyAccumulator(): ClientAccumulator {
  return {
    totalTickets: 0,
    ticketsWithFieldbeat: 0,
    fieldbeatReportCount: 0,
    ticketsWithMultipleFieldbeatReports: 0,
    ticketsWithUsedParts: 0,
    usedPartsCount: 0,
    matchedUsedPartsCount: 0,
    placeholderUsedPartsCount: 0,
    unmatchedUsedPartsCount: 0,
    ambiguousUsedPartsCount: 0,
    reviewRequiredTickets: 0
  };
}

// O(tickets * clientes_por_ticket) = O(total de pares ticket-cliente) -
// el fan-out en si mismo define ese piso, no hay forma de agrupar sin
// visitar cada par al menos una vez. Un unico Map<cliente, acumulador>
// construido en una pasada, sin ciclo anidado sobre el array completo de
// tickets por cada cliente.
export function buildClientServiceProfile(ticketRows: TicketFieldBeatDolibarrMartRow[]): ClientServiceProfileRow[] {
  const byClient = new Map<string, ClientAccumulator>();

  for (const ticket of ticketRows) {
    for (const clientName of splitPipe(ticket.client_names)) {
      const accumulator = byClient.get(clientName) ?? emptyAccumulator();

      accumulator.totalTickets += 1;
      if (isTrue(ticket.has_fieldbeat_report)) accumulator.ticketsWithFieldbeat += 1;
      accumulator.fieldbeatReportCount += num(ticket.fieldbeat_report_count);
      if (isTrue(ticket.has_multiple_fieldbeat_reports)) accumulator.ticketsWithMultipleFieldbeatReports += 1;

      const usedPartsCount = num(ticket.used_parts_count);
      if (usedPartsCount > 0) accumulator.ticketsWithUsedParts += 1;
      accumulator.usedPartsCount += usedPartsCount;
      accumulator.matchedUsedPartsCount += num(ticket.matched_used_parts_count);
      accumulator.placeholderUsedPartsCount += num(ticket.placeholder_used_parts_count);
      accumulator.unmatchedUsedPartsCount += num(ticket.unmatched_used_parts_count);
      accumulator.ambiguousUsedPartsCount += num(ticket.ambiguous_used_parts_count);
      if (num(ticket.review_required_used_parts_count) > 0) accumulator.reviewRequiredTickets += 1;

      byClient.set(clientName, accumulator);
    }
  }

  return Array.from(byClient.entries())
    .map(([clientName, a]) => ({
      client_name: clientName,
      total_tickets: a.totalTickets,
      tickets_with_fieldbeat: a.ticketsWithFieldbeat,
      fieldbeat_report_count: a.fieldbeatReportCount,
      tickets_with_multiple_fieldbeat_reports: a.ticketsWithMultipleFieldbeatReports,
      tickets_with_used_parts: a.ticketsWithUsedParts,
      used_parts_count: a.usedPartsCount,
      matched_used_parts_count: a.matchedUsedPartsCount,
      placeholder_used_parts_count: a.placeholderUsedPartsCount,
      unmatched_used_parts_count: a.unmatchedUsedPartsCount,
      ambiguous_used_parts_count: a.ambiguousUsedPartsCount,
      review_required_tickets: a.reviewRequiredTickets
    }))
    .sort((x, y) => y.total_tickets - x.total_tickets);
}
