import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { BUSINESS_RULES_DIR, entityPath, entityExamplePath, policyPath, readEntityExampleHeaders } from "./load-business-rules.js";

// Análogo a src/curation/validate-curation-files.js, pero para
// business-rules/ - valida que cada .example.csv tenga las columnas de su
// schema, y si existe un archivo real (sin .example), que también calce.
// No falla el proceso si falta un archivo real (es opcional por diseño,
// ver README.md) - solo reporta.
const SUMMARY_FILE = "data/reports/business_rules_validation_summary.json";

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCsvHeaders(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  if (!raw.trim()) return [];
  const records = parse(raw, { columns: false, skip_empty_lines: true, to: 1 });
  return records[0] || [];
}

function compareColumns(actual, expected) {
  const missing = expected.filter(col => !actual.includes(col));
  const unexpected = actual.filter(col => !expected.includes(col));
  return { missing, unexpected, ok: missing.length === 0 && unexpected.length === 0 };
}

async function loadSchemaFiles() {
  const schemasDir = path.join(BUSINESS_RULES_DIR, "schemas");
  const files = await fs.readdir(schemasDir);
  const schemas = [];

  for (const file of files) {
    if (!file.endsWith(".schema.json")) continue;
    const raw = await fs.readFile(path.join(schemasDir, file), "utf8");
    schemas.push(JSON.parse(raw));
  }

  return schemas;
}

async function validateEntitySchema(schema) {
  const name = schema.$id;
  const result = {
    name,
    kind: "entity",
    example_file: entityExamplePath(name),
    example_file_exists: false,
    example_headers_valid: false,
    example_issues: [],
    real_file: entityPath(name),
    real_file_exists: false,
    real_headers_valid: null,
    real_issues: []
  };

  const exampleHeaders = await readEntityExampleHeaders(name);
  result.example_file_exists = exampleHeaders !== null;

  if (exampleHeaders !== null) {
    const { missing, unexpected, ok } = compareColumns(exampleHeaders, schema.required_columns);
    if (missing.length > 0) result.example_issues.push(`Faltan columnas: ${missing.join(", ")}`);
    if (unexpected.length > 0) result.example_issues.push(`Columnas inesperadas: ${unexpected.join(", ")}`);
    result.example_headers_valid = ok;
  } else {
    result.example_issues.push("No existe el archivo .example.csv (debería existir siempre, es la plantilla).");
  }

  result.real_file_exists = await fileExists(result.real_file);

  if (result.real_file_exists) {
    try {
      const headers = await readCsvHeaders(result.real_file);
      const { missing, unexpected, ok } = compareColumns(headers, schema.required_columns);
      if (missing.length > 0) result.real_issues.push(`Faltan columnas: ${missing.join(", ")}`);
      if (unexpected.length > 0) result.real_issues.push(`Columnas inesperadas: ${unexpected.join(", ")}`);
      result.real_headers_valid = ok;
    } catch (error) {
      result.real_issues.push(`No se pudo leer/parsear: ${error.message}`);
      result.real_headers_valid = false;
    }
  }

  const status = !result.example_file_exists
    ? "MISSING_EXAMPLE"
    : !result.example_headers_valid
      ? "INVALID_EXAMPLE_HEADERS"
      : result.real_headers_valid === false
        ? "INVALID_REAL_FILE"
        : result.real_file_exists
          ? "OK_WITH_REAL_DATA"
          : "OK_EXAMPLE_ONLY";

  result.status = status;
  return result;
}

async function validatePolicySchema(schema) {
  const name = schema.$id;
  const filePath = policyPath(name);
  const result = { name, kind: "policy", policy_file: filePath, exists: false, issues: [] };

  result.exists = await fileExists(filePath);

  if (!result.exists) {
    result.issues.push("No existe el archivo de política - se usará el fallback embebido en código.");
    result.status = "MISSING_USING_FALLBACK";
    return result;
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const missingKeys = (schema.required_keys || []).filter(key => !(key in parsed));

    if (missingKeys.length > 0) {
      result.issues.push(`Faltan claves: ${missingKeys.join(", ")}`);
      result.status = "MISSING_KEYS";
    } else {
      result.status = "OK";
    }
  } catch (error) {
    result.issues.push(`No se pudo leer/parsear: ${error.message}`);
    result.status = "INVALID_JSON";
  }

  return result;
}

export async function validateBusinessRules() {
  console.log("=== Validando business-rules/ ===");

  const schemas = await loadSchemaFiles();
  const entityResults = [];
  const policyResults = [];

  for (const schema of schemas) {
    if (schema.type === "csv") {
      const result = await validateEntitySchema(schema);
      entityResults.push(result);
      console.log(`entities/${schema.$id}: ${result.status}`);
    } else if (schema.type === "json") {
      const result = await validatePolicySchema(schema);
      policyResults.push(result);
      console.log(`policies/${schema.$id}: ${result.status}`);
    }
  }

  const manifestPath = path.join(BUSINESS_RULES_DIR, "manifest.json");
  const manifestExists = await fileExists(manifestPath);

  const hardFailures = [
    ...entityResults.filter(r => r.status === "MISSING_EXAMPLE" || r.status === "INVALID_EXAMPLE_HEADERS" || r.status === "INVALID_REAL_FILE"),
    ...policyResults.filter(r => r.status === "INVALID_JSON" || r.status === "MISSING_KEYS")
  ];

  const summary = {
    generated_at: new Date().toISOString(),
    manifest_exists: manifestExists,
    entities: entityResults,
    policies: policyResults,
    all_valid: manifestExists && hardFailures.length === 0
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log(`=== Validación business-rules: ${summary.all_valid ? "OK" : "CON PROBLEMAS"} ===`);

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  validateBusinessRules().catch(error => {
    console.error("ERROR VALIDANDO BUSINESS-RULES:");
    console.error(error);
    process.exit(1);
  });
}
