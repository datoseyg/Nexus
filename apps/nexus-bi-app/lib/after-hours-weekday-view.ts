// Utilidades puras para los 3 bloques nuevos de ETAPA 6.6D (día de la
// semana, cruce día×hora, técnico×cliente) - relleno de buckets fijos,
// bucketing de intensidad para el heatmap y semántica de "vacío" para
// respuestas que SIEMPRE devuelven un tamaño fijo (7 días, 168 celdas),
// donde `length` nunca sirve como señal de vacío.
import { getConfidenceLabel } from "./confidence";
import { getWeekdayLabel, WEEKDAY_ORDER } from "./after-hours-labels";
import { mapAggregateMetrics, type AggregateMetricsRow } from "./after-hours-metrics";
import type {
  AfterHoursByDimensionRow,
  AfterHoursByWeekdayResponse,
  AfterHoursTechnicianClientResponse,
  AfterHoursWeekdayHourCell,
  AfterHoursWeekdayHourResponse
} from "../types/after-hours";

const HOURS_OF_DAY: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

function emptyDimensionRow(key: string, extra: string | null): AfterHoursByDimensionRow {
  const zeroScore = 0;
  return {
    key,
    extra,
    total_tasks: 0,
    calculable_tasks: 0,
    not_calculable_tasks: 0,
    contractual_tasks: 0,
    legacy_schedule_tasks: 0,
    none_tasks: 0,
    fallback_tasks: 0,
    total_hours: 0,
    business_hours: 0,
    after_hours_total_hours: 0,
    after_hours_rate: 0,
    tasks_total: 0,
    tasks_with_after_hours: 0,
    confidence_score: zeroScore,
    confidence_label: getConfidenceLabel(zeroScore).label,
    average_confidence: null,
    confidence_eligible_tasks: 0,
    confidence_excluded_tasks: 0
  };
}

function emptyWeekdayHourCell(weekday: number, hour: number): AfterHoursWeekdayHourCell {
  const zeroScore = 0;
  return {
    weekday,
    hour,
    total_tasks: 0,
    calculable_tasks: 0,
    not_calculable_tasks: 0,
    contractual_tasks: 0,
    legacy_schedule_tasks: 0,
    none_tasks: 0,
    fallback_tasks: 0,
    total_hours: 0,
    business_hours: 0,
    after_hours_total_hours: 0,
    after_hours_rate: 0,
    tasks_total: 0,
    tasks_with_after_hours: 0,
    confidence_score: zeroScore,
    confidence_label: getConfidenceLabel(zeroScore).label,
    average_confidence: null,
    confidence_eligible_tasks: 0,
    confidence_excluded_tasks: 0
  };
}

/**
 * Rellena a los 7 días fijos (ISODOW 1..7, lunes primero) - un día sin
 * filas reales aparece como fila en cero, nunca se omite. El ORDEN de
 * salida es SIEMPRE lunes->domingo, sin importar el orden de llegada de
 * `rows` (nunca se reordena por valor) - `ORDER BY 1` en el route.ts es
 * cosmético, esta función es la garantía real.
 */
export function padWeekdayRows(rows: AfterHoursByDimensionRow[]): AfterHoursByDimensionRow[] {
  const byKey = new Map(rows.map(r => [r.key, r]));
  return WEEKDAY_ORDER.map(iso => {
    const key = String(iso);
    const existing = byKey.get(key);
    if (existing) return { ...existing, extra: existing.extra ?? getWeekdayLabel(iso) };
    return emptyDimensionRow(key, getWeekdayLabel(iso));
  });
}

/**
 * Rellena a las 168 celdas fijas (7 días x 24 horas), orden row-major
 * (día 1 hora 0..23, día 2 hora 0..23, ...). Identidad por (weekday, hour)
 * - nunca una key concatenada.
 */
export function padWeekdayHourCells(cells: AfterHoursWeekdayHourCell[]): AfterHoursWeekdayHourCell[] {
  const byKey = new Map(cells.map(c => [`${c.weekday}_${c.hour}`, c]));
  const out: AfterHoursWeekdayHourCell[] = [];
  for (const weekday of WEEKDAY_ORDER) {
    for (const hour of HOURS_OF_DAY) {
      out.push(byKey.get(`${weekday}_${hour}`) ?? emptyWeekdayHourCell(weekday, hour));
    }
  }
  return out;
}

// Fila cruda de weekday-hour: misma aritmética de agregado que
// GroupedAggregateQueryRow, pero con identidad propia (weekday/hour como
// columnas numéricas seleccionadas directamente en SQL vía
// EXTRACT(...)::int), nunca una key/extra ficticia.
export interface WeekdayHourQueryRow extends AggregateMetricsRow {
  weekday: number;
  hour_of_day: number;
}

/**
 * Mapea una fila cruda de weekday-hour a AfterHoursWeekdayHourCell,
 * reutilizando la aritmética compartida de mapAggregateMetrics (misma
 * fórmula que mapGroupedRow, sin duplicarla) - nunca concatena/separa
 * weekday+hour de una key de texto.
 */
export function mapWeekdayHourRow(row: WeekdayHourQueryRow): AfterHoursWeekdayHourCell {
  return {
    weekday: row.weekday,
    hour: row.hour_of_day,
    ...mapAggregateMetrics(row)
  };
}

/**
 * Bucket de intensidad de color para el heatmap (0..5) - rampa secuencial
 * de un solo hue (ver --nx-heat-0..5 en globals.css). 0 si no hay datos o
 * si maxValue no es positivo (nunca división por cero ni bucket negativo).
 */
export function heatmapBucket(value: number, maxValue: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (maxValue <= 0 || value <= 0) return 0;
  const ratio = Math.min(1, value / maxValue);
  return Math.min(5, Math.ceil(ratio * 5)) as 0 | 1 | 2 | 3 | 4 | 5;
}

// === Empty state semántico - `length` nunca sirve para by-weekday/
// weekday-hour (siempre 7/168), y technician-client necesita distinguir
// "vacío genuino" de "hay tareas pero excluidas por falta de técnico/
// cliente" (ver AfterHoursTechnicianClientCard, que renderiza ese segundo
// caso con su propio mensaje, nunca como successBlock/emptyBlock genérico). ===

export function isWeekdayResponseEmpty(data: AfterHoursByWeekdayResponse): boolean {
  return data.rows.reduce((sum, r) => sum + r.total_tasks, 0) === 0;
}

export function isWeekdayHourResponseEmpty(data: AfterHoursWeekdayHourResponse): boolean {
  return data.cells.reduce((sum, c) => sum + c.total_tasks, 0) === 0;
}

export function isTechnicianClientResponseEmpty(data: AfterHoursTechnicianClientResponse): boolean {
  return data.rows.length === 0 && data.excludedTasks === 0;
}
