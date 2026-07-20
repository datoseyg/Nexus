import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDataQualityRow, orderDataQualityRows, isKnownReportQualityStatus } from "../../lib/fieldbeat-data-quality-view.ts";
import type { FieldbeatDataQualityRow } from "../../types/fieldbeat.ts";

// La derivación {label, tone} vía reportQualityBadge() (components/ui/
// StatusBadge.tsx) vive en el componente de presentación, no acá - un
// .tsx con JSX no se puede importar bajo node --test +
// --experimental-strip-types (sin transform de JSX), ni siquiera para una
// función sin JSX que conviva en el mismo módulo. Este archivo solo prueba
// la lógica pura: status crudo, count, percentLabel recalculado, y el
// flag `isKnown` que el componente usa para decidir la rama de badge.

function row(status: string, count: number): FieldbeatDataQualityRow {
  return {
    report_quality_status: status,
    report_count: count,
    percent_of_total_reports: "12.81%",
    used_parts_count: 0,
    matched_used_parts_count: 0,
    placeholder_used_parts_count: 0,
    unmatched_used_parts_count: 0,
    ambiguous_used_parts_count: 0
  };
}

// === isKnownReportQualityStatus ===

test("isKnownReportQualityStatus: true para las 6 categorías canónicas", () => {
  for (const status of ["OK", "NO_USED_PARTS", "HAS_PLACEHOLDERS", "HAS_UNMATCHED_PARTS", "HAS_AMBIGUOUS_PARTS", "REVIEW_REQUIRED"]) {
    assert.equal(isKnownReportQualityStatus(status), true);
  }
});

test("isKnownReportQualityStatus: false para cualquier otro string, nunca lanza", () => {
  assert.equal(isKnownReportQualityStatus("SOME_FUTURE_STATUS"), false);
  assert.equal(isKnownReportQualityStatus(""), false);
});

// === mapDataQualityRow ===

test("mapDataQualityRow: status conocido -> isKnown=true, status crudo conservado", () => {
  const view = mapDataQualityRow(row("OK", 480), 3747);
  assert.equal(view.isKnown, true);
  assert.equal(view.status, "OK");
  assert.equal(view.count, 480);
});

test("mapDataQualityRow: status desconocido -> isKnown=false, nunca lanza, código crudo conservado", () => {
  const view = mapDataQualityRow(row("SOME_FUTURE_STATUS", 5), 1000);
  assert.equal(view.isKnown, false);
  assert.equal(view.status, "SOME_FUTURE_STATUS");
  assert.equal(view.count, 5);
});

test("mapDataQualityRow: percentLabel se recalcula (coma decimal), nunca reutiliza percent_of_total_reports crudo (punto)", () => {
  const view = mapDataQualityRow(row("OK", 480), 3747);
  assert.ok(view.percentLabel.includes(","));
  assert.equal(view.percentLabel.includes("."), false);
});

test("mapDataQualityRow: denominador cero -> percentLabel '-', nunca NaN/Infinity", () => {
  const view = mapDataQualityRow(row("OK", 0), 0);
  assert.equal(view.percentLabel, "-");
});

// === orderDataQualityRows ===

test("orderDataQualityRows: ordena las 6 categorías canónicas en orden fijo, sin importar el orden de llegada", () => {
  const shuffled = [row("REVIEW_REQUIRED", 1), row("OK", 2), row("HAS_AMBIGUOUS_PARTS", 3), row("NO_USED_PARTS", 4), row("HAS_UNMATCHED_PARTS", 5), row("HAS_PLACEHOLDERS", 6)];
  const ordered = orderDataQualityRows(shuffled);
  assert.deepEqual(
    ordered.map(r => r.report_quality_status),
    ["OK", "NO_USED_PARTS", "HAS_PLACEHOLDERS", "HAS_UNMATCHED_PARTS", "HAS_AMBIGUOUS_PARTS", "REVIEW_REQUIRED"]
  );
});

test("orderDataQualityRows: categoría desconocida se ubica después de las 6 canónicas, nunca lanza", () => {
  const rows = [row("SOME_FUTURE_STATUS", 1), row("OK", 2), row("NO_USED_PARTS", 3)];
  const ordered = orderDataQualityRows(rows);
  assert.deepEqual(
    ordered.map(r => r.report_quality_status),
    ["OK", "NO_USED_PARTS", "SOME_FUTURE_STATUS"]
  );
});

test("orderDataQualityRows: no muta el array original", () => {
  const rows = [row("REVIEW_REQUIRED", 1), row("OK", 2)];
  orderDataQualityRows(rows);
  assert.deepEqual(rows.map(r => r.report_quality_status), ["REVIEW_REQUIRED", "OK"]);
});
