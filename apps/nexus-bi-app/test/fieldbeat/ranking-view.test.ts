import { test } from "node:test";
import assert from "node:assert/strict";
import { toClientReportRankingRows, toClientPartsRankingRows, toEquipmentPartsRankingRows } from "../../lib/fieldbeat-ranking-view.ts";

test("toClientReportRankingRows: mapea client_name/total_reports a key/value", () => {
  const rows = toClientReportRankingRows([{ client_name: "Cliente A", total_reports: 10 }]);
  assert.equal(rows[0].key, "Cliente A");
  assert.equal(rows[0].value, 10);
  assert.equal(rows[0].valueLabel, "10");
});

test("toClientPartsRankingRows: mapea client_name/used_parts_count a key/value", () => {
  const rows = toClientPartsRankingRows([{ client_name: "Cliente B", used_parts_count: 5 }]);
  assert.equal(rows[0].key, "Cliente B");
  assert.equal(rows[0].value, 5);
});

test("toEquipmentPartsRankingRows: mapea equipment_internal_id/used_parts_count a key/value", () => {
  const rows = toEquipmentPartsRankingRows([{ equipment_internal_id: "EQ-1", used_parts_count: 3 }]);
  assert.equal(rows[0].key, "EQ-1");
  assert.equal(rows[0].value, 3);
});

test("las 3 funciones devuelven [] para un array vacío", () => {
  assert.deepEqual(toClientReportRankingRows([]), []);
  assert.deepEqual(toClientPartsRankingRows([]), []);
  assert.deepEqual(toEquipmentPartsRankingRows([]), []);
});

test("nunca reordena - el orden de salida es EXACTAMENTE el de entrada, aunque no esté ordenado por valor (los 3 endpoints no tienen desempate secundario)", () => {
  const rows = toClientReportRankingRows([
    { client_name: "Z-bajo", total_reports: 1 },
    { client_name: "A-alto", total_reports: 100 },
    { client_name: "M-medio", total_reports: 50 }
  ]);
  assert.deepEqual(
    rows.map(r => r.key),
    ["Z-bajo", "A-alto", "M-medio"] // preserva el orden de llegada, no reordena por value
  );
});
