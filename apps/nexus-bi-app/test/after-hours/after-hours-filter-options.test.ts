import { test } from "node:test";
import assert from "node:assert/strict";
import { optionKeysAsc } from "../../lib/after-hours-filter-options.ts";
import type { AfterHoursByDimensionRow } from "../../types/after-hours.ts";

function row(key: string): AfterHoursByDimensionRow {
  return {
    key,
    extra: null,
    total_tasks: 1,
    calculable_tasks: 1,
    not_calculable_tasks: 0,
    contractual_tasks: 0,
    legacy_schedule_tasks: 1,
    none_tasks: 0,
    fallback_tasks: 0,
    total_hours: 1,
    business_hours: 1,
    after_hours_total_hours: 0,
    after_hours_rate: 0,
    tasks_total: 1,
    tasks_with_after_hours: 0,
    confidence_score: 90,
    confidence_label: "Alta",
    average_confidence: 90,
    confidence_eligible_tasks: 1,
    confidence_excluded_tasks: 0
  };
}

test("optionKeysAsc: null/undefined -> [] (nunca explota mientras la sección aún está cargando)", () => {
  assert.deepEqual(optionKeysAsc(null), []);
  assert.deepEqual(optionKeysAsc(undefined), []);
});

test("optionKeysAsc: [] -> [] (0 técnicos/clientes bajo el filtro activo - Caso B del encargo)", () => {
  assert.deepEqual(optionKeysAsc([]), []);
});

test("optionKeysAsc: ordena alfabéticamente, no por el orden de llegada (after_hours_minutes DESC en el endpoint)", () => {
  const rows = [row("tech2"), row("tech1"), row("tech3")];
  assert.deepEqual(optionKeysAsc(rows), ["tech1", "tech2", "tech3"]);
});

test("optionKeysAsc: no muta el array original", () => {
  const rows = [row("b"), row("a")];
  optionKeysAsc(rows);
  assert.deepEqual(rows.map(r => r.key), ["b", "a"]);
});
