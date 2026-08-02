// NEXUS V3 - scripts/pipeline/local-refresh-worker.mjs, corrido como
// SUBPROCESO real (child_process.spawn), no importado - mismo mecanismo de
// seguridad que las demás suites de test/pipeline/ (Postgres real
// DESECHABLE). Prueba el worker DIRECTAMENTE (sin pasar por
// scripts/with-local-pipeline-env.mjs, que carga dotenv desde archivos del
// repo) para poder apuntar sus 3 variables requeridas a la base
// desechable de ESTA corrida de tests en vez de a `npm run dev` - la carga
// correcta de esos 3 archivos .env, en el orden correcto, ya quedó
// verificada en vivo (ver el reporte final de la tarea) y no depende de
// Postgres, así que no hace falta repetirla acá.
//
// GOVERNANCE_PIPELINE_WORKER_DB_URL y GOVERNANCE_RULE_EVALUATOR_DB_URL ya
// vienen en process.env cuando esta suite corre vía
// `npm run test:integration:fresh` (scripts/run-integration-tests-fresh.mjs
// las genera contra la base desechable de esa corrida y las pasa al
// runner) - si faltan, los tests que las necesitan se saltan (mismo
// criterio {skip} que el resto de la suite).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const WORKER_DB_URL = process.env.GOVERNANCE_PIPELINE_WORKER_DB_URL;
const RULE_EVALUATOR_DB_URL = process.env.GOVERNANCE_RULE_EVALUATOR_DB_URL;
const SUITE_ID = "local-refresh-worker-test";

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

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runWorkerOnce(env: NodeJS.ProcessEnv): Promise<SpawnResult> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["scripts/pipeline/local-refresh-worker.mjs", "--once"], {
      cwd: REPO_ROOT,
      env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk.toString()));
    child.stderr.on("data", chunk => (stderr += chunk.toString()));
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}

// Base de process.env SIN las 3 variables requeridas - cada test agrega
// exactamente las que necesita, nunca hereda las de la sesión interactiva
// (si `npm run dev` está corriendo en esta misma máquina, sus variables NO
// deben colarse acá - por eso se destructura para omitirlas explícitamente
// en vez de solo spread de todo process.env).
function baseEnvWithout(...names: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of names) delete env[name];
  return env;
}

test(
  "local-refresh-worker.mjs --once: sin las 3 variables requeridas, reporta TODAS juntas y sale con error (nunca una por vez)",
  { skip: !TEST_DB_URL },
  async () => {
    const env = baseEnvWithout("GOVERNANCE_PIPELINE_WORKER_DB_URL", "GOVERNANCE_RULE_EVALUATOR_DB_URL", "SUPABASE_DB_URL_DIRECT");
    const result = await runWorkerOnce(env);

    assert.notEqual(result.code, 0, "debe salir con error si faltan variables requeridas");
    assert.match(result.stderr, /Faltan 3 variable\(s\) de entorno/, "debe reportar las 3 variables faltantes juntas, no una por vez");
    assert.match(result.stderr, /GOVERNANCE_PIPELINE_WORKER_DB_URL/);
    assert.match(result.stderr, /GOVERNANCE_RULE_EVALUATOR_DB_URL/);
    assert.match(result.stderr, /SUPABASE_DB_URL_DIRECT/);
    assert.doesNotMatch(result.stdout + result.stderr, /postgresql:\/\/[^:]+:[^@\s]+@/, "el error nunca debe imprimir una contraseña real en la URL");
  }
);

test(
  "local-refresh-worker.mjs --once: SUPABASE_DB_URL_DIRECT apuntando a un host Supabase cloud aborta ANTES de conectar (nunca hereda Cloud)",
  { skip: !TEST_DB_URL || !WORKER_DB_URL || !RULE_EVALUATOR_DB_URL },
  async () => {
    const env = {
      ...baseEnvWithout("GOVERNANCE_PIPELINE_WORKER_DB_URL", "GOVERNANCE_RULE_EVALUATOR_DB_URL", "SUPABASE_DB_URL_DIRECT"),
      GOVERNANCE_PIPELINE_WORKER_DB_URL: WORKER_DB_URL!,
      GOVERNANCE_RULE_EVALUATOR_DB_URL: RULE_EVALUATOR_DB_URL!,
      // Host inventado - nunca se intenta una conexión de red real (el
      // guard debe rechazarlo por el SUFIJO del host, antes de cualquier I/O).
      SUPABASE_DB_URL_DIRECT: "postgresql://postgres:fake-password@db.abcdefghijklmnop.supabase.co:5432/postgres"
    };
    const result = await runWorkerOnce(env);

    assert.notEqual(result.code, 0, "debe abortar, nunca arrancar el loop contra un host Supabase cloud");
    assert.match(result.stderr, /ABORT/);
    assert.match(result.stderr, /Supabase cloud/i);
  }
);

test(
  "local-refresh-worker.mjs --once: con las 3 variables apuntando a Postgres local desechable, conecta como nexus_pipeline_worker y sale limpio sin trabajo",
  { skip: !TEST_DB_URL || !WORKER_DB_URL || !RULE_EVALUATOR_DB_URL },
  async () => {
    // Precondición real (no asumida): nada QUEUED/CLAIMED/RUNNING en LOCAL
    // en esta base desechable - si no, "sin trabajo" sería una afirmación
    // vacía en vez de una verificación real.
    const before = await pool.query(`SELECT COUNT(*) AS n FROM pipeline.refresh_runs WHERE environment = 'LOCAL' AND status IN ('QUEUED','CLAIMED','RUNNING')`);
    assert.equal(before.rows[0].n, "0", "precondición: no debe haber ninguna corrida LOCAL activa antes de esta prueba");

    assert.match(WORKER_DB_URL!, /nexus_pipeline_worker/, "sanity check: la URL de gobierno del worker debe traer embebido el rol nexus_pipeline_worker");
    assert.doesNotMatch(WORKER_DB_URL!, /\.supabase\.(co|com)/, "sanity check: la base desechable de esta corrida nunca debe ser un host Supabase cloud");

    const env = {
      ...baseEnvWithout("GOVERNANCE_PIPELINE_WORKER_DB_URL", "GOVERNANCE_RULE_EVALUATOR_DB_URL", "SUPABASE_DB_URL_DIRECT"),
      GOVERNANCE_PIPELINE_WORKER_DB_URL: WORKER_DB_URL!,
      GOVERNANCE_RULE_EVALUATOR_DB_URL: RULE_EVALUATOR_DB_URL!,
      // La propia base desechable de esta corrida sirve como
      // SUPABASE_DB_URL_DIRECT: es un Postgres local real, nunca cloud -
      // exactamente lo que el guard debe aceptar.
      SUPABASE_DB_URL_DIRECT: TEST_DB_URL!
    };
    const result = await runWorkerOnce(env);

    assert.equal(result.code, 0, `el worker debe salir limpio (código 0) sin trabajo pendiente. stderr: ${result.stderr}`);
    assert.match(result.stdout, /\[local-refresh-worker\] iniciado worker_id=local-worker:/, "debe identificarse como worker LOCAL");
    assert.match(result.stdout, /--once: nada QUEUED, sin trabajo\. Saliendo\./);
    assert.doesNotMatch(result.stdout + result.stderr, /postgresql:\/\/[^:]+:[^@\s]+@/, "el worker nunca debe imprimir una URL de conexión con contraseña en claro");
  }
);

// ---------------------------------------------------------------------------
// Mitad backend del ciclo de vida completo pedido en la sección 6 del
// encargo (POST -> QUEUED -> el worker la reclama -> RUNNING -> ...): acá se
// prueba con el PROCESO real del worker (no solo llamando a las funciones
// SQL directo, como ya hace test/pipeline/refresh-runs.integration.test.ts)
// - la corrida no llega a SUCCEEDED en este entorno de pruebas (no hay
// credenciales reales de FieldBeat/Zendesk/Dolibarr), así que se acepta
// cualquier transición FUERA de QUEUED como evidencia de que el worker
// reclamó de verdad y le pasó el control al orquestador real
// (run-data-refresh.mjs), no una simulación.
// ---------------------------------------------------------------------------
test(
  "local-refresh-worker.mjs --once: con una corrida QUEUED real en LOCAL, la reclama y la entrega al orquestador (deja de estar QUEUED)",
  { skip: !TEST_DB_URL || !WORKER_DB_URL || !RULE_EVALUATOR_DB_URL },
  async () => {
    const before = await pool.query(`SELECT COUNT(*) AS n FROM pipeline.refresh_runs WHERE environment = 'LOCAL' AND status IN ('QUEUED','CLAIMED','RUNNING')`);
    assert.equal(before.rows[0].n, "0", "precondición: no debe haber ninguna corrida LOCAL activa antes de esta prueba");

    const started = await pool.query(
      `SELECT pipeline.fn_start_refresh_run($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
      ["LOCAL", "INCREMENTAL", "LOCAL", null, "gerencia", false, null, "TEST-WORKER-CLAIM-1", null]
    );
    const refreshRunId = started.rows[0].result.refreshRunId as string;
    assert.equal(started.rows[0].result.status, "QUEUED");

    const env = {
      ...baseEnvWithout("GOVERNANCE_PIPELINE_WORKER_DB_URL", "GOVERNANCE_RULE_EVALUATOR_DB_URL", "SUPABASE_DB_URL_DIRECT"),
      GOVERNANCE_PIPELINE_WORKER_DB_URL: WORKER_DB_URL!,
      GOVERNANCE_RULE_EVALUATOR_DB_URL: RULE_EVALUATOR_DB_URL!,
      SUPABASE_DB_URL_DIRECT: TEST_DB_URL!
    };
    const result = await runWorkerOnce(env);

    assert.match(result.stdout, new RegExp(`procesando refresh_run_id=${refreshRunId}`), "el worker debe reclamar exactamente esta corrida");

    const row = await pool.query(`SELECT status, claimed_by FROM pipeline.refresh_runs WHERE refresh_run_id = $1`, [refreshRunId]);
    assert.notEqual(row.rows[0].status, "QUEUED", "tras --once, la corrida debe haber salido de QUEUED (reclamada y entregada al orquestador real)");
    assert.match(row.rows[0].claimed_by, /^local-worker:/, "claimed_by debe traer el worker_id real del proceso que la reclamó");

    // Limpieza - esta corrida puede haber quedado RUNNING (orquestador real
    // aún en curso al momento en que --once salió) o ya FAILED (falló rápido
    // por falta de credenciales reales de FieldBeat/Zendesk/Dolibarr en este
    // entorno) - cualquiera de las dos formas, se fuerza a un estado
    // terminal para no dejar el entorno LOCAL bloqueado para otra prueba.
    if (row.rows[0].status !== "FAILED" && row.rows[0].status !== "PARTIAL_FAILED") {
      await pool.query(`SELECT pipeline.fn_fail_refresh_run($1,$2,$3,$4)`, [refreshRunId, "TEST_CLEANUP", "cierre de prueba", false]);
    }
  }
);
