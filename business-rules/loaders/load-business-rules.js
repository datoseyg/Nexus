import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

// Punto único de lectura de business-rules/ para el pipeline (ej.
// src/gold/build-equipment-part-lifecycle-gold.js). Ver business-rules/README.md.
//
// IMPORTANTE: loadEntity() SOLO lee el archivo real (sin ".example") -
// nunca cae a datos de ejemplo como si fueran reales (las filas
// "EXAMPLE-001"/"EJEMPLO-001" de los .example.csv corromperían cualquier
// cohorte si se usaran por accidente). Si no existe el archivo real,
// devuelve rows: [] y source: "NONE" - el caller decide qué hacer
// (típicamente: cohorte no disponible, no inventar el dato).
const BUSINESS_RULES_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function policyPath(name) {
  return path.join(BUSINESS_RULES_DIR, "policies", `${name}.json`);
}

function entityPath(name) {
  return path.join(BUSINESS_RULES_DIR, "entities", `${name}.csv`);
}

function entityExamplePath(name) {
  return path.join(BUSINESS_RULES_DIR, "entities", `${name}.example.csv`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadManifest() {
  const raw = await fs.readFile(path.join(BUSINESS_RULES_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw);
}

export async function loadPolicy(name, fallback = {}) {
  const filePath = policyPath(name);
  if (!(await fileExists(filePath))) {
    console.warn(`business-rules: no existe la política ${filePath}, usando fallback embebido`);
    return fallback;
  }
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function loadEntity(name) {
  const filePath = entityPath(name);

  if (!(await fileExists(filePath))) {
    return { rows: [], source: "NONE", path: filePath };
  }

  const raw = await fs.readFile(filePath, "utf8");
  if (!raw.trim()) return { rows: [], source: "EMPTY_FILE", path: filePath };

  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  return { rows, source: "REAL_FILE", path: filePath };
}

// Solo para validate-business-rules.js (comparar encabezados) - nunca usar
// el resultado como datos de negocio.
export async function readEntityExampleHeaders(name) {
  const filePath = entityExamplePath(name);
  if (!(await fileExists(filePath))) return null;

  const raw = await fs.readFile(filePath, "utf8");
  if (!raw.trim()) return [];

  const records = parse(raw, { columns: false, skip_empty_lines: true, to: 1 });
  return records[0] || [];
}

export { BUSINESS_RULES_DIR, entityPath, entityExamplePath, policyPath };
