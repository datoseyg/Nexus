import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const CURATION_DIR = "data/curation";
const SUMMARY_FILE = "data/reports/curation_validation_summary.json";

// Fuente de verdad de qué columnas debe tener cada archivo de curation.
// Ver docs/CURATION_MODEL.md para el significado de cada campo.
const EXPECTED_SCHEMAS = {
  client_aliases: [
    "alias_value", "alias_type", "canonical_client_key",
    "canonical_client_name", "reason", "created_by", "created_at"
  ],
  equipment_aliases: [
    "alias_value", "alias_type", "canonical_equipment_internal_id",
    "reason", "created_by", "created_at"
  ],
  part_identity_aliases: [
    "alias_value", "alias_type", "dolibarr_product_id",
    "dolibarr_ref", "reason", "created_by", "created_at"
  ],
  ticket_link_overrides: [
    "fieldbeat_task_id", "raw_linked_zendesk_ticket_id",
    "corrected_zendesk_ticket_id", "override_type",
    "reason", "created_by", "created_at"
  ],
  report_field_corrections: [
    "fieldbeat_task_id", "field_name", "original_value",
    "corrected_value", "reason", "created_by", "created_at"
  ],
  placeholder_rules: [
    "pattern_value", "match_type", "applies_to",
    "reason", "created_by", "created_at"
  ],
  curation_audit_log: [
    "audit_id", "timestamp", "created_by", "curation_file", "action",
    "target_summary", "reason", "estimated_affected_records", "rebuild_triggered"
  ]
};

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// Header-only: usa columns:false para no requerir filas de datos
// (un .example.csv o un archivo real recién creado puede tener solo
// encabezado, sin filas todavía).
async function readHeaders(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  if (!raw.trim()) return [];

  const records = parse(raw, { columns: false, skip_empty_lines: true, to: 1 });
  return records[0] || [];
}

function compareHeaders(actual, expected) {
  const missing = expected.filter(col => !actual.includes(col));
  const unexpected = actual.filter(col => !expected.includes(col));
  const orderMatches = missing.length === 0 && unexpected.length === 0
    && actual.length === expected.length
    && actual.every((col, i) => col === expected[i]);

  return { missing, unexpected, orderMatches };
}

export async function validateCurationFiles() {
  console.log("=== Validando archivos de curation ===");

  const curationDirExists = await dirExists(CURATION_DIR);
  const results = [];
  let allValid = curationDirExists;

  if (!curationDirExists) {
    console.error(`No existe la carpeta ${CURATION_DIR}`);
  }

  for (const [name, expectedHeaders] of Object.entries(EXPECTED_SCHEMAS)) {
    const exampleFile = path.join(CURATION_DIR, `${name}.example.csv`);
    const realFile = path.join(CURATION_DIR, `${name}.csv`);

    const fileResult = {
      name,
      example_file: exampleFile,
      example_file_exists: false,
      example_headers_valid: false,
      example_issues: [],
      real_file: realFile,
      real_file_exists: false,
      real_headers_valid: null,
      real_issues: []
    };

    if (curationDirExists) {
      fileResult.example_file_exists = await fileExists(exampleFile);

      if (fileResult.example_file_exists) {
        try {
          const headers = await readHeaders(exampleFile);
          const { missing, unexpected, orderMatches } = compareHeaders(headers, expectedHeaders);

          if (missing.length > 0) fileResult.example_issues.push(`Faltan columnas: ${missing.join(", ")}`);
          if (unexpected.length > 0) fileResult.example_issues.push(`Columnas inesperadas: ${unexpected.join(", ")}`);
          if (!orderMatches && missing.length === 0 && unexpected.length === 0) {
            fileResult.example_issues.push("Las columnas están todas presentes pero en otro orden.");
          }

          fileResult.example_headers_valid = missing.length === 0 && unexpected.length === 0;
        } catch (error) {
          fileResult.example_issues.push(`No se pudo leer/parsear: ${error.message}`);
        }
      } else {
        fileResult.example_issues.push("No existe el archivo .example.csv (debería existir siempre, es la plantilla).");
      }

      // Archivo real (sin ".example") - opcional. Si el usuario ya empezó
      // a curar datos reales, se valida que no esté mal formado.
      fileResult.real_file_exists = await fileExists(realFile);

      if (fileResult.real_file_exists) {
        try {
          const headers = await readHeaders(realFile);
          const { missing, unexpected } = compareHeaders(headers, expectedHeaders);

          if (missing.length > 0) fileResult.real_issues.push(`Faltan columnas: ${missing.join(", ")}`);
          if (unexpected.length > 0) fileResult.real_issues.push(`Columnas inesperadas: ${unexpected.join(", ")}`);

          fileResult.real_headers_valid = missing.length === 0 && unexpected.length === 0;
        } catch (error) {
          fileResult.real_issues.push(`No se pudo leer/parsear: ${error.message}`);
          fileResult.real_headers_valid = false;
        }
      }
    }

    const fileOk = fileResult.example_file_exists
      && fileResult.example_headers_valid
      && fileResult.real_headers_valid !== false;

    if (!fileOk) allValid = false;

    const status = !fileResult.example_file_exists
      ? "MISSING_EXAMPLE"
      : !fileResult.example_headers_valid
        ? "INVALID_EXAMPLE_HEADERS"
        : fileResult.real_headers_valid === false
          ? "INVALID_REAL_FILE"
          : "OK";

    fileResult.status = status;
    results.push(fileResult);

    console.log(`${name}: ${status}`);
  }

  const summary = {
    generated_at: new Date().toISOString(),
    curation_dir_exists: curationDirExists,
    all_valid: allValid,
    files: results
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log(`=== Validación de curation: ${allValid ? "OK" : "CON PROBLEMAS"} ===`);

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  validateCurationFiles().catch(error => {
    console.error("ERROR VALIDANDO ARCHIVOS DE CURATION:");
    console.error(error);
    process.exit(1);
  });
}
