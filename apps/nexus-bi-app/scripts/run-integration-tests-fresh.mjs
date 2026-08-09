#!/usr/bin/env node
// Phase 3 reapertura §3 - "no reutilices una base contaminada si la suite
// no es reentrante... corrige el harness para que cree una base única por
// ejecución; elimine únicamente esa base al terminar cuando sea seguro."
//
// Orquesta el mecanismo YA existente (nunca un sistema paralelo):
//   1. crea una base nueva, con nombre único, terminada en `_test`
//      (autoidentificada como desechable ante src/lib/db-safety.js) en el
//      MISMO servidor Postgres local desechable que ya usa `npm run dev`
//      (nexus_bi_dev_local, puerto 55480 por default - nunca crea un
//      contenedor nuevo);
//   2. la bootstrapea con scripts/bootstrap-disposable-postgres.mjs (el
//      mismo runner real, mismo orden sql/000-086 vía orderedSqlFiles());
//   3. corre scripts/run-integration-tests.mjs (el runner de suites
//      existente, sin tocar) con AFTER_HOURS_TEST_DATABASE_URL/
//      AFTER_HOURS_TEST_RUN_ID apuntando a esa base nueva;
//   4. al terminar (éxito o falla), DROP de esa base y SOLO esa base -
//      nunca toca nexus_bi_dev_local_test (la de `npm run dev`) ni
//      cualquier otra. `--keep` preserva la base para inspección manual.
//
// Uso:
//   node scripts/run-integration-tests-fresh.mjs [--keep]
//   PG_BASE_URL=postgresql://postgres:localtest@localhost:55480/postgres node scripts/run-integration-tests-fresh.mjs
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadDotenv } from "dotenv";
import { isLikelyDisposableName, isSupabaseCloudHost, describeConnectionTarget, PROTECTED_DATABASE_NAMES } from "../../../src/lib/db-safety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, "..");
const REPO_ROOT = path.join(APP_DIR, "..", "..");

// Necesario SOLO para WORKING_HOURS_DB_URL (resync post-corrida, ver abajo)
// - el resto del script sigue sin depender de ningún .env para su lógica
// principal. Silencioso si no existe (ej. CI sin ese archivo) - dotenv no
// lanza si el path no existe, `WORKING_HOURS_DB_URL` simplemente queda
// undefined y el paso de resync más abajo se salta solo.
loadDotenv({ path: path.join(REPO_ROOT, ".env") });

const KEEP = process.argv.includes("--keep");
const BASE_URL = process.env.PG_BASE_URL ?? "postgresql://postgres:localtest@localhost:55480/postgres";
const DB_NAME = `nexus_bi_it_${Date.now()}_test`;

function assertLocalAndDisposable(url, dbName) {
  const target = describeConnectionTarget(url);
  if (PROTECTED_DATABASE_NAMES.has(dbName) || isSupabaseCloudHost(target.host)) {
    throw new Error(`ABORT: destino protegido o remoto (${target.host}/${dbName}) - este script nunca opera ahí.`);
  }
  if (!isLikelyDisposableName(dbName)) {
    throw new Error(`ABORT: "${dbName}" no termina en _test/_disposable - nombre generado incorrectamente.`);
  }
  if (target.host !== "localhost" && target.host !== "127.0.0.1") {
    throw new Error(`ABORT: PG_BASE_URL debe apuntar a localhost/127.0.0.1, no a "${target.host}".`);
  }
}

function orderedSqlFiles() {
  return readdirSync(path.join(REPO_ROOT, "sql"))
    .filter(f => f.endsWith(".sql"))
    .sort()
    .map(f => path.posix.join("sql", f));
}

async function main() {
  assertLocalAndDisposable(BASE_URL, DB_NAME);
  const dbUrl = BASE_URL.replace(/\/[^/]*$/, `/${DB_NAME}`);

  console.log(`[run-integration-tests-fresh] Creando base única "${DB_NAME}"...`);
  const { Client } = pg;
  const adminClient = new Client({ connectionString: BASE_URL, ssl: false });
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await adminClient.end();
  }

  console.log("[run-integration-tests-fresh] Aplicando sql/000-086 vía el bootstrap oficial...");
  const sqlFiles = orderedSqlFiles();
  const bootstrap = spawnSync(
    process.execPath,
    ["scripts/bootstrap-disposable-postgres.mjs", `--url=${dbUrl}`, ...sqlFiles.map(f => `--sql=${f}`)],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  process.stdout.write(bootstrap.stdout ?? "");
  process.stderr.write(bootstrap.stderr ?? "");
  if (bootstrap.status !== 0) {
    await dropDatabase();
    console.error("[run-integration-tests-fresh] ERROR: falló el bootstrap - base eliminada, abortando.");
    process.exit(1);
  }
  const runId = (bootstrap.stdout ?? "").trim().split("\n").pop();

  // Gate B - test/audit/**.integration.test.ts necesita los roles de
  // gobierno (nexus_app_read/nexus_app_corrections/...) con contraseña real
  // de login contra ESTA base única, nunca la de `npm run dev` (sql/089 los
  // crea con el placeholder "__SET_IN_SUPABASE_DASHBOARD__", que no permite
  // conectarse). --print-env captura las GOVERNANCE_*_DB_URL generadas sin
  // escribir ningún archivo y sin imprimir password alguno al log de este
  // script (el script hijo solo imprime nombres de variable, nunca valores).
  console.log("[run-integration-tests-fresh] Fijando contraseñas locales de los roles de gobierno...");
  const governancePasswords = spawnSync(
    process.execPath,
    ["scripts/set-local-governance-role-passwords.mjs", `--url=${dbUrl}`, "--print-env"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  process.stderr.write(governancePasswords.stderr ?? "");
  if (governancePasswords.status !== 0) {
    await dropDatabase();
    console.error("[run-integration-tests-fresh] ERROR: falló la configuración de roles de gobierno - base eliminada, abortando.");
    process.exit(1);
  }
  const governanceEnv = {};
  for (const line of (governancePasswords.stdout ?? "").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) governanceEnv[match[1]] = match[2];
  }
  console.log(`[run-integration-tests-fresh] ${Object.keys(governanceEnv).length} rol(es) de gobierno con contraseña local fijada (no impresa).`);

  console.log(`[run-integration-tests-fresh] Corriendo test:integration contra "${DB_NAME}" (run_id=${runId})...`);
  const exitCode = await new Promise(resolve => {
    const child = spawn(process.execPath, ["scripts/run-integration-tests.mjs"], {
      cwd: APP_DIR,
      stdio: "inherit",
      env: { ...process.env, ...governanceEnv, AFTER_HOURS_TEST_DATABASE_URL: dbUrl, AFTER_HOURS_TEST_RUN_ID: runId }
    });
    child.on("exit", code => resolve(code ?? 1));
  });

  if (KEEP) {
    console.log(`[run-integration-tests-fresh] --keep: base "${DB_NAME}" preservada para inspección manual.`);
  } else {
    await dropDatabase();
  }

  await resyncInteractiveDevPasswords();

  process.exit(exitCode);

  // Este script recién rotó las contraseñas de los roles nexus_* a nivel de
  // CLÚSTER (línea ~98 arriba, vía set-local-governance-role-passwords.mjs
  // --print-env) para poder conectarse a la base efímera de esta corrida -
  // eso invalida, de paso, las mismas contraseñas que `npm run dev` sigue
  // usando contra la base interactiva (nexus_bi_dev_local_test), porque un
  // rol de Postgres es cluster-wide, no por base. Sin este paso, cualquier
  // corrida de integración deja el servidor de desarrollo roto con
  // "password authentication failed for user nexus_app_read" hasta que
  // alguien resincroniza a mano - repetido varias veces en esta sesión.
  // Resincroniza automáticamente contra el mismo destino interactivo
  // (WORKING_HOURS_DB_URL, superusuario) para que quede utilizable de
  // inmediato después de cualquier corrida de integración.
  async function resyncInteractiveDevPasswords() {
    const interactiveDevUrl = process.env.WORKING_HOURS_DB_URL;
    if (!interactiveDevUrl) {
      console.warn(
        "[run-integration-tests-fresh] Falta WORKING_HOURS_DB_URL (.env raíz) - se omite el resync automático de contraseñas de gobierno. " +
        "Si `npm run dev` empieza a fallar con \"password authentication failed\", correr manualmente: " +
        "node scripts/set-local-governance-role-passwords.mjs --url=<WORKING_HOURS_DB_URL>"
      );
      return;
    }

    console.log("[run-integration-tests-fresh] Resincronizando contraseñas de gobierno contra el destino interactivo de `npm run dev`...");
    const result = spawnSync(
      process.execPath,
      ["scripts/set-local-governance-role-passwords.mjs", `--url=${interactiveDevUrl}`],
      { cwd: REPO_ROOT, stdio: "inherit" }
    );
    if (result.status !== 0) {
      console.warn(
        "[run-integration-tests-fresh] ADVERTENCIA: el resync automático post-corrida falló (código " + result.status + "). " +
        "`npm run dev` puede necesitar node scripts/set-local-governance-role-passwords.mjs --url=<WORKING_HOURS_DB_URL> a mano."
      );
    }
  }

  async function dropDatabase() {
    console.log(`[run-integration-tests-fresh] Eliminando "${DB_NAME}" (y SOLO esa base)...`);
    const client = new Client({ connectionString: BASE_URL, ssl: false });
    await client.connect();
    try {
      await client.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } finally {
      await client.end();
    }
  }
}

main().catch(err => {
  console.error("[run-integration-tests-fresh] ERROR:", err.message);
  process.exit(1);
});
