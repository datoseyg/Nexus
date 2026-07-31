// Clasificación NO_PART_USED (sql/098_part_no_usage_classification.sql) -
// pruebas de integración contra un Postgres real y DESECHABLE, mismo
// mecanismo de seguridad que test/fieldbeat/quality-api.integration.test.ts
// (ver ese archivo para el contexto completo del incidente ETAPA SAFETY-1).
// Reutiliza AFTER_HOURS_TEST_DATABASE_URL/AFTER_HOURS_TEST_RUN_ID (nombre
// histórico, apunta genéricamente "al Postgres desechable de integración").
//
// Sin fixtures: quality.normalize_part_declaration/classify_part_declaration
// son funciones SQL puras (IMMUTABLE/STABLE) que solo leen la tabla catálogo
// ya sembrada quality.part_no_usage_markers - no requieren INSERT de datos
// de reporte, solo SELECT con parámetros literales.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "no-part-used-classification-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let pool: pg.Pool;

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  pool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(pool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
});

afterAll(async () => {
  if (pool) await pool.end();
});

async function normalize(raw: string | null): Promise<string> {
  const r = await pool.query<{ n: string }>("SELECT quality.normalize_part_declaration($1) AS n", [raw]);
  return r.rows[0].n;
}

async function classify(rawPartIdentifier: string | null, matchStatus: string, quantity: number | null): Promise<string> {
  const r = await pool.query<{ c: string }>(
    "SELECT quality.classify_part_declaration($1, $2, $3) AS c",
    [rawPartIdentifier, matchStatus, quantity]
  );
  return r.rows[0].c;
}

test("quality.normalize_part_declaration - mayúsculas/espacios/puntuación colapsan al mismo valor", { skip: !TEST_DB_URL }, async () => {
  const variants = ["N/A", "n/a", "N/a", "n/A", " N / A ", "N.A.", "n,a"];
  const normalized = await Promise.all(variants.map(normalize));
  // Todas las variantes de casing/espacios/puntuación de "N/A" deben colapsar
  // al mismo valor normalizado entre sí.
  for (const n of normalized) assert.equal(n, normalized[0], `variantes de N/A deberían normalizar igual, obtuve "${n}" vs "${normalized[0]}"`);
});

test("quality.normalize_part_declaration - full-field, nunca substring: 'no aplica x500' NO normaliza igual que 'no aplica'", { skip: !TEST_DB_URL }, async () => {
  const a = await normalize("no aplica");
  const b = await normalize("no aplica x500");
  assert.notEqual(a, b, "el normalizador no debe truncar/ignorar el resto del texto - son valores distintos");
});

const NO_PART_USED_LITERALS = ["N/A", "n/a", "N/a", "n/A", "NA", "na", "Na", "nA", "No.", "No hay", "no aplica", "NC", "nc", "N/C", "n/c", "  N/A  ", "N/A."];

for (const literal of NO_PART_USED_LITERALS) {
  test(`quality.classify_part_declaration('${literal}', PLACEHOLDER_VALUE, cantidad nula) => NO_PART_USED`, { skip: !TEST_DB_URL }, async () => {
    const result = await classify(literal, "PLACEHOLDER_VALUE", null);
    assert.equal(result, "NO_PART_USED", `"${literal}" con cantidad nula debería clasificar como NO_PART_USED, obtuve "${result}"`);
  });

  test(`quality.classify_part_declaration('${literal}', PLACEHOLDER_VALUE, cantidad 0) => NO_PART_USED`, { skip: !TEST_DB_URL }, async () => {
    const result = await classify(literal, "PLACEHOLDER_VALUE", 0);
    assert.equal(result, "NO_PART_USED", `"${literal}" con cantidad 0 debería clasificar como NO_PART_USED, obtuve "${result}"`);
  });
}

test("quality.classify_part_declaration - valor vacío/null con cantidad nula/0 => NO_PART_USED", { skip: !TEST_DB_URL }, async () => {
  assert.equal(await classify(null, "PLACEHOLDER_VALUE", null), "NO_PART_USED");
  assert.equal(await classify("", "PLACEHOLDER_VALUE", 0), "NO_PART_USED");
  assert.equal(await classify("   ", "PLACEHOLDER_VALUE", null), "NO_PART_USED");
});

test("quality.classify_part_declaration - decisión de dominio: cantidad POSITIVA con valor vacío/N-A permanece PLACEHOLDER_VALUE (anomalía a revisar, nunca reclasificada en silencio)", { skip: !TEST_DB_URL }, async () => {
  assert.equal(await classify(null, "PLACEHOLDER_VALUE", 3), "PLACEHOLDER_VALUE");
  assert.equal(await classify("N/A", "PLACEHOLDER_VALUE", 1), "PLACEHOLDER_VALUE");
  assert.equal(await classify("no aplica", "PLACEHOLDER_VALUE", 5), "PLACEHOLDER_VALUE");
});

test("quality.classify_part_declaration - full-field, nunca substring: un valor real que CONTIENE 'no'/'na' como parte de otra palabra permanece PLACEHOLDER_VALUE", { skip: !TEST_DB_URL }, async () => {
  // Ninguno de estos es una declaración válida de "sin repuesto" - contienen
  // los tokens pero no SON el valor completo. Un catálogo mal implementado
  // con ILIKE '%no%'/'%na%' los reclasificaría incorrectamente.
  assert.equal(await classify("Nano filtro", "PLACEHOLDER_VALUE", null), "PLACEHOLDER_VALUE");
  assert.equal(await classify("Banana", "PLACEHOLDER_VALUE", null), "PLACEHOLDER_VALUE");
  assert.equal(await classify("no aplica pero revisar", "PLACEHOLDER_VALUE", null), "PLACEHOLDER_VALUE");
});

test("quality.classify_part_declaration - placeholder real de número de serie (SN/S-N/sin numero) permanece PLACEHOLDER_VALUE, nunca NO_PART_USED", { skip: !TEST_DB_URL }, async () => {
  // Decisión de dominio confirmada contra datos reales (622/722 - ver
  // reconciliación local): "sin numero"/"S/N" hablan de número de serie
  // ausente, no de ausencia de repuesto - deben seguir en el catálogo de
  // placeholders reales que requieren revisión humana.
  assert.equal(await classify("SN", "PLACEHOLDER_VALUE", null), "PLACEHOLDER_VALUE");
  assert.equal(await classify("S/N", "PLACEHOLDER_VALUE", null), "PLACEHOLDER_VALUE");
  assert.equal(await classify("Sin numero", "PLACEHOLDER_VALUE", null), "PLACEHOLDER_VALUE");
});

test("quality.classify_part_declaration - nunca reclasifica un match_status distinto de PLACEHOLDER_VALUE", { skip: !TEST_DB_URL }, async () => {
  assert.equal(await classify("N/A", "NO_MATCH", null), "NO_MATCH");
  assert.equal(await classify("N/A", "AMBIGUOUS_MATCH", null), "AMBIGUOUS_MATCH");
  assert.equal(await classify("N/A", "MATCHED", null), "MATCHED");
});
