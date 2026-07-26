import { test } from "node:test";
import assert from "node:assert/strict";
import { pivotCrossing, type CrossingPair } from "../../lib/fieldbeat-crossings-queries.ts";

test("pivota pares simples a filas/columnas/celdas", () => {
  const pairs: CrossingPair[] = [
    { rowKey: "PM", colKey: "Técnico", count: 3 },
    { rowKey: "PM", colKey: "Cliente", count: 1 },
    { rowKey: "CM", colKey: "Técnico", count: 2 }
  ];
  const result = pivotCrossing(pairs);
  assert.deepEqual(result.rows.sort(), ["CM", "PM"]);
  assert.deepEqual(result.cols.sort(), ["Cliente", "Técnico"]);
  assert.equal(result.grandTotal, 6);
  assert.equal(result.aggregated, false);
  assert.equal(result.totalRows, 2);
  assert.equal(result.totalCols, 2);
  assert.equal(result.shownRows, 2);
  assert.equal(result.shownCols, 2);
});

test("row/col keys con ESPACIOS se reconstruyen correctamente (regresión: bug de split(\" \"))", () => {
  const pairs: CrossingPair[] = [
    { rowKey: "Juan Pérez Soto", colKey: "TICKET_REPORTED_INACCESSIBLE", count: 4 },
    { rowKey: "Cliente Fixture Phase2", colKey: "PART_NO_MATCH", count: 2 }
  ];
  const result = pivotCrossing(pairs);
  const cellJuan = result.cells.find(c => c.row === "Juan Pérez Soto");
  const cellCliente = result.cells.find(c => c.row === "Cliente Fixture Phase2");
  assert.ok(cellJuan, "la fila con espacios debe existir intacta, no partida");
  assert.equal(cellJuan?.count, 4);
  assert.ok(cellCliente);
  assert.equal(cellCliente?.count, 2);
});

test("límite de FILAS: más de 15 se agrupan bajo Otros, sin perder el total", () => {
  const pairs: CrossingPair[] = Array.from({ length: 20 }, (_, i) => ({
    rowKey: `Técnico ${i}`,
    colKey: "Completo",
    count: 1
  }));
  const result = pivotCrossing(pairs);
  assert.equal(result.aggregated, true);
  assert.equal(result.totalRows, 20);
  assert.equal(result.shownRows, 16); // 15 + "Otros"
  assert.ok(result.rows.includes("Otros"));
  assert.equal(result.rowTotals["Otros"], 5); // 20 - 15
  assert.equal(result.grandTotal, 20);
  const sumOfRowTotals = Object.values(result.rowTotals).reduce((a, b) => a + b, 0);
  assert.equal(sumOfRowTotals, result.grandTotal, "la suma de rowTotals nunca debe perder conteo al truncar");
});

test("límite de COLUMNAS: más de 12 se agrupan bajo Otras, sin perder el total (regresión Phase 3 reapertura §5)", () => {
  const pairs: CrossingPair[] = Array.from({ length: 15 }, (_, i) => ({
    rowKey: "Equipo-1",
    colKey: `CODE_${i}`,
    count: 1
  }));
  const result = pivotCrossing(pairs);
  assert.equal(result.aggregated, true);
  assert.equal(result.totalCols, 15);
  assert.equal(result.shownCols, 13); // 12 + "Otras"
  assert.ok(result.cols.includes("Otras"));
  assert.equal(result.colTotals["Otras"], 3); // 15 - 12
  const sumOfColTotals = Object.values(result.colTotals).reduce((a, b) => a + b, 0);
  assert.equal(sumOfColTotals, result.grandTotal);
});

test("cardinalidad alta en AMBOS ejes simultáneamente: payload final sigue acotado (<=16 filas x <=13 columnas)", () => {
  const pairs: CrossingPair[] = [];
  for (let r = 0; r < 25; r++) {
    for (let c = 0; c < 20; c++) {
      pairs.push({ rowKey: `Equipo-${r}`, colKey: `CODE_${c}`, count: 1 });
    }
  }
  const result = pivotCrossing(pairs);
  assert.equal(result.totalRows, 25);
  assert.equal(result.totalCols, 20);
  assert.ok(result.shownRows <= 16, `shownRows debe estar acotado, fue ${result.shownRows}`);
  assert.ok(result.shownCols <= 13, `shownCols debe estar acotado, fue ${result.shownCols}`);
  assert.equal(result.cells.length, result.shownRows * result.shownCols, "la matriz final es densa y acotada, nunca 25x20=500 celdas");
  const sumOfCells = result.cells.reduce((a, c) => a + c.count, 0);
  assert.equal(sumOfCells, result.grandTotal, "ningún conteo se pierde al agregar en Otros/Otras en ambos ejes");
});

test("valores NULL representados por el caller como etiqueta explícita nunca se pierden ni se agrupan por accidente con datos reales", () => {
  const pairs: CrossingPair[] = [
    { rowKey: "(sin técnico)", colKey: "Completo", count: 2 },
    { rowKey: "Juan", colKey: "Completo", count: 5 }
  ];
  const result = pivotCrossing(pairs);
  assert.ok(result.rows.includes("(sin técnico)"));
  assert.equal(result.rowTotals["(sin técnico)"], 2);
});

test("celdas duplicadas (mismo row/col en pares distintos) se suman, no se sobrescriben", () => {
  const pairs: CrossingPair[] = [
    { rowKey: "APK", colKey: "OK", count: 3 },
    { rowKey: "APK", colKey: "OK", count: 2 }
  ];
  const result = pivotCrossing(pairs);
  assert.equal(result.cells.length, 1);
  assert.equal(result.cells[0].count, 5);
});

test("lista vacía produce una matriz vacía coherente, nunca lanza", () => {
  const result = pivotCrossing([]);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.cols, []);
  assert.deepEqual(result.cells, []);
  assert.equal(result.grandTotal, 0);
  assert.equal(result.aggregated, false);
  assert.equal(result.totalRows, 0);
  assert.equal(result.totalCols, 0);
});

test("orden determinista: filas y columnas por total descendente con empate por nombre ASC", () => {
  const pairs: CrossingPair[] = [
    { rowKey: "B", colKey: "z", count: 5 },
    { rowKey: "A", colKey: "a", count: 5 },
    { rowKey: "C", colKey: "m", count: 10 }
  ];
  const result = pivotCrossing(pairs);
  assert.deepEqual(result.rows, ["C", "A", "B"]); // C(10) primero, A/B empatan en 5 -> ASC
});

test("payload máximo: MAX_RAW_PAIRS acota lo que Postgres devuelve antes de pivotear (defensa en profundidad, ver runPairQuery)", () => {
  // Prueba de contrato en TS puro: confirma que pivotCrossing() en sí mismo
  // no re-trunca de forma oculta un array ya grande - el techo real vive en
  // la query SQL (runPairQuery, MAX_RAW_PAIRS=20000), verificado por
  // inspección de código + medición de cardinalidad real (máx. observado:
  // 580 pares, equipo x problema) documentada en el cierre de Phase 3.
  const pairs: CrossingPair[] = Array.from({ length: 3000 }, (_, i) => ({
    rowKey: `R${i}`,
    colKey: "C",
    count: 1
  }));
  const result = pivotCrossing(pairs);
  assert.equal(result.totalRows, 3000);
  assert.ok(result.shownRows <= 16);
});
