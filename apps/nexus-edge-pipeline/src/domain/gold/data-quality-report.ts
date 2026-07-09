// Constructor GOLD - GOLD_Data_Quality_Report: desglosa los tickets por
// `data_quality_status` (6 categorias fijas, ver GOLD_DATA_CONTRACT.md).
// Equivalente puro de buildDataQualityReport() en build-gold.js.
//
// PURO: no importa nada de R2/Queues/Cloudflare/D1, no hace I/O.

import { num, percent, type TicketFieldBeatDolibarrMartRow } from "./lib";

// Mismas 6 categorias que TicketDataQualityStatus en
// src/domain/marts/ticket-fieldbeat-dolibarr-view.ts - se repiten como
// lista literal (no se importa el tipo) porque acá importa el ORDEN de
// salida del reporte, no solo los valores validos.
const DATA_QUALITY_STATUSES = [
  "OK",
  "NO_FIELDBEAT_REPORT",
  "HAS_PLACEHOLDERS",
  "HAS_UNMATCHED_PARTS",
  "HAS_AMBIGUOUS_PARTS",
  "REVIEW_REQUIRED"
] as const;

export interface DataQualityReportRow extends Record<string, unknown> {
  data_quality_status: string;
  ticket_count: number;
  percent_of_total_tickets: string;
  used_parts_count: number;
  matched_used_parts_count: number;
  placeholder_used_parts_count: number;
  unmatched_used_parts_count: number;
  ambiguous_used_parts_count: number;
}

interface StatusAccumulator {
  ticketCount: number;
  usedPartsCount: number;
  matchedUsedPartsCount: number;
  placeholderUsedPartsCount: number;
  unmatchedUsedPartsCount: number;
  ambiguousUsedPartsCount: number;
}

function emptyAccumulator(): StatusAccumulator {
  return {
    ticketCount: 0,
    usedPartsCount: 0,
    matchedUsedPartsCount: 0,
    placeholderUsedPartsCount: 0,
    unmatchedUsedPartsCount: 0,
    ambiguousUsedPartsCount: 0
  };
}

// Una unica pasada O(n) sobre los tickets, acumulando en un Map por
// `data_quality_status` - reemplaza los 6 recorridos `.filter()`
// (uno por status fijo, cada uno O(n) => O(6n)) del script heredado por
// un unico recorrido O(n). El orden de salida de las 6 filas sigue
// siendo DATA_QUALITY_STATUSES (fijo), no el orden de aparicion en el Map.
export function buildDataQualityReport(ticketRows: TicketFieldBeatDolibarrMartRow[]): DataQualityReportRow[] {
  const totalTickets = ticketRows.length;
  const byStatus = new Map<string, StatusAccumulator>();

  for (const ticket of ticketRows) {
    const status = ticket.data_quality_status;
    const accumulator = byStatus.get(status) ?? emptyAccumulator();

    accumulator.ticketCount += 1;
    accumulator.usedPartsCount += num(ticket.used_parts_count);
    accumulator.matchedUsedPartsCount += num(ticket.matched_used_parts_count);
    accumulator.placeholderUsedPartsCount += num(ticket.placeholder_used_parts_count);
    accumulator.unmatchedUsedPartsCount += num(ticket.unmatched_used_parts_count);
    accumulator.ambiguousUsedPartsCount += num(ticket.ambiguous_used_parts_count);

    byStatus.set(status, accumulator);
  }

  return DATA_QUALITY_STATUSES.map(status => {
    const accumulator = byStatus.get(status) ?? emptyAccumulator();

    return {
      data_quality_status: status,
      ticket_count: accumulator.ticketCount,
      percent_of_total_tickets: percent(accumulator.ticketCount, totalTickets),
      used_parts_count: accumulator.usedPartsCount,
      matched_used_parts_count: accumulator.matchedUsedPartsCount,
      placeholder_used_parts_count: accumulator.placeholderUsedPartsCount,
      unmatched_used_parts_count: accumulator.unmatchedUsedPartsCount,
      ambiguous_used_parts_count: accumulator.ambiguousUsedPartsCount
    };
  });
}
