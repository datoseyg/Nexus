import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heatmapBucket,
  isTechnicianClientResponseEmpty,
  isWeekdayHourResponseEmpty,
  isWeekdayResponseEmpty,
  mapWeekdayHourRow,
  padWeekdayHourCells,
  padWeekdayRows
} from "../../lib/after-hours-weekday-view.ts";
import type { AfterHoursByDimensionRow, AfterHoursWeekdayHourCell } from "../../types/after-hours.ts";

function dimRow(key: string, totalTasks: number, overrides: Partial<AfterHoursByDimensionRow> = {}): AfterHoursByDimensionRow {
  return {
    key,
    extra: null,
    total_tasks: totalTasks,
    calculable_tasks: totalTasks,
    not_calculable_tasks: 0,
    contractual_tasks: 0,
    legacy_schedule_tasks: totalTasks,
    none_tasks: 0,
    fallback_tasks: 0,
    total_hours: totalTasks,
    business_hours: totalTasks,
    after_hours_total_hours: 1,
    after_hours_rate: 0.5,
    tasks_total: totalTasks,
    tasks_with_after_hours: 1,
    confidence_score: 80,
    confidence_label: "Media",
    average_confidence: 80,
    confidence_eligible_tasks: totalTasks,
    confidence_excluded_tasks: 0,
    ...overrides
  };
}

function weekdayHourQueryRow(weekday: number, hour: number, totalTasks: number) {
  return {
    weekday,
    hour_of_day: hour,
    total_tasks: String(totalTasks),
    calculable_tasks: String(totalTasks),
    not_calculable_tasks: "0",
    contractual_tasks: "0",
    legacy_schedule_tasks: String(totalTasks),
    none_tasks: "0",
    fallback_tasks: "0",
    total_minutes: String(totalTasks * 60),
    business_minutes: String(totalTasks * 60),
    after_hours_minutes: "60",
    tasks_with_after_hours: "1",
    confidence_weighted: "80",
    confidence_eligible_tasks: String(totalTasks),
    confidence_excluded_tasks: "0"
  };
}

// === padWeekdayRows ===

test("padWeekdayRows: siempre devuelve 7 filas en orden lunes->domingo, sin importar el orden/parcialidad de entrada", () => {
  const input = [dimRow("3", 5), dimRow("1", 2)];
  const padded = padWeekdayRows(input);
  assert.equal(padded.length, 7);
  assert.deepEqual(padded.map(r => r.key), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("padWeekdayRows: días faltantes se rellenan con fila en cero, nunca se omiten", () => {
  const padded = padWeekdayRows([dimRow("1", 10)]);
  const tuesday = padded.find(r => r.key === "2")!;
  assert.equal(tuesday.total_tasks, 0);
  assert.equal(tuesday.after_hours_rate, 0);
});

test("padWeekdayRows: fila real conserva sus valores tal cual (no se recalculan)", () => {
  const padded = padWeekdayRows([dimRow("5", 42)]);
  const friday = padded.find(r => r.key === "5")!;
  assert.equal(friday.total_tasks, 42);
});

test("padWeekdayRows: nunca reordena por valor - el orden es SIEMPRE 1..7 aunque las filas de entrada vengan en cualquier orden o con valores altos primero", () => {
  const padded = padWeekdayRows([dimRow("7", 999), dimRow("2", 1)]);
  assert.deepEqual(padded.map(r => r.key), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("padWeekdayRows: entrada vacía -> 7 filas en cero", () => {
  const padded = padWeekdayRows([]);
  assert.equal(padded.length, 7);
  assert.ok(padded.every(r => r.total_tasks === 0));
});

// === padWeekdayHourCells ===

test("padWeekdayHourCells: siempre devuelve 168 celdas (7x24) en orden row-major", () => {
  const padded = padWeekdayHourCells([]);
  assert.equal(padded.length, 168);
  assert.equal(padded[0].weekday, 1);
  assert.equal(padded[0].hour, 0);
  assert.equal(padded[23].weekday, 1);
  assert.equal(padded[23].hour, 23);
  assert.equal(padded[24].weekday, 2);
  assert.equal(padded[24].hour, 0);
  assert.equal(padded[167].weekday, 7);
  assert.equal(padded[167].hour, 23);
});

test("padWeekdayHourCells: celda real conserva sus valores, celdas faltantes quedan en cero", () => {
  const cell = mapWeekdayHourRow(weekdayHourQueryRow(3, 14, 12));
  const padded = padWeekdayHourCells([cell]);
  const found = padded.find(c => c.weekday === 3 && c.hour === 14)!;
  assert.equal(found.total_tasks, 12);
  const other = padded.find(c => c.weekday === 1 && c.hour === 0)!;
  assert.equal(other.total_tasks, 0);
});

// === mapWeekdayHourRow ===

test("mapWeekdayHourRow: nunca codifica weekday/hour en una key concatenada - son columnas propias", () => {
  const cell: AfterHoursWeekdayHourCell = mapWeekdayHourRow(weekdayHourQueryRow(5, 9, 3));
  assert.equal(cell.weekday, 5);
  assert.equal(cell.hour, 9);
  assert.equal("key" in cell, false);
  assert.equal("extra" in cell, false);
});

test("mapWeekdayHourRow: reutiliza la misma aritmética que mapAggregateMetrics (horas, tasa, confianza)", () => {
  const cell = mapWeekdayHourRow(weekdayHourQueryRow(2, 20, 4));
  assert.equal(cell.total_hours, 4); // 240 min / 60
  assert.equal(cell.after_hours_total_hours, 1); // 60 min / 60
  assert.equal(cell.after_hours_rate, 60 / 240);
});

// === heatmapBucket ===

test("heatmapBucket: 0 en value=0 o maxValue<=0", () => {
  assert.equal(heatmapBucket(0, 10), 0);
  assert.equal(heatmapBucket(5, 0), 0);
  assert.equal(heatmapBucket(5, -1), 0);
});

test("heatmapBucket: 5 (máximo) en value=maxValue", () => {
  assert.equal(heatmapBucket(10, 10), 5);
});

test("heatmapBucket: nunca fuera de [0,5]", () => {
  for (const v of [0, 1, 2, 5, 8, 9, 10, 100]) {
    const b = heatmapBucket(v, 10);
    assert.ok(b >= 0 && b <= 5, `bucket ${b} fuera de rango para value=${v}`);
  }
});

// === empty state semántico ===

test("isWeekdayResponseEmpty: true solo si la SUMA de total_tasks es 0, nunca por rows.length (siempre 7)", () => {
  assert.equal(isWeekdayResponseEmpty({ rows: padWeekdayRows([]), tasksWithoutDate: 0, aggregationUniverseTotal: 0 }), true);
  assert.equal(isWeekdayResponseEmpty({ rows: padWeekdayRows([dimRow("1", 5)]), tasksWithoutDate: 0, aggregationUniverseTotal: 5 }), false);
});

test("isWeekdayHourResponseEmpty: true solo si la SUMA de total_tasks es 0, nunca por cells.length (siempre 168)", () => {
  assert.equal(isWeekdayHourResponseEmpty({ cells: padWeekdayHourCells([]), tasksWithoutDate: 0, aggregationUniverseTotal: 0 }), true);
  const withData = padWeekdayHourCells([mapWeekdayHourRow(weekdayHourQueryRow(1, 0, 3))]);
  assert.equal(isWeekdayHourResponseEmpty({ cells: withData, tasksWithoutDate: 0, aggregationUniverseTotal: 3 }), false);
});

test("isTechnicianClientResponseEmpty: rows=0 y excludedTasks=0 -> vacío genuino", () => {
  assert.equal(isTechnicianClientResponseEmpty({ rows: [], excludedTasks: 0, aggregationUniverseTotal: 0 }), true);
});

test("isTechnicianClientResponseEmpty: rows=0 pero excludedTasks>0 -> NO es vacío (estado parcial explicativo, no genérico)", () => {
  assert.equal(isTechnicianClientResponseEmpty({ rows: [], excludedTasks: 7, aggregationUniverseTotal: 7 }), false);
});

test("isTechnicianClientResponseEmpty: rows>0 -> nunca vacío", () => {
  assert.equal(isTechnicianClientResponseEmpty({ rows: [dimRow("tech1", 5)], excludedTasks: 0, aggregationUniverseTotal: 5 }), false);
});
