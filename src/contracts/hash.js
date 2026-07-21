import crypto from "node:crypto";

/**
 * @param {string} input
 * @returns {string} hex sha256
 */
export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Hash de la fila raw COMPLETA (las 24 posiciones, incluyendo espaciadores
 * y la columna Variables) -solo trazabilidad ("¿cambió algo, lo que sea, en
 * esta fila del archivo?"), nunca se usa para decidir versionado contractual
 * (eso es contract-fingerprint.js). JSON.stringify evita ambigüedad de
 * separador ante comas/saltos de línea embebidos en los valores.
 * @param {string[]} row
 * @returns {string}
 */
export function sourceRowHash(row) {
  return sha256Hex(JSON.stringify(row));
}
