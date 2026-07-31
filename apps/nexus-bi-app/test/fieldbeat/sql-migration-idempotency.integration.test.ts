// Phase 3 reapertura §2.3 - prueba automatizada del runner real (no un
// mock): aplica sql/*.sql (todos, orden dinámico) DOS VECES seguidas contra la misma base
// desechable vía el mecanismo oficial (scripts/bootstrap-disposable-postgres.mjs
// con el listado ordenado real de sql/*.sql, la misma lógica que
// scripts/setup-local-dev-db.mjs::orderedSqlFiles() ahora ejecuta en cada
// reutilización de contenedor) y compara el estado completo antes/después:
// conteo de objetos por schema, grants de quality, y una fila transaccional
// sembrada a mano en manual_review.part_aliases (para probar que ningún
// archivo de sql/ trunca/reinserta datos al reaplicarse).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "fieldbeat-sql-idempotency-test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

const { Pool } = pg;
let adminPool: pg.Pool;

function orderedSqlFilesForTest(): string[] {
  // Misma lógica que scripts/setup-local-dev-db.mjs::orderedSqlFiles() -
  // duplicada acá deliberadamente (esa función no está exportada, y no se
  // quiere acoplar el test a los internos de un script pensado para correr
  // como CLI) en vez de reimplementar el mecanismo con otra lógica.
  return readdirSync(path.join(REPO_ROOT, "sql"))
    .filter(f => f.endsWith(".sql"))
    .sort()
    .map(f => path.posix.join("sql", f));
}

function runBootstrap(url: string): { status: number | null; stdout: string; stderr: string } {
  const sqlFiles = orderedSqlFilesForTest();
  // HOTFIX de integridad de datos FieldBeat (Stage 9) - --run-id=TEST_RUN_ID
  // preserva el run_id vigente de la sesión completa de
  // run-integration-tests-fresh.mjs al reaplicar sql/*.sql acá - sin esto,
  // bootstrap-disposable-postgres.mjs generaba un run_id NUEVO en cada
  // llamada y reescribía silenciosamente el COMMENT ON DATABASE, invalidando
  // assertDisposableTarget() para CUALQUIER suite que corriera después de
  // ésta en el mismo run-integration-tests.mjs (defecto real, expuesto al
  // agregar test/search/ - antes invisible porque esta era la última suite
  // en orden alfabético).
  const result = spawnSync(
    process.execPath,
    ["scripts/bootstrap-disposable-postgres.mjs", `--url=${url}`, `--run-id=${TEST_RUN_ID}`, ...sqlFiles.map(f => `--sql=${f}`)],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL.");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
});

async function objectCountsBySchema(): Promise<Record<string, number>> {
  const rows = await adminPool.query<{ table_schema: string; n: string }>(
    `SELECT table_schema, COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema IN ('raw','processed','marts','gold','audit','manual_review','stock','config','quality')
     GROUP BY table_schema`
  );
  const map: Record<string, number> = {};
  for (const row of rows.rows) map[row.table_schema] = Number(row.n);
  return map;
}

test("aplicar sql/*.sql (todos, orden dinámico) dos veces seguidas sobre la misma base desechable es realmente idempotente", { skip: !TEST_DB_URL, timeout: 60000 }, async () => {
  const target = new URL(TEST_DB_URL!);
  const dbName = target.pathname.replace(/^\//, "");

  // Fila transaccional propia, para probar que reaplicar sql/ nunca la toca.
  await adminPool.query(
    `INSERT INTO manual_review.part_aliases (alias_value, alias_type, dolibarr_product_id, reason, created_by, active)
     VALUES ('SQL-IDEMPOTENCY-TEST-RUNNER-PROBE', 'RAW', 999999, 'runner idempotency test', 'sql-migration-idempotency.integration.test.ts', true)
     ON CONFLICT (alias_value, alias_type) DO NOTHING`
  );

  const first = runBootstrap(TEST_DB_URL!.replace(dbName, dbName));
  assert.equal(first.status, 0, `primera aplicación debe salir con código 0. stderr: ${first.stderr}`);

  const beforeObjects = await objectCountsBySchema();
  const beforeAliasCount = await adminPool.query(`SELECT COUNT(*) AS n FROM manual_review.part_aliases WHERE alias_value = 'SQL-IDEMPOTENCY-TEST-RUNNER-PROBE'`);
  const beforeGrants = await adminPool.query(`SELECT COUNT(*) AS n FROM information_schema.role_table_grants WHERE table_schema = 'quality' AND grantee = 'nexus_app'`);

  const second = runBootstrap(TEST_DB_URL!);
  assert.equal(second.status, 0, `segunda aplicación debe salir con código 0. stderr: ${second.stderr}`);

  const afterObjects = await objectCountsBySchema();
  const afterAliasCount = await adminPool.query(`SELECT COUNT(*) AS n FROM manual_review.part_aliases WHERE alias_value = 'SQL-IDEMPOTENCY-TEST-RUNNER-PROBE'`);
  const afterGrants = await adminPool.query(`SELECT COUNT(*) AS n FROM information_schema.role_table_grants WHERE table_schema = 'quality' AND grantee = 'nexus_app'`);

  assert.deepEqual(afterObjects, beforeObjects, "el conteo de objetos por schema debe ser idéntico tras reaplicar");
  assert.equal(afterAliasCount.rows[0].n, beforeAliasCount.rows[0].n, "la fila transaccional sembrada a mano nunca debe duplicarse ni desaparecer");
  assert.equal(afterAliasCount.rows[0].n, "1", "exactamente 1 fila, nunca 0 ni 2+");
  assert.equal(afterGrants.rows[0].n, beforeGrants.rows[0].n, "los grants de quality deben ser idénticos tras reaplicar");
  // HOTFIX de integridad de datos (sql/088): agrega 5 vistas nuevas a
  // quality (fieldbeat_engineer_roster, fieldbeat_report_additional_field_tokens,
  // fieldbeat_report_participants, fieldbeat_report_labor_summary,
  // fieldbeat_report_part_occurrences) - 8 -> 13. sql/098 (clasificación
  // NO_PART_USED) agrega la tabla quality.part_no_usage_markers, que hereda
  // SELECT para nexus_app vía el mismo ALTER DEFAULT PRIVILEGES de sql/086
  // (nunca un GRANT manual duplicado) - 13 -> 14.
  assert.equal(afterGrants.rows[0].n, "14", "las 14 relaciones (vistas + part_no_usage_markers) de quality deben seguir con SELECT para nexus_app");

  // quality debe seguir siendo ejecutable de punta a punta tras la segunda aplicación.
  const queryable = await adminPool.query(`SELECT quality.is_terminal_task_state('FINISHED') AS ok`);
  assert.equal(queryable.rows[0].ok, true);
});
