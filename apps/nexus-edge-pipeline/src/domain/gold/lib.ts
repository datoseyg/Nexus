// Utilidades y contratos de entrada compartidos entre los constructores
// GOLD (operational-dashboard.ts, data-quality-report.ts,
// client-service-profile.ts, equipment-service-profile.ts,
// used-parts-analysis.ts). Sin I/O, sin estado.
//
// Los contratos de entrada (*MartRow) describen la forma de una fila tal
// cual sale de leer un CSV de MARTS con readCsv() (ver
// src/use-cases/build-gold.ts) - todos los campos son string, igual que
// los *SourceRow de src/domain/marts/*.ts describen PROCESSED. GOLD no
// recibe los objetos en memoria que produjo build-marts.ts directamente
// (a diferencia de como ticket-fieldbeat-dolibarr-view.ts encadena con
// ticket-fieldbeat-view.ts dentro de la misma corrida) - GOLD se dispara
// por un evento de cola distinto (gold-queue) y siempre relee MARTS desde
// R2, así que su contrato de entrada es, correctamente, el de un CSV.

export function num(value: unknown): number {
  return Number(value || 0);
}

export function percent(numerator: number, denominator: number): string {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

export function splitPipe(value: unknown): string[] {
  return String(value ?? "")
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
}

// Forma de una fila de Ticket_FieldBeat_Dolibarr_Operational_View.csv
// (MARTS #3, ver src/domain/marts/ticket-fieldbeat-dolibarr-view.ts) -
// solo las columnas que los constructores GOLD ticket-centricos
// necesitan.
export interface TicketFieldBeatDolibarrMartRow extends Record<string, string> {
  zendesk_ticket_id: string;
  has_fieldbeat_report: string;
  has_multiple_fieldbeat_reports: string;
  fieldbeat_report_count: string;
  client_names: string;
  equipment_internal_ids: string;
  used_parts_count: string;
  matched_used_parts_count: string;
  placeholder_used_parts_count: string;
  unmatched_used_parts_count: string;
  ambiguous_used_parts_count: string;
  review_required_used_parts_count: string;
  part_match_quality_status: string;
  data_quality_status: string;
}

// Forma de una fila de Used_Parts_Dolibarr_Match.csv (MARTS #1, ver
// src/domain/marts/used-parts-match.ts) - catalogo GLOBAL de repuestos
// (no acotado al alcance de tickets Zendesk), consumido solo por
// used-parts-analysis.ts.
export interface UsedPartsMatchMartRow extends Record<string, string> {
  raw_part_identifier: string;
  normalized_part_identifier: string;
  part_name: string;
  dolibarr_ref: string;
  dolibarr_product_id: string;
  match_status: string;
  match_method: string;
  needs_manual_review: string;
}
