import fs from "node:fs/promises";
import { sha256Hex } from "./hash.js";

/**
 * Lee un bundle anual de feriados (JSON) del disco, sin validarlo -solo
 * parseo + hash del archivo completo (idempotencia por SHA-256, mismo
 * patrón que config.contract_import_runs/config.holiday_import_runs).
 * @param {string} filePath
 * @returns {Promise<{ raw: string, sha256: string, parsed: object, filePath: string }>}
 */
export async function readBundleRaw(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const sha256 = sha256Hex(raw);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Bundle no es JSON válido (${filePath}): ${error.message}`);
  }
  return { raw, sha256, parsed, filePath };
}
