#!/usr/bin/env node
// NEXUS V3 - Orquestador ÚNICO y compartido del refresh de datos manual
// (requisitos 1/2 del encargo). Nunca se ejecuta en el login, nunca dentro
// de un request HTTP síncrono - solo lo invocan scripts/pipeline/local-refresh-worker.mjs
// (loop local) y .github/workflows/data-refresh.yml (workflow_dispatch
// manual) - MISMO código en ambos casos, ninguna lógica duplicada en YAML.
//
// Secuencia (cada etapa registrada en pipeline.refresh_run_stages vía
// pipeline.fn_update_refresh_run_stage antes de ejecutarla):
//   EXTRACT -> NORMALIZE -> BUILD_MARTS -> BUILD_GOLD -> LOAD_DUCKDB ->
//   SYNC_POSTGRES -> BUILD_WORKING_HOURS -> VALIDATE_AFTER_HOURS -> VALIDATE ->
//   REEVALUATE_RULES -> PUBLISH_SNAPSHOT
// Cualquier falla detiene el resto y llama pipeline.fn_fail_refresh_run -
// un snapshot publicado sano NUNCA se reemplaza por una carga incompleta
// (pipeline.fn_complete_refresh_run, que mueve pipeline.published_dataset_state,
// solo se alcanza si TODO lo anterior terminó bien).
//
// LOAD_DUCKDB (agregada tras un incidente real, ver
// data/reports/supabase_validation_summary.json y el reporte de esa
// corrección) - BUILD_GOLD escribe CSV nuevos, pero nada volvía a cargar
// data/warehouse/eyg_nexus.duckdb desde ellos antes de que SYNC_POSTGRES
// (migrateToSupabase) migrara el .duckdb hacia Postgres: el resultado era
// un snapshot consistente entre DuckDB y Postgres, pero VIEJO. Esta etapa
// reutiliza loadDuckDb() (src/db/load-duckdb.js) tal cual - nunca reimplementa
// su lógica de carga - y agrega dos guardas propias de este orquestador
// (src/db/duckdb-freshness.js), ambas bloqueantes:
//   - assertDuckDbLoadComplete: ninguna tabla DUCKDB_SYNC obligatoria puede
//     quedar SKIPPED_MISSING_CSV/ERROR en silencio (loadDuckDb() por sí solo
//     solo lanza ante ERROR, nunca ante CSV faltante - correcto para su uso
//     manual histórico, insuficiente acá).
//   - assertDuckDbFreshAfterLoad: releé el CSV y la tabla recién cargada de
//     forma independiente para el mínimo de tablas exigido (fieldbeat_tasks/
//     zendesk_tickets/dolibarr_products/fieldbeat_used_parts) - nunca basta
//     con que DuckDB y Postgres coincidan entre sí, podrían coincidir sobre
//     un snapshot antiguo.
//
// Reutiliza los módulos reales, nunca los reimplementa:
//   - Miners (src/miners/{fieldbeat-all,zendesk,dolibarr}.js) - export una
//     función async, se importan directo.
//   - Normalizadores (src/normalizers/*.js) y builders de marts/gold
//     (src/marts/*.js, src/gold/*.js) - 9 scripts CLI-only, sin export,
//     auto-invocación al importar (`if (fileURLToPath(import.meta.url) ===
//     process.argv[1])` ausente) - se ejecutan vía spawnSync, nunca se
//     importan (importarlos dispararía su lógica en el momento de resolver
//     el import, sin poder controlar el orden ni capturar errores por etapa).
//   - src/db/migrate-to-supabase.js (migrateToSupabase) y
//     src/db/validate-supabase.js (validateSupabase) - SÍ exportan función +
//     tienen guard CLI, se importan directo.
//   - src/db/generate-postgres-ddl.js NUNCA se invoca acá - regenera
//     sql/010/020/030 desde el .duckdb vivo; es una herramienta de autoría
//     de schema (uso manual, un commit real), no un paso de un refresh de
//     datos - correrlo automáticamente reescribiría migraciones SQL
//     versionadas sin revisión humana.
//   - governance.fn_run_rule_evaluation('FULL', ..., 'DATA_REFRESH_PUBLISH')
//     = "reevaluar Cerberus" (mismo motor, ver sql/090) - siempre FULL
//     independientemente del `mode` (INCREMENTAL/FULL) de este refresh: ese
//     modo describe cuánta DATA FUENTE se re-extrae, no cuántas reglas se
//     reevalúan (fn_run_rule_evaluation ni siquiera soporta scope_mode
//     'INCREMENTAL' todavía - ver el RAISE EXCEPTION explícito en sql/090).
//
// BUILD_WORKING_HOURS (etapa NEXUS V3 - módulo After-Hours):
//   - src/working-hours/build-working-hours.js::runApply (mismo mecanismo
//     real que `npm run working-hours:build -- apply --confirm`, invocado
//     programáticamente - runApply({from:null,to:null}) SIEMPRE, sin
//     importar el `mode` (INCREMENTAL/FULL) de este refresh: runBuild lee
//     TODAS las tareas de processed.fieldbeat_tasks y publishResults hace
//     UPSERT transaccional por fieldbeat_task_id. El refresh completo evita
//     dejar filas antiguas sin reevaluar cuando cambian contratos, matches o
//     calendarios, sin borrar las filas persistentes antes de publicar.
//     runApply devuelve {ok:false} en vez de lanzar cuando la validación
//     pre-publicación falla - este orquestador SIEMPRE revisa `.ok` y
//     lanza si es false, para que una falla de Working-Hours nunca quede
//     silenciada (ver ejecución de la etapa más abajo).
//   - gold.after_hours_by_client/by_period/by_task_type/by_technician/
//     work_analysis NO se recalculan ni se tocan acá a propósito: son
//     snapshots congelados sin generador vigente en esta rama (confirmado
//     en src/db/ownership-manifest.js::EXTERNAL_ENTRIES y
//     docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md) - /dashboard/after-hours NO
//     las consulta. La fuente real que consumen los 10 endpoints de
//     /api/dashboard/after-hours/* es la vista
//     marts.fieldbeat_working_hours_analysis_current (sql/082), que
//     resuelve en vivo sobre processed.fieldbeat_tasks LEFT JOIN
//     marts.fieldbeat_working_hours_analysis_v2 (la tabla que SÍ escribe
//     este runApply) - por eso no hace falta ninguna etapa BUILD_GOLD
//     adicional para After-Hours, la vista ya es la capa de agregación en
//     vivo.
//   - WORKING_HOURS_DB_URL (nunca SUPABASE_DB_URL_DIRECT) es la conexión
//     real de este builder (ver src/working-hours/db-client.js). NEXUS V3 -
//     un host reconocido como Supabase cloud ya no se rechaza
//     incondicionalmente: exige la misma política única de escritura que
//     cualquier otro write V3 hacia Supabase (assertSupabaseWriteAuthorized
//     - dual confirmation + project ref V3 exacto, ver
//     src/lib/db-safety.js). Sin WORKING_HOURS_DB_URL, o apuntando a un
//     Supabase cloud sin esa autorización, la etapa falla rápido y con
//     mensaje claro en vez de saltarse el módulo en silencio.
//   - NUNCA dispara `contracts:import` ni `holidays:import`. Después de
//     SYNC_POSTGRES sí reevalúa de forma append-only los matches de los
//     contratos ya importados contra el maestro FieldBeat recién cargado;
//     luego VALIDATE_AFTER_HOURS solo LEE config.current_holiday_calendar_coverage
//     para verificar que ya exista cobertura VALIDATED para cada año
//     presente en processed.fieldbeat_tasks; si falta, la corrida falla con
//     un mensaje explícito indicando qué año importar a mano (fecha
//     efectiva real, nunca inventada) - jamás reimporta un calendario ya
//     publicado ni intenta adivinar una fecha de vigencia contractual.
//
// Este archivo NUNCA carga dotenv por su cuenta (a propósito - antes tenía
// `import "dotenv/config"` acá, que cargaba en silencio el .env de la raíz
// del repo -con un SUPABASE_DB_URL_DIRECT de Supabase CLOUD- cada vez que
// faltaba esa variable. Como los imports de un módulo ES se ejecutan ANTES
// que el código propio de quien lo importa, esto pasaba incluso antes de
// que scripts/pipeline/local-refresh-worker.mjs llegara a correr su propia
// validación (requireAllEnv) - enmascarando justo lo que el requisito 1 del
// encargo exige: "reportar TODAS las variables faltantes juntas" (detectado
// con un test de integración real, ver
// test/pipeline/local-refresh-worker.integration.test.ts, incluso después de
// quitar el dotenv/config equivalente de ESE archivo). Los dos únicos
// callers reales de este orquestador (local-refresh-worker.mjs, vía
// with-local-pipeline-env.mjs, y .github/workflows/data-refresh.yml, vía
// secretos de GitHub Actions - nunca un archivo .env) ya entregan el
// entorno completo antes de invocarlo.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildWriteConfirmationToken, describeConnectionTarget, isSupabaseCloudHost, assertSupabaseWriteAuthorized } from "../../src/lib/db-safety.js";
import { mineAllFieldBeatTasks } from "../../src/miners/fieldbeat-all.js";
import { mineZendeskTickets } from "../../src/miners/zendesk.js";
import { mineDolibarrProducts } from "../../src/miners/dolibarr.js";
import { loadDuckDb } from "../../src/db/load-duckdb.js";
import { assertDuckDbLoadComplete, assertDuckDbFreshAfterLoad } from "../../src/db/duckdb-freshness.js";
import { migrateToSupabase } from "../../src/db/migrate-to-supabase.js";
import { validateSupabase } from "../../src/db/validate-supabase.js";
import { refreshContractEquipmentMatches } from "../../src/contracts/rematch-contracts.js";
import { runApply as runWorkingHoursApply } from "../../src/working-hours/build-working-hours.js";
import { findTaskYearsMissingHolidayCoverage } from "../../src/working-hours/db-writer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");

const STAGES = [
  "EXTRACT", "NORMALIZE", "BUILD_MARTS", "BUILD_GOLD", "LOAD_DUCKDB", "SYNC_POSTGRES",
  "BUILD_WORKING_HOURS", "VALIDATE_AFTER_HOURS", "VALIDATE", "REEVALUATE_RULES", "PUBLISH_SNAPSHOT"
];
const HEARTBEAT_INTERVAL_MS = 15000;

// CLI-only, sin export - se ejecutan como proceso hijo, cwd=REPO_ROOT (leen/
// escriben rutas relativas como data/raw/..., data/processed/...), sin
// argumentos (ver package.json scripts get:*/normalize:*/build:*).
const NORMALIZER_SCRIPTS = [
  "src/normalizers/fieldbeat-normalizer.js",
  "src/normalizers/zendesk-normalizer.js",
  "src/normalizers/dolibarr-normalizer.js"
];
const MART_BUILDER_SCRIPTS = [
  "src/marts/build-ticket-fieldbeat-view.js",
  "src/marts/build-used-parts-dolibarr-match.js",
  "src/marts/build-ticket-fieldbeat-dolibarr-view.js",
  "src/marts/build-fieldbeat-report-dolibarr-view.js"
];
const GOLD_BUILDER_SCRIPTS = ["src/gold/build-gold.js", "src/gold/build-fieldbeat-gold.js"];

function runNode(scriptRelPath) {
  const result = spawnSync(process.execPath, [scriptRelPath], { cwd: REPO_ROOT, env: process.env, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${scriptRelPath} salió con código ${result.status ?? "desconocido"} (señal=${result.signal ?? "ninguna"})`);
  }
}

// Nunca stack trace crudo, connection string ni credencial en
// pipeline.refresh_runs.error_summary (columna de auditoría legible por
// ambos roles de gobierno vía la UI) - mensaje corto y saneado.
function sanitizeErrorSummary(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://***")
    .split("\n")[0]
    .slice(0, 500);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno.`);
  return value;
}

// Release productivo NEXUS V3 - blocker: withPool() (el ÚNICO lugar de este
// archivo que crea un pg.Pool - ver el grep de "new pg.Pool"/"new pg.Client"
// más abajo, no hay otro) no pasaba NINGÚN objeto `ssl` explícito. Sin uno,
// node-postgres decide TLS únicamente a partir de lo que la propia
// connection string traiga (sslmode=... en la query string) o, en su
// ausencia, no negocia TLS en absoluto - un comportamiento implícito e
// indistinguible entre "esta URL ya trae su propio TLS seguro embebido" y
// "esta conexión nunca verificó nada, ni lo intentó". Todos los callers
// reales de withPool (governanceWorkerDbUrl, governanceRequesterDbUrl,
// governanceRuleEvaluatorDbUrl, y workingHoursDbUrl -tanto el
// contract-rematch como el chequeo de cobertura de feriados en
// VALIDATE_AFTER_HOURS-) quedan cubiertos automáticamente por este único
// cambio, sin tocar cada llamada por separado.
//
// Mismo concepto de "host local" que src/working-hours/db-client.js
// (localhost/127.0.0.1 - el patrón ya establecido en TODOS los db-client.js
// hermanos de src/, ver working-hours/holidays/contracts) - nunca se
// importa apps/nexus-bi-app/lib/db.ts acá (acopllaría este CLI/worker a un
// módulo pensado para el runtime Next.js, con su propio árbol de
// dependencias y supuestos de entorno). Host remoto -> rejectUnauthorized:true,
// SIN `ca` explícita: Node valida contra su trust store por defecto MÁS
// NODE_EXTRA_CA_CERTS, la misma variable que ya prepara
// .github/workflows/data-refresh.yml ANTES de arrancar este proceso (ver
// PASO 5 del reporte). Si esa variable está ausente o apunta a una CA
// incorrecta, la conexión falla por la validación TLS normal de Node - nunca
// se debilita el handshake para "intentar seguir igual".
function isLocalPipelineHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function buildPipelineSslConfig(connectionString) {
  let hostname;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    throw new Error("buildPipelineSslConfig: connection string inválida (no se pudo interpretar el host) - no se puede determinar el modo TLS.");
  }
  return isLocalPipelineHostname(hostname) ? false : { rejectUnauthorized: true };
}

// node-postgres (vía pg-connection-string) reemplaza el objeto `ssl`
// explícito de arriba si la connection string trae sus propios parámetros
// SSL en la query string - una GOVERNANCE_*_DB_URL/WORKING_HOURS_DB_URL con
// `?sslmode=...` (contenido de un secret de GitHub Actions que este código
// nunca controla ni puede ver) podría entonces pisar en silencio la
// verificación estricta de buildPipelineSslConfig. Se rechaza ANTES de crear
// cualquier Pool -nunca se elimina/modifica el parámetro automáticamente,
// exige corregir el secret a mano- y el mensaje nombra ÚNICAMENTE el
// parámetro conflictivo, nunca la connection string completa (ver
// PIPELINE_SSL_OVERRIDE_PARAMS). Implementación independiente y deliberada
// (no importada de apps/nexus-bi-app/lib/db.ts) - mismo motivo que
// buildPipelineSslConfig arriba.
const PIPELINE_SSL_OVERRIDE_PARAMS = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey"]);

export function assertNoPipelineConnectionStringSslOverrides(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("assertNoPipelineConnectionStringSslOverrides: connection string inválida (no se pudo interpretar para revisar parámetros SSL).");
  }

  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (PIPELINE_SSL_OVERRIDE_PARAMS.has(normalized)) {
      throw new Error(
        `La connection string incluye el parámetro "${normalized}", que node-postgres usa para reemplazar el objeto ssl explícito ` +
        "del Pool - el TLS de este orquestador se controla exclusivamente vía buildPipelineSslConfig + NODE_EXTRA_CA_CERTS. " +
        "Quitar ese parámetro de la connection string (nunca se elimina ni se modifica automáticamente)."
      );
    }
  }
}

async function withPool(connectionString, applicationName, fn) {
  assertNoPipelineConnectionStringSslOverrides(connectionString);
  const pool = new pg.Pool({
    connectionString,
    application_name: applicationName,
    ssl: buildPipelineSslConfig(connectionString),
    max: 2
  });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function claimNextRefreshRunOnPool(pool, { environment, executorType, workerId }) {
  const r = await pool.query(`SELECT pipeline.fn_claim_next_refresh_run($1,$2,$3) AS result`, [environment, executorType, workerId]);
  return r.rows[0].result;
}

// Variante de un solo uso (abre y cierra su propio Pool) - para invocaciones
// puntuales (ej. el modo `--start` de la CLI). El loop de polling de
// local-refresh-worker.mjs usa claimNextRefreshRunOnPool directo con un pool
// ya abierto UNA vez para toda la vida del worker - no uno nuevo por tick.
async function claimNextRefreshRun({ environment, executorType, workerId, governanceWorkerDbUrl }) {
  return withPool(governanceWorkerDbUrl, "pipeline-refresh-worker:claim", pool =>
    claimNextRefreshRunOnPool(pool, { environment, executorType, workerId })
  );
}

// Reclamo EXACTO por refresh_run_id (sql/110) - mecanismo PRINCIPAL del
// dispatch automático (workflow con refresh_run_id, ver data-refresh.yml).
// A diferencia de claimNextRefreshRun (cola genérica + comparación DESPUÉS
// de reclamar, ver checkRefreshRunClaimMatchesExpectation más abajo), esta
// función nunca puede reclamar una fila distinta a p_refresh_run_id -
// estructuralmente, no solo por comparación posterior.
async function claimRefreshRunByIdOnPool(pool, { refreshRunId, environment, executorType, claimedBy }) {
  const r = await pool.query(
    `SELECT pipeline.fn_claim_refresh_run_by_id($1,$2,$3,$4) AS result`,
    [refreshRunId, environment, executorType, claimedBy]
  );
  return r.rows[0].result;
}

async function claimRefreshRunById({ refreshRunId, environment, executorType, workerId, governanceWorkerDbUrl }) {
  return withPool(governanceWorkerDbUrl, "pipeline-refresh-worker:claim-by-id", pool =>
    claimRefreshRunByIdOnPool(pool, { refreshRunId, environment, executorType, claimedBy: workerId })
  );
}

async function startRefreshRun({ environment, mode, executorType, actorUserId, actorRole, confirmed, reason, idempotencyKey, correlationId, governanceRequesterDbUrl }) {
  return withPool(governanceRequesterDbUrl, "pipeline-refresh-requester:start", async pool => {
    const r = await pool.query(
      `SELECT pipeline.fn_start_refresh_run($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
      [environment, mode, executorType, actorUserId ?? null, actorRole ?? null, confirmed ?? false, reason ?? null, idempotencyKey ?? null, correlationId ?? null]
    );
    return r.rows[0].result;
  });
}

async function reevaluateRules(governanceRuleEvaluatorDbUrl) {
  return withPool(governanceRuleEvaluatorDbUrl, "pipeline-refresh-worker:rule-evaluation", async pool => {
    const r = await pool.query(`SELECT governance.fn_run_rule_evaluation('FULL', NULL, NULL, NULL, 'DATA_REFRESH_PUBLISH') AS evaluation_run_id`);
    return r.rows[0].evaluation_run_id;
  });
}

// Etapa SYNC_POSTGRES - el destino de escritura real (SUPABASE_DB_URL_DIRECT)
// nunca se toca sin fijar los tokens de confirmación que migrateToSupabase()
// exige internamente (assertWriteConfirmed con
// allowProtectedWithDualConfirmation=true, ver src/db/migrate-to-supabase.js)
// - equivalente programático a lo que un operador humano tipearía a mano,
// nunca un bypass del mecanismo. El guard V2/V3 (assertKnownSupabaseProject)
// vive DENTRO de migrateToSupabase() misma (opt-in vía expectedProjectRefEnvVar,
// ver ese archivo) - no se repite acá, así CUALQUIER caller de esa función
// (este orquestador y el `npm run db:pg:migrate` manual) queda cubierto por
// el mismo único chequeo.
function prepareSupabaseWriteConfirmation(supabaseDbUrlDirect) {
  const target = describeConnectionTarget(supabaseDbUrlDirect);
  const token = buildWriteConfirmationToken(target);
  process.env.CONFIRM_WRITE_TARGET = token;
  if (isSupabaseCloudHost(target.host)) {
    process.env.CONFIRM_PROTECTED_WRITE_TARGET = token;
  }
}

// Etapa BUILD_WORKING_HOURS - mismo principio que prepareSupabaseWriteConfirmation
// de arriba, pero para WORKING_HOURS_DB_URL (conexión DISTINTA, ver
// src/working-hours/db-client.js - nunca SUPABASE_DB_URL_DIRECT). NEXUS V3 -
// esta conexión SÍ puede ser "protegida" ahora (un host Supabase cloud ya
// no se rechaza incondicionalmente, ver assertNotProductionHost en
// src/working-hours/db-client.js) - por eso fija también
// CONFIRM_PROTECTED_WRITE_TARGET cuando corresponde, igual que
// prepareSupabaseWriteConfirmation arriba.
function prepareWorkingHoursWriteConfirmation(workingHoursDbUrl) {
  const target = describeConnectionTarget(workingHoursDbUrl);
  const token = buildWriteConfirmationToken(target);
  process.env.CONFIRM_WRITE_TARGET = token;
  if (isSupabaseCloudHost(target.host)) {
    process.env.CONFIRM_PROTECTED_WRITE_TARGET = token;
  }
}

// Extraída como función nombrada (mismo motivo que assertWorkingHoursApplyOk
// más abajo) para poder probar de forma aislada, sin DB, que el preflight
// de escritura ocurre y rechaza un destino no autorizado -sin esto, un
// futuro cambio en la etapa BUILD_WORKING_HOURS podría reordenar o borrar
// esta llamada (dejando de nuevo al contract-rematch detrás de un pg.Pool
// sin preflight) sin que ningún test lo note.
export function prepareAndAuthorizeWorkingHoursWrite(workingHoursDbUrl) {
  prepareWorkingHoursWriteConfirmation(workingHoursDbUrl);
  assertSupabaseWriteAuthorized(workingHoursDbUrl, { environment: process.env.NODE_ENV ?? "development" });
}

// runApply() devuelve {ok:false, validation|error} EN VEZ DE lanzar cuando
// la validación pre-publicación falla o el apply se aborta (ver
// src/working-hours/build-working-hours.js::runApply) - un caller que
// olvide revisar `.ok` seguiría de largo como si hubiera tenido éxito,
// llegando a REEVALUATE_RULES/PUBLISH_SNAPSHOT con Working-Hours roto y sin
// nadie enterarse. Extraída como función nombrada (en vez de inline) para
// poder probar esta propagación de forma aislada, sin necesitar levantar
// todo el resto de la etapa.
export function assertWorkingHoursApplyOk(result) {
  if (result.ok) return;
  const reasons = result.validation?.errors?.slice(0, 5).join("; ")
    ?? (result.error instanceof Error ? result.error.message : String(result.error ?? "razón desconocida"));
  throw new Error(`BUILD_WORKING_HOURS: apply rechazado - ${reasons}`);
}

// Defensa en profundidad (YA NO el mecanismo principal - ver
// pipeline.fn_claim_refresh_run_by_id, sql/110): el dispatch automático
// ahora reclama por refresh_run_id EXACTO, así que esta comparación es
// tautológicamente cierta en ese camino (claim.refreshRunId siempre es
// args.expectedRefreshRunId cuando claimed=true). Se conserva como red de
// seguridad ante una futura regresión que reintroduzca claim-next en el
// camino automático sin darse cuenta - función pura (sin DB) para poder
// probarla aislada, ver checkRefreshRunClaimMatchesExpectation en main().
export function checkRefreshRunClaimMatchesExpectation(claim, expectedRefreshRunId) {
  if (!expectedRefreshRunId) return { ok: true };
  if (claim.refreshRunId === expectedRefreshRunId) return { ok: true };
  return {
    ok: false,
    reason: `refresh_run_id reclamado (${claim.refreshRunId}) no coincide con el esperado por este dispatch (${expectedRefreshRunId}).`
  };
}

export async function executeClaimedRefreshRun({
  refreshRunId,
  environment,
  governanceWorkerDbUrl,
  governanceRuleEvaluatorDbUrl,
  supabaseDbUrlDirect,
  expectedProjectRefEnvVar = "SUPABASE_PROJECT_REF_V3"
}) {
  return withPool(governanceWorkerDbUrl, "pipeline-refresh-worker:execute", async pool => {
    let currentStageIndex = -1;
    const heartbeatTimer = setInterval(() => {
      pool.query(`SELECT pipeline.fn_heartbeat_refresh_run($1)`, [refreshRunId]).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    async function enterStage(stageName) {
      currentStageIndex = STAGES.indexOf(stageName);
      console.log(`[run-data-refresh] refresh_run_id=${refreshRunId} etapa=${stageName}`);
      await pool.query(`SELECT pipeline.fn_update_refresh_run_stage($1,$2)`, [refreshRunId, stageName]);
    }

    try {
      await enterStage("EXTRACT");
      // Las 3 fuentes son independientes (APIs, credenciales y directorios
      // de salida data/raw/<plataforma>/ distintos) - correrlas en paralelo
      // toma el máximo de las 3 duraciones en vez de la suma.
      const [fieldbeat, zendesk, dolibarr] = await Promise.all([
        mineAllFieldBeatTasks(),
        mineZendeskTickets(),
        mineDolibarrProducts()
      ]);
      if (fieldbeat.truncatedByPageLimit || zendesk.truncatedByPageLimit || dolibarr.truncatedByPageLimit) {
        console.warn("[run-data-refresh] ADVERTENCIA: al menos una fuente truncó su extracción por límite de páginas - ver source_stats en pipeline.refresh_runs al completar.");
      }

      await enterStage("NORMALIZE");
      for (const script of NORMALIZER_SCRIPTS) runNode(script);

      await enterStage("BUILD_MARTS");
      for (const script of MART_BUILDER_SCRIPTS) runNode(script);

      await enterStage("BUILD_GOLD");
      for (const script of GOLD_BUILDER_SCRIPTS) runNode(script);

      await enterStage("LOAD_DUCKDB");
      // Reconstruye data/warehouse/eyg_nexus.duckdb COMPLETO desde los CSV
      // que BUILD_GOLD (y las etapas anteriores) acaban de escribir - nunca
      // deja que SYNC_POSTGRES lea un .duckdb de una corrida anterior. Ambas
      // guardas son bloqueantes: cualquier excepción acá detiene el resto de
      // la secuencia exactamente igual que cualquier otra etapa (catch de
      // más abajo).
      const duckDbLoadResults = await loadDuckDb();
      assertDuckDbLoadComplete(duckDbLoadResults);
      const duckDbFreshnessChecked = await assertDuckDbFreshAfterLoad();

      await enterStage("SYNC_POSTGRES");
      prepareSupabaseWriteConfirmation(supabaseDbUrlDirect);
      const syncResult = await migrateToSupabase({ expectedProjectRefEnvVar });

      await enterStage("BUILD_WORKING_HOURS");
      // WORKING_HOURS_DB_URL se lee acá, no en requireEnv() de main(), para
      // que su ausencia en STAGING/PRODUCTION falle esta etapa puntual con
      // un mensaje claro en vez de impedir arrancar el resto del refresh.
      const workingHoursDbUrl = process.env.WORKING_HOURS_DB_URL;
      if (!workingHoursDbUrl) {
        throw new Error("BUILD_WORKING_HOURS: falta WORKING_HOURS_DB_URL en el entorno - el módulo After-Hours no está habilitado para este entorno todavía.");
      }
      // NEXUS V3 - preflight ANTES de abrir CUALQUIER conexión de escritura
      // hacia este target, incluida la del contract-rematch de abajo -antes
      // ese rematch abría su pg.Pool (vía withPool) directo, sin pasar por
      // ningún guard (ver src/contracts/rematch-contracts.js::refreshContractEquipmentMatches,
      // que recibe un pool ya abierto y confía en que su caller ya evaluó el
      // destino). Misma política única que protege cualquier otro write V3
      // hacia un destino protegido (dual confirmation + project ref V3
      // exacto para un host Supabase; sin cambios para un target local).
      prepareAndAuthorizeWorkingHoursWrite(workingHoursDbUrl);
      const rematchResult = await withPool(
        workingHoursDbUrl,
        "pipeline-refresh-worker:contract-rematch",
        pool => refreshContractEquipmentMatches(pool, { apply: true })
      );
      console.log(
        `[run-data-refresh] contract-rematch total=${rematchResult.summary.total} ` +
        `matched=${rematchResult.summary.matched} ambiguous=${rematchResult.summary.ambiguous} ` +
        `unmatched=${rematchResult.summary.unmatched} applied=${rematchResult.applied}`
      );
      const workingHoursResult = await runWorkingHoursApply({ from: null, to: null });
      assertWorkingHoursApplyOk(workingHoursResult);

      await enterStage("VALIDATE_AFTER_HOURS");
      // Nunca reimporta feriados/contratos acá - solo verifica que YA exista
      // cobertura VALIDATED para cada año presente en las tareas procesadas
      // (ver src/working-hours/db-writer.js::findTaskYearsMissingHolidayCoverage).
      // Si falta, la corrida falla con mensaje explícito - nunca SUCCEEDED
      // en silencio con tareas en HOLIDAY_COVERAGE_UNKNOWN sin que nadie lo note.
      const missingHolidayYears = await withPool(workingHoursDbUrl, "pipeline-refresh-worker:validate-after-hours", findTaskYearsMissingHolidayCoverage);
      if (missingHolidayYears.length > 0) {
        throw new Error(
          `VALIDATE_AFTER_HOURS: falta calendario de feriados (jurisdiction=CL) para el/los año(s) ${missingHolidayYears.join(", ")} ` +
          `- presentes en processed.fieldbeat_tasks pero sin cobertura VALIDATED completa en config.holiday_calendar_coverage. ` +
          `Importar el calendario faltante manualmente (npm run holidays:import, fecha efectiva real) antes de reintentar.`
        );
      }

      await enterStage("VALIDATE");
      await validateSupabase();

      await enterStage("REEVALUATE_RULES");
      const ruleEvaluationRunId = await reevaluateRules(governanceRuleEvaluatorDbUrl);

      await enterStage("PUBLISH_SNAPSHOT");
      const sourceSnapshotId = `${environment}-${new Date().toISOString()}`;
      // rows_loaded queda NULL a propósito: migrateToSupabase() solo cuenta
      // TABLAS sincronizadas (tablesMigrated/tablesFailed), no filas -
      // inventar un número de filas acá sería fabricar un dato que la fuente
      // real no reporta (ver tablesMigrated/tablesFailed en source_stats).
      const rowsExtracted = (fieldbeat.total_tasks ?? 0) + (zendesk.total ?? 0) + (dolibarr.total ?? 0);
      await pool.query(
        `SELECT pipeline.fn_complete_refresh_run($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          refreshRunId,
          ["fieldbeat", "zendesk", "dolibarr"],
          rowsExtracted,
          null,
          "PASSED",
          ruleEvaluationRunId,
          sourceSnapshotId,
          JSON.stringify({
            fieldbeat,
            zendesk,
            dolibarr,
            duckDbLoad: duckDbLoadResults,
            duckDbFreshnessChecked,
            sync: syncResult,
            workingHours: workingHoursResult
          })
        ]
      );

      clearInterval(heartbeatTimer);
      console.log(`[run-data-refresh] refresh_run_id=${refreshRunId} SUCCEEDED (snapshot=${sourceSnapshotId})`);
      return { status: "SUCCEEDED", refreshRunId, sourceSnapshotId };
    } catch (error) {
      clearInterval(heartbeatTimer);
      // "partial" = ya hubo escritura hacia Postgres (SYNC_POSTGRES en
      // adelante) cuando falló - distingue de una falla temprana (EXTRACT/
      // NORMALIZE/BUILD_*) que nunca tocó el snapshot publicado.
      const partial = currentStageIndex >= STAGES.indexOf("SYNC_POSTGRES");
      const summary = sanitizeErrorSummary(error);
      console.error(`[run-data-refresh] refresh_run_id=${refreshRunId} FALLÓ en etapa=${STAGES[currentStageIndex] ?? "DESCONOCIDA"}: ${summary}`);
      await pool.query(`SELECT pipeline.fn_fail_refresh_run($1,$2,$3,$4)`, [refreshRunId, "STAGE_FAILED", summary, partial]);
      throw error;
    }
  });
}

function parseArgs(argv) {
  const get = flag => argv.find(a => a.startsWith(`--${flag}=`))?.slice(flag.length + 3);
  return {
    environment: get("environment"),
    executorType: get("executor-type"),
    workerId: get("worker-id"),
    start: argv.includes("--start"),
    mode: get("mode"),
    confirmed: get("confirmed") === "true",
    reason: get("reason") ?? null,
    actorRole: get("actor-role") ?? null,
    actorUserId: get("actor-user-id") ?? null,
    idempotencyKey: get("idempotency-key") ?? null,
    correlationId: get("correlation-id") ?? null,
    expectedRefreshRunId: get("expected-refresh-run-id") || null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.environment || !args.executorType || !args.workerId) {
    throw new Error("Uso: run-data-refresh.mjs --environment=LOCAL|STAGING|PRODUCTION --executor-type=LOCAL|GITHUB --worker-id=<id> [--start --mode=... --confirmed=true|false --actor-role=... --reason=...] [--expected-refresh-run-id=<uuid>]");
  }

  const governanceWorkerDbUrl = requireEnv("GOVERNANCE_PIPELINE_WORKER_DB_URL");
  const governanceRuleEvaluatorDbUrl = requireEnv("GOVERNANCE_RULE_EVALUATOR_DB_URL");
  const supabaseDbUrlDirect = requireEnv("SUPABASE_DB_URL_DIRECT");

  if (args.start) {
    if (!args.mode) throw new Error("--start requiere --mode=INCREMENTAL|FULL");
    const governanceRequesterDbUrl = requireEnv("GOVERNANCE_PIPELINE_REQUESTER_DB_URL");
    const started = await startRefreshRun({
      environment: args.environment,
      mode: args.mode,
      executorType: args.executorType,
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
      confirmed: args.confirmed,
      reason: args.reason,
      idempotencyKey: args.idempotencyKey,
      correlationId: args.correlationId,
      governanceRequesterDbUrl
    });
    console.log(`[run-data-refresh] fn_start_refresh_run -> ${JSON.stringify(started)}`);
  }

  // Dos caminos de reclamo, nunca mezclados (blocker de revisión de
  // producto - "automatic exact-claim vs manual claim-next"):
  //   - Dispatch AUTOMÁTICO (llegó con --expected-refresh-run-id, ver
  //     data-refresh.yml cuando REFRESH_RUN_ID viene lleno desde el puente
  //     POST /api/data-refresh/runs): reclama EXACTAMENTE esa fila vía
  //     pipeline.fn_claim_refresh_run_by_id (sql/110) - estructuralmente no
  //     puede tocar ninguna otra. Si no puede reclamarla (ya no existe, ya
  //     no está QUEUED, o no coincide environment/executor_type - por
  //     ejemplo un segundo workflow_dispatch para el mismo refresh_run_id
  //     que llegó tarde), sale limpio: nunca cae a reclamar "lo próximo en
  //     cola" en su lugar, eso reclamaría una corrida que este dispatch en
  //     particular no pidió.
  //   - Dispatch MANUAL/emergencia (sin refresh_run_id, llenado a mano en la
  //     pestaña Actions de GitHub): conserva pipeline.fn_claim_next_refresh_run
  //     sin cambios - toma lo próximo en cola para ese entorno/ejecutor,
  //     mismo comportamiento de siempre.
  let claim;
  if (args.expectedRefreshRunId) {
    claim = await claimRefreshRunById({
      refreshRunId: args.expectedRefreshRunId,
      environment: args.environment,
      executorType: args.executorType,
      workerId: args.workerId,
      governanceWorkerDbUrl
    });
    if (!claim.claimed) {
      console.log(
        `[run-data-refresh] dispatch automático: no se pudo reclamar exactamente refresh_run_id=${args.expectedRefreshRunId} ` +
        `(motivo=${claim.reason ?? "desconocido"}) - salida limpia, ninguna otra corrida fue tocada. ` +
        "Escenario esperado si otro workflow ya la reclamó primero (doble dispatch inocuo) o si ya no está QUEUED."
      );
      return { claimed: false, reason: claim.reason };
    }
  } else {
    claim = await claimNextRefreshRun({
      environment: args.environment,
      executorType: args.executorType,
      workerId: args.workerId,
      governanceWorkerDbUrl
    });
    if (!claim.claimed) {
      console.log(`[run-data-refresh] nada QUEUED para environment=${args.environment} executor_type=${args.executorType} - sin trabajo.`);
      return { claimed: false };
    }
  }

  console.log(`[run-data-refresh] reclamado refresh_run_id=${claim.refreshRunId} (mode=${claim.mode})`);

  // Defensa en profundidad (ver comentario de
  // checkRefreshRunClaimMatchesExpectation más arriba) - tautológicamente
  // cierta en el camino automático de arriba (fn_claim_refresh_run_by_id
  // solo puede devolver claimed=true para EXACTAMENTE args.expectedRefreshRunId);
  // conservada como red de seguridad, nunca el mecanismo principal.
  const claimMatch = checkRefreshRunClaimMatchesExpectation(claim, args.expectedRefreshRunId);
  if (!claimMatch.ok) {
    console.error(`[run-data-refresh] ${claimMatch.reason} No se ejecuta el pipeline para esta corrida - se marca DISPATCH_CORRELATION_MISMATCH y queda disponible para un futuro dispatch manual (sin refresh_run_id) que sí la reclame.`);
    await withPool(governanceWorkerDbUrl, "pipeline-refresh-worker:claim-mismatch", pool =>
      pool.query(`SELECT pipeline.fn_fail_refresh_run($1,$2,$3,$4)`, [claim.refreshRunId, "DISPATCH_CORRELATION_MISMATCH", claimMatch.reason, false])
    );
    throw new Error(claimMatch.reason);
  }
  const result = await executeClaimedRefreshRun({
    refreshRunId: claim.refreshRunId,
    environment: args.environment,
    governanceWorkerDbUrl,
    governanceRuleEvaluatorDbUrl,
    supabaseDbUrlDirect
  });
  return { claimed: true, ...result };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error("[run-data-refresh] ERROR:", error.message);
    process.exit(1);
  });
}

export { claimNextRefreshRun, claimNextRefreshRunOnPool, claimRefreshRunById, claimRefreshRunByIdOnPool, startRefreshRun, STAGES };
