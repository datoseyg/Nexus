import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toClientActivityRankingRows,
  toEquipmentActivityRankingRows,
  toEvolutionRankingRows,
  toTaskTypeRankingRows
} from "../../lib/fieldbeat-activity-view.ts";

test("toEvolutionRankingRows: mapea periodo/cantidad y formatea el período (YYYY-MM -> 'mmm YYYY')", () => {
  const rows = toEvolutionRankingRows([{ periodo: "2026-03", cantidad: 42 }]);
  assert.equal(rows[0].value, 42);
  assert.match(rows[0].key, /2026/);
});

test("toTaskTypeRankingRows: mapea task_type/cantidad a key/value tal cual (sin reordenar)", () => {
  const rows = toTaskTypeRankingRows([
    { task_type: "CORRECTIVA", cantidad: 10 },
    { task_type: "PREVENTIVA", cantidad: 5 }
  ]);
  assert.deepEqual(rows.map(r => r.key), ["CORRECTIVA", "PREVENTIVA"]);
  assert.deepEqual(rows.map(r => r.value), [10, 5]);
});

test("toClientActivityRankingRows: mapea cliente/cantidad", () => {
  const rows = toClientActivityRankingRows([{ cliente: "ACME", cantidad: 7 }]);
  assert.equal(rows[0].key, "ACME");
  assert.equal(rows[0].value, 7);
});

test("toEquipmentActivityRankingRows: mapea equipment_internal_id/cantidad", () => {
  const rows = toEquipmentActivityRankingRows([{ equipment_internal_id: "EQ-1", cantidad: 3 }]);
  assert.equal(rows[0].key, "EQ-1");
  assert.equal(rows[0].value, 3);
});

test("las 4 funciones devuelven [] para un array vacío", () => {
  assert.deepEqual(toEvolutionRankingRows([]), []);
  assert.deepEqual(toTaskTypeRankingRows([]), []);
  assert.deepEqual(toClientActivityRankingRows([]), []);
  assert.deepEqual(toEquipmentActivityRankingRows([]), []);
});
