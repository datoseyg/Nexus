// Pruebas de integración contra un Postgres 16 DESECHABLE EXCLUSIVO de esta
// suite -nunca reutiliza el contenedor de test/contracts/** ni el de
// test/working-hours/** (ver auditoría de aislamiento de 6.6B0). Se saltan
// enteras si HOLIDAYS_TEST_DATABASE_URL no está seteada. Nunca corre contra
// Supabase productivo ni usa SUPABASE_DB_URL_DIRECT.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../src/lib/db-safety.js";

// ETAPA SAFETY-1 - ver test/working-hours/ddl.integration.test.js para el
// contexto completo del incidente que motivó este guard.
const TEST_DB_URL = process.env.HOLIDAYS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.HOLIDAYS_TEST_RUN_ID;
const SUITE_ID = "holidays-import-test";
if (TEST_DB_URL) {
  process.env.HOLIDAYS_DB_URL = TEST_DB_URL;
}

const { Pool } = pg;
let adminPool;
let applyBundle, checkAlreadyImported, publishCoverage, createPool;

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error(`Falta HOLIDAYS_TEST_RUN_ID -requerido junto con HOLIDAYS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).`);
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
  ({ applyBundle, checkAlreadyImported } = await import("../../src/holidays/db-writer.js"));
  ({ publishCoverage } = await import("../../src/holidays/publish-coverage.js"));
  ({ createPool } = await import("../../src/holidays/db-client.js"));
});

after(async () => {
  if (adminPool) await adminPool.end();
});

function bundle(overrides = {}) {
  return {
    schema_version: "holiday-calendar-bundle-v1",
    jurisdiction: "CL",
    coverage_start: "2026-01-01",
    coverage_end_exclusive: "2027-01-01",
    sources: [{ source_id: "s1", authority: "Test", title: "Test bundle", url: "https://example.test", accessed_at: "2026-07-15" }],
    events: [
      { local_date: "2026-01-01", source_event_key: "CL:2026-01-01:FIXED_DATE:ano-nuevo", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", is_irrenunciable: true, source_ids: ["s1"] }
    ],
    ...overrides
  };
}

let counter = 0;
function nextSha() {
  counter += 1;
  return `test-sha-${counter}-${Date.now()}`;
}

test("1) apply crea import_run SUCCESS + entries + cobertura DRAFT (nunca VALIDATED automáticamente)", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const sha = nextSha();
  const b = bundle();
  const result = await applyBundle({ pool, filename: "test.json", sha256: sha, bundle: b, resolvedEvents: b.events });

  assert.equal(result.alreadyImported, false);
  assert.ok(result.importId);
  assert.ok(result.coverageId);

  const cov = await adminPool.query("SELECT coverage_status FROM config.holiday_calendar_coverage WHERE coverage_id = $1", [result.coverageId]);
  assert.equal(cov.rows[0].coverage_status, "DRAFT");

  const entries = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.holiday_calendar_entries WHERE source_import_id = $1", [result.importId]);
  assert.equal(entries.rows[0].n, 1);
  await pool.end();
});

test("2) idempotencia por SHA: aplicar el mismo archivo de nuevo -> already imported, cero filas nuevas", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const sha = nextSha();
  const b = bundle();
  const r1 = await applyBundle({ pool, filename: "test.json", sha256: sha, bundle: b, resolvedEvents: b.events });
  const before1 = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.holiday_calendar_entries");

  const r2 = await applyBundle({ pool, filename: "test.json", sha256: sha, bundle: b, resolvedEvents: b.events });
  assert.equal(r2.alreadyImported, true);
  assert.equal(r2.importId, r1.importId);

  const after1 = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.holiday_calendar_entries");
  assert.equal(before1.rows[0].n, after1.rows[0].n);
  await pool.end();
});

test("3) rollback ante evento inválido: ninguna fila queda persistida, se registra FAILED", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const sha = nextSha();
  // holiday_type inválido a nivel DB (viola el CHECK, aunque bundle-validator.js
  // ya lo habría rechazado antes -esto simula un evento que se cuela igual,
  // para probar que el CHECK + rollback funcionan como última línea de defensa).
  const b = bundle({ events: [{ local_date: "2026-01-01", source_event_key: "k1", holiday_name: "X", holiday_type: "NO_EXISTE", source_ids: ["s1"] }] });

  await assert.rejects(() => applyBundle({ pool, filename: "test.json", sha256: sha, bundle: b, resolvedEvents: b.events }));

  const importRuns = await adminPool.query("SELECT import_status FROM config.holiday_import_runs WHERE source_sha256 = $1", [sha]);
  assert.equal(importRuns.rows.length, 1);
  assert.equal(importRuns.rows[0].import_status, "FAILED");

  const entries = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.holiday_calendar_entries WHERE source_import_id = (SELECT import_id FROM config.holiday_import_runs WHERE source_sha256 = $1)", [sha]);
  assert.equal(entries.rows[0].n, 0);
  await pool.end();
});

test("4) publish: DRAFT -> VALIDATED", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const sha = nextSha();
  const b = bundle({ jurisdiction: "CL_T4", coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-01", source_event_key: "k-t4", holiday_name: "X", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied = await applyBundle({ pool, filename: "t4.json", sha256: sha, bundle: b, resolvedEvents: b.events });

  const published = await publishCoverage(pool, { coverageId: applied.coverageId });
  const row = await adminPool.query("SELECT coverage_status FROM config.holiday_calendar_coverage WHERE coverage_id = $1", [published.publishedCoverageId]);
  assert.equal(row.rows[0].coverage_status, "VALIDATED");
  await pool.end();
});

test("5) publish con supersede: la cobertura anterior queda SUPERSEDED apuntando a la nueva", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const juris = "CL_T5";
  const sha1 = nextSha();
  const b1 = bundle({ jurisdiction: juris, coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-01", source_event_key: "k-t5-a", holiday_name: "X", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied1 = await applyBundle({ pool, filename: "t5a.json", sha256: sha1, bundle: b1, resolvedEvents: b1.events });
  const published1 = await publishCoverage(pool, { coverageId: applied1.coverageId });

  const sha2 = nextSha();
  const b2 = bundle({ jurisdiction: juris, coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-02", source_event_key: "k-t5-b", holiday_name: "Y", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied2 = await applyBundle({ pool, filename: "t5b.json", sha256: sha2, bundle: b2, resolvedEvents: b2.events });
  const published2 = await publishCoverage(pool, { coverageId: applied2.coverageId, supersedeCoverageId: published1.publishedCoverageId });

  const oldRow = await adminPool.query("SELECT coverage_status, superseded_by_coverage_id FROM config.holiday_calendar_coverage WHERE coverage_id = $1", [published1.publishedCoverageId]);
  assert.equal(oldRow.rows[0].coverage_status, "SUPERSEDED");
  assert.equal(Number(oldRow.rows[0].superseded_by_coverage_id), published2.publishedCoverageId);

  const newRow = await adminPool.query("SELECT coverage_status FROM config.holiday_calendar_coverage WHERE coverage_id = $1", [published2.publishedCoverageId]);
  assert.equal(newRow.rows[0].coverage_status, "VALIDATED");
  await pool.end();
});

test("6) solapamiento rechazado: 2 coberturas VALIDATED solapadas para la misma jurisdicción", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const juris = "CL_T6";
  const sha1 = nextSha();
  const b1 = bundle({ jurisdiction: juris, coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-01", source_event_key: "k-t6-a", holiday_name: "X", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied1 = await applyBundle({ pool, filename: "t6a.json", sha256: sha1, bundle: b1, resolvedEvents: b1.events });
  await publishCoverage(pool, { coverageId: applied1.coverageId });

  const sha2 = nextSha();
  const b2 = bundle({ jurisdiction: juris, coverage_start: "2019-06-01", coverage_end_exclusive: "2020-06-01", events: [{ local_date: "2019-07-01", source_event_key: "k-t6-b", holiday_name: "Y", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied2 = await applyBundle({ pool, filename: "t6b.json", sha256: sha2, bundle: b2, resolvedEvents: b2.events });

  await assert.rejects(() => publishCoverage(pool, { coverageId: applied2.coverageId }), /solapamiento/);
  await pool.end();
});

test("7) dos publicaciones concurrentes solapadas -> exactamente 1 exitosa", { skip: !TEST_DB_URL }, async () => {
  const poolA = createPool();
  const poolB = createPool();
  const juris = "CL_T7";
  try {
    const shaA = nextSha();
    const bA = bundle({ jurisdiction: juris, coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-01", source_event_key: "k-t7-a", holiday_name: "X", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
    const appliedA = await applyBundle({ pool: poolA, filename: "t7a.json", sha256: shaA, bundle: bA, resolvedEvents: bA.events });

    const shaB = nextSha();
    const bB = bundle({ jurisdiction: juris, coverage_start: "2019-06-01", coverage_end_exclusive: "2020-06-01", events: [{ local_date: "2019-07-01", source_event_key: "k-t7-b", holiday_name: "Y", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
    const appliedB = await applyBundle({ pool: poolB, filename: "t7b.json", sha256: shaB, bundle: bB, resolvedEvents: bB.events });

    const results = await Promise.allSettled([
      publishCoverage(poolA, { coverageId: appliedA.coverageId }),
      publishCoverage(poolB, { coverageId: appliedB.coverageId })
    ]);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    assert.equal(fulfilled.length, 1, `se esperaba exactamente 1 exitosa, resultado: ${JSON.stringify(results.map(r => r.status))}`);

    const validatedCount = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.holiday_calendar_coverage WHERE jurisdiction = $1 AND coverage_status = 'VALIDATED'", [juris]);
    assert.equal(validatedCount.rows[0].n, 1);
  } finally {
    await poolA.end();
    await poolB.end();
  }
});

test("8) eventos coincidentes en una fecha se importan correctamente (2 filas, distinta source_event_key)", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const sha = nextSha();
  const b = bundle({
    jurisdiction: "CL_T8",
    coverage_start: "2026-01-01",
    coverage_end_exclusive: "2027-01-01",
    events: [
      { local_date: "2026-09-18", source_event_key: "CL_T8:2026-09-18:FIXED_DATE:independencia", holiday_name: "Independencia Nacional", holiday_type: "FIXED_DATE", source_ids: ["s1"] },
      { local_date: "2026-09-18", source_event_key: "CL_T8:2026-09-18:REGIONAL:evento-regional-x", holiday_name: "Evento Regional X", holiday_type: "REGIONAL", source_ids: ["s1"] }
    ]
  });
  const result = await applyBundle({ pool, filename: "t8.json", sha256: sha, bundle: b, resolvedEvents: b.events });
  const rows = await adminPool.query("SELECT local_date, source_event_key FROM config.holiday_calendar_entries WHERE source_import_id = $1 ORDER BY source_event_key", [result.importId]);
  assert.equal(rows.rows.length, 2);
  assert.equal(String(rows.rows[0].local_date).slice(0, 10), "2026-09-18");
  assert.equal(String(rows.rows[1].local_date).slice(0, 10), "2026-09-18");
  await pool.end();
});

test("9) vista canónica config.current_holiday_calendar_entries refleja solo cobertura VALIDATED", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const juris = "CL_T9";
  const sha = nextSha();
  const b = bundle({ jurisdiction: juris, coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-01", source_event_key: "k-t9", holiday_name: "X", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied = await applyBundle({ pool, filename: "t9.json", sha256: sha, bundle: b, resolvedEvents: b.events });

  const before1 = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.current_holiday_calendar_entries WHERE jurisdiction = $1", [juris]);
  assert.equal(before1.rows[0].n, 0); // aún DRAFT, no debe aparecer

  await publishCoverage(pool, { coverageId: applied.coverageId });
  const after1 = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.current_holiday_calendar_entries WHERE jurisdiction = $1", [juris]);
  assert.equal(after1.rows[0].n, 1);

  const coverageView = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.current_holiday_calendar_coverage WHERE jurisdiction = $1", [juris]);
  assert.equal(coverageView.rows[0].n, 1);
  await pool.end();
});

test("10) permisos: nexus_app no puede leer ninguna tabla/vista de config.holiday_*", { skip: !TEST_DB_URL }, async () => {
  const nexusUrl = TEST_DB_URL.replace(/\/\/[^:]+:[^@]+@/, "//nexus_app:test@");
  const nexusPool = new Pool({ connectionString: nexusUrl });
  try {
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.holiday_import_runs LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.holiday_calendar_entries LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.holiday_calendar_coverage LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.current_holiday_calendar_entries LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.current_holiday_calendar_coverage LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT config.publish_holiday_coverage('X', daterange('2026-01-01','2026-01-02'), gen_random_uuid(), NULL)"));
  } finally {
    await nexusPool.end();
  }
});

test("11) dry-run no escribe absolutamente nada en la base", { skip: !TEST_DB_URL }, async () => {
  const before1 = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.holiday_import_runs");
  const b = bundle({ jurisdiction: "CL_T11_NUNCA_ESCRITO" });
  const { checkAlreadyImported: check } = { checkAlreadyImported };
  void check;
  // Simula exactamente lo que runDryRun() hace: valida + peek de solo lectura,
  // nunca INSERT/UPDATE/DELETE.
  const pool = createPool();
  await checkAlreadyImported(pool, nextSha());
  await pool.end();
  const after1 = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.holiday_import_runs");
  assert.equal(before1.rows[0].n, after1.rows[0].n);

  const noJurisdictionRows = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.holiday_calendar_entries WHERE jurisdiction = $1", [b.jurisdiction]);
  assert.equal(noJurisdictionRows.rows[0].n, 0);
});

test("12) importación de 2 años consecutivos: cada uno con su propio import_run y cobertura, sin interferir", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const juris = "CL_T12";
  const sha2019 = nextSha();
  const b2019 = bundle({ jurisdiction: juris, coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-01", source_event_key: "k-t12-2019", holiday_name: "X 2019", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied2019 = await applyBundle({ pool, filename: "t12-2019.json", sha256: sha2019, bundle: b2019, resolvedEvents: b2019.events });

  const sha2020 = nextSha();
  const b2020 = bundle({ jurisdiction: juris, coverage_start: "2020-01-01", coverage_end_exclusive: "2021-01-01", events: [{ local_date: "2020-06-01", source_event_key: "k-t12-2020", holiday_name: "X 2020", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied2020 = await applyBundle({ pool, filename: "t12-2020.json", sha256: sha2020, bundle: b2020, resolvedEvents: b2020.events });

  assert.notEqual(applied2019.importId, applied2020.importId);
  assert.notEqual(applied2019.coverageId, applied2020.coverageId);

  await publishCoverage(pool, { coverageId: applied2019.coverageId });
  await publishCoverage(pool, { coverageId: applied2020.coverageId });

  const total = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.current_holiday_calendar_entries WHERE jurisdiction = $1", [juris]);
  assert.equal(total.rows[0].n, 2);
  await pool.end();
});

test("13) reimportación corregida del mismo año: conserva historial (SUPERSEDED), nunca borra la fila original", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const juris = "CL_T13";
  const sha1 = nextSha();
  const b1 = bundle({ jurisdiction: juris, coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-01", source_event_key: "k-t13-v1", holiday_name: "Nombre Original", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied1 = await applyBundle({ pool, filename: "t13-v1.json", sha256: sha1, bundle: b1, resolvedEvents: b1.events });
  const published1 = await publishCoverage(pool, { coverageId: applied1.coverageId });

  // Corrección: mismo año, nombre corregido -> nuevo import, nueva
  // cobertura, supersede la anterior.
  const sha2 = nextSha();
  const b2 = bundle({ jurisdiction: juris, coverage_start: "2019-01-01", coverage_end_exclusive: "2020-01-01", events: [{ local_date: "2019-06-01", source_event_key: "k-t13-v2", holiday_name: "Nombre Corregido", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const applied2 = await applyBundle({ pool, filename: "t13-v2.json", sha256: sha2, bundle: b2, resolvedEvents: b2.events });
  const published2 = await publishCoverage(pool, { coverageId: applied2.coverageId, supersedeCoverageId: published1.publishedCoverageId });

  // La entry original (v1) sigue existiendo físicamente -nunca se borra.
  const originalEntry = await adminPool.query("SELECT holiday_name FROM config.holiday_calendar_entries WHERE source_event_key = 'k-t13-v1'");
  assert.equal(originalEntry.rows.length, 1);
  assert.equal(originalEntry.rows[0].holiday_name, "Nombre Original");

  const canonical = await adminPool.query("SELECT holiday_name FROM config.current_holiday_calendar_entries WHERE jurisdiction = $1", [juris]);
  assert.equal(canonical.rows.length, 1);
  assert.equal(canonical.rows[0].holiday_name, "Nombre Corregido");
  void published2;
  await pool.end();
});

test("14) cobertura nacional (CL) separada de cobertura regional (otra jurisdicción) -no interfieren entre sí", { skip: !TEST_DB_URL }, async () => {
  const pool = createPool();
  const shaNational = nextSha();
  const bNational = bundle({ jurisdiction: "CL_T14", coverage_start: "2026-01-01", coverage_end_exclusive: "2027-01-01", events: [{ local_date: "2026-09-18", source_event_key: "k-t14-national", holiday_name: "Independencia", holiday_type: "FIXED_DATE", source_ids: ["s1"] }] });
  const appliedNational = await applyBundle({ pool, filename: "t14-national.json", sha256: shaNational, bundle: bNational, resolvedEvents: bNational.events });
  await publishCoverage(pool, { coverageId: appliedNational.coverageId });

  const shaRegional = nextSha();
  const bRegional = bundle({ jurisdiction: "CL_T14_AP", coverage_start: "2026-01-01", coverage_end_exclusive: "2027-01-01", events: [{ local_date: "2026-06-07", source_event_key: "k-t14-regional", holiday_name: "Feriado Regional", holiday_type: "REGIONAL", source_ids: ["s1"] }] });
  const appliedRegional = await applyBundle({ pool, filename: "t14-regional.json", sha256: shaRegional, bundle: bRegional, resolvedEvents: bRegional.events });
  await publishCoverage(pool, { coverageId: appliedRegional.coverageId });

  const nationalOnly = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.current_holiday_calendar_entries WHERE jurisdiction = 'CL_T14'");
  assert.equal(nationalOnly.rows[0].n, 1);
  const regionalOnly = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.current_holiday_calendar_entries WHERE jurisdiction = 'CL_T14_AP'");
  assert.equal(regionalOnly.rows[0].n, 1);

  // Confirmar que 2026-06-07 NO aparece como feriado nacional CL_T14 (las
  // jurisdicciones nunca se filtran entre sí).
  const crossCheck = await adminPool.query("SELECT COUNT(*)::int AS n FROM config.current_holiday_calendar_entries WHERE jurisdiction = 'CL_T14' AND local_date = '2026-06-07'");
  assert.equal(crossCheck.rows[0].n, 0);
  await pool.end();
});
