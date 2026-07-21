import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRows, isEquipmentRow, isErroredRow } from "../../src/contracts/row-classifier.js";

function makeRow(cliente, equipo, extraCols = 14) {
  const row = new Array(3 + extraCols).fill("");
  row[0] = cliente;
  row[2] = equipo;
  return row;
}

test("isEquipmentRow: true solo si Cliente y Equipo son ambos no vacíos", () => {
  assert.equal(isEquipmentRow(makeRow("Cliente X", "Modelo Y")), true);
  assert.equal(isEquipmentRow(makeRow("Cliente X", "")), false);
  assert.equal(isEquipmentRow(makeRow("", "Modelo Y")), false);
  assert.equal(isEquipmentRow(makeRow("", "")), false);
  assert.equal(isEquipmentRow(makeRow("  ", "  ")), false);
});

test("isErroredRow: fila con menos columnas que el mínimo esperado", () => {
  assert.equal(isErroredRow(["a", "b"]), true);
  assert.equal(isErroredRow(makeRow("a", "b")), false);
  assert.equal(isErroredRow(null), true);
  assert.equal(isErroredRow(undefined), true);
});

test("classifyRows: separa equipmentRows/ignoredRows/erroredRows (nunca rejectedRows)", () => {
  const rows = [
    makeRow("Cliente A", "Modelo 1"),
    makeRow("", ""),
    makeRow("Cliente B", "Modelo 2"),
    ["solo", "dos"] // fila errorada (menos columnas del mínimo)
  ];

  const result = classifyRows(rows);
  assert.equal(result.equipmentRows.length, 2);
  assert.equal(result.ignoredRows.length, 1);
  assert.equal(result.erroredRows.length, 1);
  assert.equal("rejectedRows" in result, false);

  // Invariante rows_read = accepted + ignored + errored.
  assert.equal(rows.length, result.equipmentRows.length + result.ignoredRows.length + result.erroredRows.length);

  assert.equal(result.equipmentRows[0].sourceRowNumber, 1);
  assert.equal(result.equipmentRows[1].sourceRowNumber, 3);
  assert.match(result.ignoredRows[0].reason, /auxiliar/);
  assert.match(result.erroredRows[0].reason, /columnas/);
});
