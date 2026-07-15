import fs from "node:fs/promises";
import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import { assertHeaderShape } from "./field-map.js";

/**
 * Lee el CSV fuente de contratos, calcula el SHA-256 del archivo completo
 * (bytes crudos, no del texto parseado) y devuelve las filas ya parseadas
 * posicionalmente (columns:false -el header real tiene columnas sin nombre
 * duplicadas que impiden el modo columns:true de csv-parse).
 *
 * csv-parse reconstruye correctamente los campos citados con saltos de
 * línea embebidos (la columna "Notas" de este archivo real los tiene, ej.
 * una firma personal en su propia línea dentro de la misma celda citada) -
 * no hace falta un parser de líneas a mano.
 *
 * @param {string} filePath
 * @returns {Promise<{rawBuffer: Buffer, sourceSha256: string, header: string[], dataRows: string[][]}>}
 */
export async function readSourceCsvRaw(filePath) {
  const rawBuffer = await fs.readFile(filePath);
  const sourceSha256 = crypto.createHash("sha256").update(rawBuffer).digest("hex");

  const text = rawBuffer.toString("utf8");
  /** @type {string[][]} */
  const rows = parse(text, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true
  });

  if (rows.length === 0) {
    throw new Error(`CSV vacío o ilegible: ${filePath}`);
  }

  const [header, ...dataRows] = rows;

  const headerCheck = assertHeaderShape(header);
  if (!headerCheck.ok) {
    throw new Error(`Header del CSV fuente no coincide con el layout esperado: ${headerCheck.reason}`);
  }

  return { rawBuffer, sourceSha256, header, dataRows };
}
