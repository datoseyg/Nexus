// Constructor GOLD - GOLD_Equipment_Service_Profile: perfil de servicio
// por equipo (ver GOLD_DATA_CONTRACT.md). Equivalente puro de
// buildEquipmentServiceProfile() en build-gold.js. Mismo fan-out que
// client-service-profile.ts, sobre `equipment_internal_ids` en vez de
// `client_names` - ver el comentario ahi para el detalle.
//
// PURO: no importa nada de R2/Queues/Cloudflare/D1, no hace I/O.

import { num, splitPipe, type TicketFieldBeatDolibarrMartRow } from "./lib";

export interface EquipmentServiceProfileRow extends Record<string, unknown> {
  equipment_internal_id: string;
  total_tickets: number;
  fieldbeat_report_count: number;
  tickets_with_used_parts: number;
  used_parts_count: number;
  unmatched_used_parts_count: number;
  ambiguous_used_parts_count: number;
  review_required_tickets: number;
}

interface EquipmentAccumulator {
  totalTickets: number;
  fieldbeatReportCount: number;
  ticketsWithUsedParts: number;
  usedPartsCount: number;
  unmatchedUsedPartsCount: number;
  ambiguousUsedPartsCount: number;
  reviewRequiredTickets: number;
}

function emptyAccumulator(): EquipmentAccumulator {
  return {
    totalTickets: 0,
    fieldbeatReportCount: 0,
    ticketsWithUsedParts: 0,
    usedPartsCount: 0,
    unmatchedUsedPartsCount: 0,
    ambiguousUsedPartsCount: 0,
    reviewRequiredTickets: 0
  };
}

// O(tickets * equipos_por_ticket) = O(total de pares ticket-equipo) - ver
// la misma nota de complejidad en client-service-profile.ts.
export function buildEquipmentServiceProfile(ticketRows: TicketFieldBeatDolibarrMartRow[]): EquipmentServiceProfileRow[] {
  const byEquipment = new Map<string, EquipmentAccumulator>();

  for (const ticket of ticketRows) {
    for (const equipmentId of splitPipe(ticket.equipment_internal_ids)) {
      const accumulator = byEquipment.get(equipmentId) ?? emptyAccumulator();

      accumulator.totalTickets += 1;
      accumulator.fieldbeatReportCount += num(ticket.fieldbeat_report_count);

      const usedPartsCount = num(ticket.used_parts_count);
      if (usedPartsCount > 0) accumulator.ticketsWithUsedParts += 1;
      accumulator.usedPartsCount += usedPartsCount;
      accumulator.unmatchedUsedPartsCount += num(ticket.unmatched_used_parts_count);
      accumulator.ambiguousUsedPartsCount += num(ticket.ambiguous_used_parts_count);
      if (num(ticket.review_required_used_parts_count) > 0) accumulator.reviewRequiredTickets += 1;

      byEquipment.set(equipmentId, accumulator);
    }
  }

  return Array.from(byEquipment.entries())
    .map(([equipmentId, a]) => ({
      equipment_internal_id: equipmentId,
      total_tickets: a.totalTickets,
      fieldbeat_report_count: a.fieldbeatReportCount,
      tickets_with_used_parts: a.ticketsWithUsedParts,
      used_parts_count: a.usedPartsCount,
      unmatched_used_parts_count: a.unmatchedUsedPartsCount,
      ambiguous_used_parts_count: a.ambiguousUsedPartsCount,
      review_required_tickets: a.reviewRequiredTickets
    }))
    .sort((x, y) => y.total_tickets - x.total_tickets);
}
