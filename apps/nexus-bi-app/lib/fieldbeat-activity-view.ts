import { formatNumberEsCl } from "./dashboard-formatters";
import type { FieldbeatActivityRankingRow, FieldbeatEquipmentActivityRow, FieldbeatEvolutionRow, FieldbeatTaskTypeRow } from "@/types/fieldbeat";
import type { FieldbeatRankingRow } from "./fieldbeat-ranking-view";
import { formatPeriodLabel } from "./dashboard-formatters";

// ETAPA 6 - mismo criterio que lib/fieldbeat-ranking-view.ts: nunca
// reordena, solo mapea a la forma común FieldbeatRankingRow que ya
// consume FieldbeatRankingCard. El orden lo decide siempre la query SQL
// (app/api/dashboard/fieldbeat/activity/route.ts).
function toRow(key: string, value: number): FieldbeatRankingRow {
  return { key, value, valueLabel: formatNumberEsCl(value) };
}

export function toEvolutionRankingRows(rows: FieldbeatEvolutionRow[]): FieldbeatRankingRow[] {
  return rows.map(r => toRow(formatPeriodLabel(r.periodo), r.cantidad));
}

export function toTaskTypeRankingRows(rows: FieldbeatTaskTypeRow[]): FieldbeatRankingRow[] {
  return rows.map(r => toRow(r.task_type, r.cantidad));
}

export function toClientActivityRankingRows(rows: FieldbeatActivityRankingRow[]): FieldbeatRankingRow[] {
  return rows.map(r => toRow(r.cliente, r.cantidad));
}

export function toEquipmentActivityRankingRows(rows: FieldbeatEquipmentActivityRow[]): FieldbeatRankingRow[] {
  return rows.map(r => toRow(r.equipment_internal_id, r.cantidad));
}
