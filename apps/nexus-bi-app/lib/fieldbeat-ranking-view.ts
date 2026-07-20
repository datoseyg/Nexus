import { formatNumberEsCl } from "./dashboard-formatters";
import type { FieldbeatClientPartsRow, FieldbeatClientReportRow, FieldbeatEquipmentPartsRow } from "@/types/fieldbeat";

// ETAPA 5 - mapeo de las 3 filas de ranking reales a una forma común de
// presentación. NUNCA reordena - los 3 endpoints (by-client de reportes,
// by-client de repuestos, top equipos) ya entregan `ORDER BY ... DESC` sin
// desempate secundario; este módulo preserva el orden de entrada tal cual
// (ver test dedicado - Postgres no garantiza orden estable entre valores
// empatados, así que ni acá ni en los tests se afirma un orden
// determinista *entre* filas empatadas).
export interface FieldbeatRankingRow {
  key: string;
  value: number;
  valueLabel: string;
}

function toRow(key: string, value: number): FieldbeatRankingRow {
  return { key, value, valueLabel: formatNumberEsCl(value) };
}

export function toClientReportRankingRows(rows: FieldbeatClientReportRow[]): FieldbeatRankingRow[] {
  return rows.map(r => toRow(r.client_name, r.total_reports));
}

export function toClientPartsRankingRows(rows: FieldbeatClientPartsRow[]): FieldbeatRankingRow[] {
  return rows.map(r => toRow(r.client_name, r.used_parts_count));
}

export function toEquipmentPartsRankingRows(rows: FieldbeatEquipmentPartsRow[]): FieldbeatRankingRow[] {
  return rows.map(r => toRow(r.equipment_internal_id, r.used_parts_count));
}
