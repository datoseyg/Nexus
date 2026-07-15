import { COLUMN, MIN_EXPECTED_COLUMNS } from "./field-map.js";

/**
 * Una fila es de equipo si y solo si Cliente (col 0) Y Equipo (col 2) son
 * no vacías -verificado contra el archivo real: produce exactamente 23
 * filas de equipo y 17 auxiliares/de lista de validación (40 filas lógicas
 * totales). No se asume nunca que toda fila del CSV es un equipo.
 * @param {string[]} row
 * @returns {boolean}
 */
export function isEquipmentRow(row) {
  const cliente = (row[COLUMN.CLIENTE] ?? "").trim();
  const equipo = (row[COLUMN.EQUIPO] ?? "").trim();
  return cliente !== "" && equipo !== "";
}

/**
 * @param {string[]} row
 * @returns {boolean} true si la fila está estructuralmente rota (menos
 * columnas de las mínimas esperadas) -condición FATAL para toda la corrida,
 * nunca una fila silenciosamente ignorada.
 */
export function isErroredRow(row) {
  return !Array.isArray(row) || row.length < MIN_EXPECTED_COLUMNS;
}

/**
 * Clasifica las filas lógicas (ya parseadas por csv-source.js) en tres
 * grupos disjuntos: equipmentRows (aceptadas), ignoredRows (auxiliares/
 * lista de validación -no son error), erroredRows (estructuralmente
 * inválidas). Nunca "rejectedRows".
 * @param {string[][]} dataRows
 * @returns {{
 *   equipmentRows: Array<{row: string[], sourceRowNumber: number}>,
 *   ignoredRows: Array<{row: string[], sourceRowNumber: number, reason: string}>,
 *   erroredRows: Array<{row: string[], sourceRowNumber: number, reason: string}>
 * }}
 */
export function classifyRows(dataRows) {
  const equipmentRows = [];
  const ignoredRows = [];
  const erroredRows = [];

  dataRows.forEach((row, index) => {
    // source_row_number es 1-based sobre las filas de datos (excluyendo
    // el header), coincide con la numeración natural de un usuario
    // mirando el CSV en una hoja de cálculo (fila 1 = primera fila de datos).
    const sourceRowNumber = index + 1;

    if (isErroredRow(row)) {
      erroredRows.push({ row, sourceRowNumber, reason: `Fila con ${row?.length ?? 0} columnas, se esperaban al menos ${MIN_EXPECTED_COLUMNS}.` });
      return;
    }

    if (isEquipmentRow(row)) {
      equipmentRows.push({ row, sourceRowNumber });
      return;
    }

    ignoredRows.push({ row, sourceRowNumber, reason: "Cliente y/o Equipo vacíos -fila auxiliar o de lista de validación, no es un registro de equipo." });
  });

  return { equipmentRows, ignoredRows, erroredRows };
}
