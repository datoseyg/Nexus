// Gate B (B24/21.12) - "SQL ejecutada" se retiró de la experiencia
// productiva de Búsqueda para AMBOS roles (decisión cerrada de Gate A).
// Prueba de contrato: la respuesta de /api/search NUNCA contiene una clave
// que sugiera SQL/estructura interna expuesta (sql, queryText, parameters,
// schema, table, joins, executionPlan) en NINGÚN nivel de anidamiento -
// verificado programáticamente contra el shape real, no solo por búsqueda
// de substring (B64: el shape es la prueba principal, texto es defensa
// secundaria). queryExplanation es la única superficie de "cómo se buscó
// esto" permitida, y es lenguaje de negocio puro.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "search-sql-disclosure-retired-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

const FORBIDDEN_KEYS = ["sql", "queryText", "parameters", "schema", "table", "joins", "executionPlan"];

function req(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "search-sql-disclosure-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

function asAdministracion() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "search-sql-disclosure-integration-admin", app_metadata: { nexus_role: "administracion" } }, error: null };
    }
  });
}

function findForbiddenKeys(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(key)) hits.push(`${path}.${key}`);
    hits.push(...findForbiddenKeys(child, `${path}.${key}`));
  }
  return hits;
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
  if (!TEST_DB_URL) return;
  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("GET /api/search - nunca expone claves con forma de SQL/estructura interna", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/search/route.ts");

  await t.test("entity=all - gerencia", async () => {
    asGerencia();
    const body = await (await GET(req("/api/search", { q: "reporte", entity: "all" }))).json();
    const hits = findForbiddenKeys(body);
    assert.deepEqual(hits, [], `no deberían existir claves prohibidas, se encontraron: ${hits.join(", ")}`);
    assert.ok(body.queryExplanation, "debe existir queryExplanation");
    assert.ok(Array.isArray(body.queryExplanation.entitiesSearched));
    assert.ok(Array.isArray(body.queryExplanation.filtersApplied));
    assert.equal(typeof body.queryExplanation.resultRelation, "string");
    assert.ok(Array.isArray(body.queryExplanation.resultLimits));
  });

  await t.test("entity=parts - administracion (ambos roles, nunca solo uno)", async () => {
    asAdministracion();
    const body = await (await GET(req("/api/search", { q: "reporte", entity: "parts" }))).json();
    const hits = findForbiddenKeys(body);
    assert.deepEqual(hits, [], `no deberían existir claves prohibidas, se encontraron: ${hits.join(", ")}`);
    assert.ok(body.queryExplanation);
  });

  await t.test("filtersApplied refleja los filtros reales en lenguaje de negocio, nunca SQL", async () => {
    asGerencia();
    const body = await (await GET(req("/api/search", { q: "reporte", entity: "reports", cliente: "Cliente Fixture" }))).json();
    const clienteFilter = body.queryExplanation.filtersApplied.find((f: { label: string }) => f.label === "Cliente");
    assert.ok(clienteFilter, "debe reflejar el filtro de cliente aplicado");
    assert.equal(clienteFilter.value, "Cliente Fixture");
  });
});
