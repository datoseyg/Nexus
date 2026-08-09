// Bug real encontrado en revisión visual (2026-07-30): la Bandeja/KPIs/
// Reglas/Explorador filtraban únicamente por `status` (OPEN/IN_REVIEW), un
// campo de ciclo de vida persistente que gobernance._publish_rule_evaluation
// NUNCA toca cuando una regla simplemente deja de detectar una entidad sin
// que exista una corrección humana que dispare verificación (ej. la
// reclasificación NO_PART_USED, sql/098) - is_currently_detected pasa a
// false pero status se queda en 'OPEN' para siempre. Resultado: esas
// incidencias seguían apareciendo como trabajo pendiente en todas las
// superficies "activas". Esta suite reproduce exactamente ese escenario
// (dos issues de la misma regla, uno vigente y otro desaparecido-pero-OPEN)
// y verifica que cada endpoint afectado excluye el desaparecido por
// defecto, y que `detection=all` es la única forma explícita de incluirlo.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-bandeja-detection-filter-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const GOVERNANCE_ENV_VARS = ["GOVERNANCE_APP_READ_DB_URL", "GOVERNANCE_APP_CORRECTIONS_DB_URL", "GOVERNANCE_COMMAND_ATTEMPT_LOGGER_DB_URL"] as const;
const ENV_FALLBACK_PATH = new URL("../../.env.development.local", import.meta.url);
if (GOVERNANCE_ENV_VARS.some(name => !process.env[name]) && existsSync(ENV_FALLBACK_PATH)) {
  const content = readFileSync(ENV_FALLBACK_PATH, "utf8");
  for (const line of content.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match && GOVERNANCE_ENV_VARS.includes(match[1] as (typeof GOVERNANCE_ENV_VARS)[number]) && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const { Pool } = pg;
let adminPool: pg.Pool;

// Rango propio, disjunto de cualquier otro fixture de esta suite/repo.
const ENTITY_KEY_CURRENT = "detection-filter-test-975201";
const ENTITY_KEY_DISAPPEARED = "detection-filter-test-975202";
const FINGERPRINT_CURRENT = "detection-filter-test-fp-current";
const FINGERPRINT_DISAPPEARED = "detection-filter-test-fp-disappeared";

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function asAdministracion() {
  setAuthorizationProviderForTests({
    async getUser() {
      return {
        user: { id: "66666666-6666-6666-6666-666666666666", app_metadata: { nexus_role: "administracion" } },
        error: null
      };
    }
  });
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL.");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  await adminPool.query(`DELETE FROM governance.issues WHERE entity_key IN ($1, $2)`, [ENTITY_KEY_CURRENT, ENTITY_KEY_DISAPPEARED]);

  // Issue A: la regla todavía la detecta ahora mismo (caso normal).
  await adminPool.query(
    `INSERT INTO governance.issues
      (fingerprint, rule_code, first_detected_rule_version, last_evaluated_rule_version, entity_type, entity_key, occurrence_key,
       severity, status, first_seen_at, last_seen_at, last_evaluated_at, is_currently_detected)
     VALUES ($1, 'PART_NO_MATCH', 1, 1, 'part_occurrence', $2, $2, 'MEDIUM', 'OPEN', now(), now(), now(), true)`,
    [FINGERPRINT_CURRENT, ENTITY_KEY_CURRENT]
  );

  // Issue B: reproduce EXACTAMENTE el escenario real reportado - la regla ya
  // no la detecta (is_currently_detected=false, disappeared_at seteado) pero
  // status sigue 'OPEN' porque nunca hubo una corrección humana que disparara
  // el flujo de verificación (governance._publish_rule_evaluation nunca toca
  // status al marcar una desaparición).
  await adminPool.query(
    `INSERT INTO governance.issues
      (fingerprint, rule_code, first_detected_rule_version, last_evaluated_rule_version, entity_type, entity_key, occurrence_key,
       severity, status, first_seen_at, last_seen_at, last_evaluated_at, is_currently_detected, disappeared_at)
     VALUES ($1, 'PART_NO_MATCH', 1, 1, 'part_occurrence', $2, $2, 'MEDIUM', 'OPEN', now(), now(), now(), false, now())`,
    [FINGERPRINT_DISAPPEARED, ENTITY_KEY_DISAPPEARED]
  );

  asAdministracion();
});

afterAll(async () => {
  if (!TEST_DB_URL) return;
  await adminPool.query(`DELETE FROM governance.issues WHERE entity_key IN ($1, $2)`, [ENTITY_KEY_CURRENT, ENTITY_KEY_DISAPPEARED]);
  await adminPool.end();
});

test("GET /api/audit/issues (Bandeja) excluye por defecto una incidencia is_currently_detected=false aunque status siga OPEN", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/audit/issues/route.ts");
  const res = await GET(req(`/api/audit/issues?q=${encodeURIComponent(ENTITY_KEY_DISAPPEARED)}&pageSize=25`));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.totalRows, 0, "el issue desaparecido-pero-OPEN no debe aparecer en la bandeja por defecto");
});

test("GET /api/audit/issues (Bandeja) SÍ muestra la incidencia vigente por defecto", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/audit/issues/route.ts");
  const res = await GET(req(`/api/audit/issues?q=${encodeURIComponent(ENTITY_KEY_CURRENT)}&pageSize=25`));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.totalRows, 1, "el issue vigente sí debe aparecer en la bandeja por defecto");
});

test("GET /api/audit/issues?detection=all incluye la incidencia desaparecida explícitamente", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/audit/issues/route.ts");
  const res = await GET(req(`/api/audit/issues?q=${encodeURIComponent(ENTITY_KEY_DISAPPEARED)}&detection=all&pageSize=25`));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.totalRows, 1, "detection=all es la forma explícita de ver también lo histórico/desaparecido");
  assert.equal(body.rows[0].is_currently_detected, false);
});

test("GET /api/audit/kpis (bySeverity/byRule/byEntityType) no cuenta incidencias desaparecidas como abiertas", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/audit/kpis/route.ts");
  const res = await GET();
  const body = await res.json();
  assert.equal(res.status, 200);

  // No podemos aislar por entity_key en un agregado global, así que
  // comparamos contra un conteo directo de control: el número de issues
  // PART_NO_MATCH is_currently_detected=true+OPEN/IN_REVIEW en la base debe
  // coincidir exactamente con lo que reporta byRule para esa regla - si el
  // KPI contara también el desaparecido, sería 1 de más.
  const controlCount = await adminPool.query(
    `SELECT count(*) AS n FROM governance.issues WHERE rule_code = 'PART_NO_MATCH' AND is_currently_detected = true AND status IN ('OPEN','IN_REVIEW')`
  );
  const byRuleRow = (body.byRule as Array<{ rule_code: string; n: string }>).find(r => r.rule_code === "PART_NO_MATCH");
  assert.equal(String(byRuleRow?.n ?? "0"), String(controlCount.rows[0].n));
});

test("GET /api/audit/rules - open_issue_count no cuenta incidencias desaparecidas", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/audit/rules/route.ts");
  const res = await GET();
  const body = await res.json();
  assert.equal(res.status, 200);

  const controlCount = await adminPool.query(
    `SELECT count(*) AS n FROM governance.issues WHERE rule_code = 'PART_NO_MATCH' AND is_currently_detected = true AND status IN ('OPEN','IN_REVIEW')`
  );
  const ruleRow = (body.rows as Array<{ rule_code: string; open_issue_count: string }>).find(r => r.rule_code === "PART_NO_MATCH");
  assert.equal(String(ruleRow?.open_issue_count ?? "0"), String(controlCount.rows[0].n));
});
