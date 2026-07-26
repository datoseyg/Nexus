#!/usr/bin/env node
// ETAPA 6.6D-V - preparación de un Postgres 16 LOCAL DESECHABLE para
// `npm run dev`. Nunca crea ni reutiliza `nexus-afterhours-realdata2`
// (protegido, ver src/lib/db-safety.js) ni toca Supabase cloud - el nombre
// de base termina en `_test` a propósito, para autoidentificarse como
// desechable ante scripts/bootstrap-disposable-postgres.mjs (SAFETY-1).
//
// Uso:
//   node scripts/setup-local-dev-db.mjs
//
// Qué hace:
//   1. Verifica que Docker esté disponible.
//   2. Crea (o reutiliza si ya existe) UN único contenedor Postgres 16
//      identificado, en un puerto fijo, con nombre de base `_test`.
//   3. Aplica el esquema (sql/*.sql en orden) solo la primera vez que se
//      crea el contenedor - vía el bootstrap oficial de SAFETY-1, que
//      además siembra la marca DISPOSABLE_TEST.
//   4. Escribe apps/nexus-bi-app/.env.development.local con la connection
//      string local y DATABASE_SSL_MODE=disable (nunca ssl entre procesos
//      del mismo host). Si ya existía un archivo previo, lo mueve a
//      `.env.development.local.previous` en vez de descartarlo.
//
// Qué NO hace: no importa datos reales (contracts/holidays/working-hours)
// - son los comandos oficiales ya existentes del pipeline (ver README de
// desarrollo local), esto solo dseja la base y el runtime conectables.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, "..");
const REPO_ROOT = path.join(APP_DIR, "..", "..");

const CONTAINER_NAME = "nexus_bi_dev_local";
const DB_NAME = "nexus_bi_dev_local_test"; // sufijo _test: se autoidentifica como desechable (db-safety.js)
const DB_PASSWORD = "localtest";
const DB_PORT = 55480;
const ENV_FILE = path.join(APP_DIR, ".env.development.local");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return result;
}

function dockerAvailable() {
  const result = run("docker", ["info"]);
  return result.status === 0;
}

function containerStatus(name) {
  const result = run("docker", ["inspect", "--format", "{{.State.Running}}", name]);
  if (result.status !== 0) return "absent";
  return result.stdout.trim() === "true" ? "running" : "stopped";
}

function waitForPostgresReady(name, timeoutMs = 30000) {
  const start = Date.now();
  let consecutiveReadyChecks = 0;
  const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() - start < timeoutMs) {
    const result = run("docker", ["exec", name, "pg_isready", "-U", "postgres"]);
    if (result.status === 0) {
      consecutiveReadyChecks++;
      if (consecutiveReadyChecks >= 5) return true;
    } else {
      consecutiveReadyChecks = 0;
    }
    // La imagen oficial levanta un servidor transitorio durante initdb y
    // luego lo reinicia. Varias comprobaciones espaciadas evitan aceptar
    // ese primer pg_isready y abrir el bootstrap durante el shutdown.
    Atomics.wait(sleepBuffer, 0, 0, 500);
  }
  return false;
}

function orderedSqlFiles() {
  const sqlDir = path.join(REPO_ROOT, "sql");
  return readdirSync(sqlDir)
    .filter(f => f.endsWith(".sql"))
    .sort()
    .map(f => path.posix.join("sql", f));
}

function main() {
  console.log(`[setup-local-dev-db] Postgres desechable local para desarrollo (contenedor: ${CONTAINER_NAME}, base: ${DB_NAME})\n`);

  if (!dockerAvailable()) {
    console.error("ERROR: Docker no está disponible (¿Docker Desktop corriendo?). No se puede continuar.");
    process.exit(1);
  }

  const status = containerStatus(CONTAINER_NAME);
  let freshlyCreated = false;

  if (status === "running") {
    console.log(`[setup-local-dev-db] Reutilizando contenedor "${CONTAINER_NAME}" (ya corriendo).`);
  } else if (status === "stopped") {
    console.log(`[setup-local-dev-db] Contenedor "${CONTAINER_NAME}" existe pero está detenido - iniciándolo.`);
    const startResult = run("docker", ["start", CONTAINER_NAME]);
    if (startResult.status !== 0) {
      console.error("ERROR: no se pudo iniciar el contenedor existente.", startResult.stderr);
      process.exit(1);
    }
  } else {
    console.log(`[setup-local-dev-db] Creando contenedor nuevo "${CONTAINER_NAME}" en el puerto ${DB_PORT}...`);
    const createResult = run("docker", [
      "run", "-d",
      "--name", CONTAINER_NAME,
      "-e", `POSTGRES_PASSWORD=${DB_PASSWORD}`,
      "-e", `POSTGRES_DB=${DB_NAME}`,
      "-p", `${DB_PORT}:5432`,
      "postgres:16"
    ]);
    if (createResult.status !== 0) {
      console.error("ERROR: no se pudo crear el contenedor.", createResult.stderr);
      process.exit(1);
    }
    freshlyCreated = true;
  }

  console.log("[setup-local-dev-db] Esperando a que Postgres acepte conexiones...");
  if (!waitForPostgresReady(CONTAINER_NAME)) {
    console.error("ERROR: Postgres no respondió pg_isready dentro del timeout.");
    process.exit(1);
  }
  console.log("[setup-local-dev-db] Postgres listo.");

  const connectionString = `postgresql://postgres:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}`;

  // Phase 3 preflight §1.2 - ANTES esto solo corría en freshlyCreated
  // ("ya se aplicó al crearlo"), asumiendo que sql/*.sql nunca cambia
  // después de la primera vez. Esa asunción se rompió en cuanto se agregó
  // sql/086_fieldbeat_quality.sql a un repo con contenedores ya existentes
  // de contribuidores/sesiones previas - un `npm run dev:local:setup`
  // sobre un contenedor reutilizado nunca recogía el archivo nuevo. Ahora
  // se reaplica SIEMPRE (fresh o reused) - seguro porque los 000-085 ya
  // eran idempotentes (CREATE TABLE/SCHEMA IF NOT EXISTS) y 086 también lo
  // es (CREATE SCHEMA IF NOT EXISTS + CREATE OR REPLACE en todo, sin DROP
  // destructivo - ver ese archivo). orderedSqlFiles() escala automático a
  // cualquier sql/*.sql nuevo, sin lista hardcodeada acá ni en ningún otro
  // lado - un solo mecanismo, nunca dos sistemas paralelos de DDL.
  console.log(
    freshlyCreated
      ? "[setup-local-dev-db] Aplicando esquema (sql/*.sql en orden) vía el bootstrap oficial SAFETY-1..."
      : "[setup-local-dev-db] Contenedor reutilizado - reaplicando sql/*.sql de todos modos (idempotente, recoge migraciones nuevas desde la última vez)..."
  );
  {
    const sqlFiles = orderedSqlFiles();
    const bootstrapArgs = ["scripts/bootstrap-disposable-postgres.mjs", `--url=${connectionString}`, ...sqlFiles.map(f => `--sql=${f}`)];
    const bootstrapResult = run("node", bootstrapArgs, { cwd: REPO_ROOT });
    process.stdout.write(bootstrapResult.stdout ?? "");
    process.stderr.write(bootstrapResult.stderr ?? "");
    if (bootstrapResult.status !== 0) {
      console.error("ERROR: falló la aplicación del esquema.");
      process.exit(1);
    }
  }

  if (existsSync(ENV_FILE)) {
    const backupPath = `${ENV_FILE}.previous`;
    console.log(`[setup-local-dev-db] Ya existía ${path.basename(ENV_FILE)} - se mueve a ${path.basename(backupPath)} (no se descarta).`);
    renameSync(ENV_FILE, backupPath);
  }

  const envContent = [
    "# Generado por scripts/setup-local-dev-db.mjs - Postgres LOCAL DESECHABLE.",
    "# Nunca apunta a Supabase cloud ni a nexus-afterhours-realdata2 (protegido).",
    "# No commitear con datos reales (este archivo ya está en .gitignore vía *.local).",
    `SUPABASE_DB_URL=${connectionString}`,
    "DATABASE_SSL_MODE=disable",
    "NEXUS_ADMIN_TOKEN=dev-local-admin-token",
    ""
  ].join("\n");
  writeFileSync(ENV_FILE, envContent, "utf8");

  console.log("\n[setup-local-dev-db] Listo.");
  console.log(`  host=localhost port=${DB_PORT} database=${DB_NAME} sslMode=disable`);
  console.log(`  Archivo escrito: ${path.relative(REPO_ROOT, ENV_FILE)}`);
  console.log("\nSiguiente paso:");
  console.log("  npm run dev            (desde apps/nexus-bi-app)");
  console.log("\nLa base está vacía (solo esquema) - para datos reales, correr desde la raíz del repo:");
  console.log(`  SUPABASE_DB_URL=${connectionString} npm run contracts:import -- --apply`);
  console.log(`  SUPABASE_DB_URL=${connectionString} npm run holidays:import -- <bundle> --apply`);
  console.log(`  SUPABASE_DB_URL=${connectionString} npm run working-hours:build -- apply`);
  console.log("  (ver flags exactos de cada script con --help; no se automatiza acá para no ejecutar imports/migraciones fuera del control explícito del desarrollador).");
}

main();
