#!/usr/bin/env node
// Script LOCAL creado para el rebuild paralelo de Nexus V3 (ver informe de
// esta tarea) - NO reemplaza ningún mecanismo oficial, los ORQUESTA: mismo
// patrón que apps/nexus-bi-app/scripts/setup-local-dev-db.mjs (creación de
// contenedor + docker run postgres:16 + espera pg_isready + aplicación de
// sql/*.sql vía scripts/bootstrap-disposable-postgres.mjs, que ES el único
// mecanismo real que existe para aplicar sql/ en orden), pero con nombres
// PARALELOS que nunca chocan con el contenedor persistente actual
// (nexus_bi_dev_local, puerto 55480).
//
// El nombre de base DEBE terminar en "_disposable": es el criterio real y
// ya existente que usan tanto scripts/bootstrap-disposable-postgres.mjs
// como assertWriteConfirmed() (src/lib/db-safety.js) para aceptar un
// destino sin fricción adicional - no es una convención inventada acá, ver
// LIKELY_DISPOSABLE_NAME_PATTERN en ese archivo. El contenedor/volumen
// pueden llamarse distinto (Docker no impone esa regla), así que conservan
// el nombre "v3_clean" pedido.
//
// Guarda de seguridad explícita: aborta si el destino nuevo coincide en
// cualquier campo (contenedor/puerto/nombre de base) con el destino
// persistente actual - nunca debe ser posible que este script toque
// nexus_bi_dev_local por error de copiar/pegar.
//
// Uso: node scripts/bootstrap-v3-clean-parallel.mjs

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, "");

const PERSISTENT = { container: "nexus_bi_dev_local", port: 55480, database: "nexus_bi_dev_local" };

const CONTAINER_NAME = "nexus_bi_dev_v3_clean";
const VOLUME_NAME = "nexus_bi_dev_v3_clean_data";
const DB_NAME = "nexus_bi_dev_v3_clean_disposable"; // sufijo obligatorio, ver comentario de cabecera
const DB_PORT = 55482;
const DB_PASSWORD = randomBytes(18).toString("base64url"); // nunca impreso completo en logs de reporte
const ENV_FILE = path.join(REPO_ROOT, "apps", "nexus-bi-app", ".env.v3clean.local");

// GUARDA DE SEGURIDAD - nunca debe poder coincidir con el destino persistente.
if (CONTAINER_NAME === PERSISTENT.container || DB_PORT === PERSISTENT.port || DB_NAME === PERSISTENT.database) {
  console.error("ABORT: el destino nuevo coincide con el destino persistente actual (nexus_bi_dev_local/55480). No se ejecuta nada.");
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function dockerAvailable() {
  return run("docker", ["info"]).status === 0;
}

function containerStatus(name) {
  const result = run("docker", ["inspect", "--format", "{{.State.Running}}", name]);
  if (result.status !== 0) return "absent";
  return result.stdout.trim() === "true" ? "running" : "stopped";
}

function waitForPostgresReady(name, timeoutMs = 45000) {
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
  console.log(`[v3-clean] Postgres paralelo aislado (contenedor: ${CONTAINER_NAME}, puerto: ${DB_PORT}, base: ${DB_NAME})`);
  console.log(`[v3-clean] Destino persistente NO tocado: ${PERSISTENT.container}@${PERSISTENT.port}/${PERSISTENT.database}\n`);

  if (!dockerAvailable()) {
    console.error("ERROR: Docker no disponible.");
    process.exit(1);
  }

  const status = containerStatus(CONTAINER_NAME);
  let freshlyCreated = false;

  if (status === "running") {
    console.log(`[v3-clean] Reutilizando contenedor "${CONTAINER_NAME}" (ya corriendo) - NO se recrea el volumen.`);
  } else if (status === "stopped") {
    console.log(`[v3-clean] Contenedor "${CONTAINER_NAME}" existe pero detenido - iniciándolo.`);
    const startResult = run("docker", ["start", CONTAINER_NAME]);
    if (startResult.status !== 0) {
      console.error("ERROR: no se pudo iniciar el contenedor existente.", startResult.stderr);
      process.exit(1);
    }
  } else {
    console.log(`[v3-clean] Creando volumen "${VOLUME_NAME}"...`);
    const volResult = run("docker", ["volume", "create", "--label", "com.eyg.nexus.database-purpose=v3-clean-rebuild-candidate", VOLUME_NAME]);
    if (volResult.status !== 0) {
      console.error("ERROR: no se pudo crear el volumen.", volResult.stderr);
      process.exit(1);
    }
    console.log(`[v3-clean] Creando contenedor "${CONTAINER_NAME}" en el puerto ${DB_PORT} (postgres:16, aislado)...`);
    const createResult = run("docker", [
      "run", "-d",
      "--name", CONTAINER_NAME,
      "--label", "com.eyg.nexus.database-purpose=v3-clean-rebuild-candidate",
      "-e", `POSTGRES_PASSWORD=${DB_PASSWORD}`,
      "-e", `POSTGRES_DB=${DB_NAME}`,
      "-p", `${DB_PORT}:5432`,
      "-v", `${VOLUME_NAME}:/var/lib/postgresql/data`,
      "postgres:16"
    ]);
    if (createResult.status !== 0) {
      console.error("ERROR: no se pudo crear el contenedor.", createResult.stderr);
      process.exit(1);
    }
    freshlyCreated = true;
  }

  console.log("[v3-clean] Esperando a que Postgres acepte conexiones...");
  if (!waitForPostgresReady(CONTAINER_NAME)) {
    console.error("ERROR: Postgres no respondió pg_isready dentro del timeout.");
    process.exit(1);
  }
  console.log("[v3-clean] Postgres listo.");

  const connectionString = `postgresql://postgres:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}`;

  // Guarda extra en runtime (además de la del bootstrap oficial): confirma
  // que current_database() de la conexión recién levantada es exactamente
  // la esperada antes de aplicar ningún SQL.
  const checkDb = run("docker", ["exec", CONTAINER_NAME, "psql", "-U", "postgres", "-d", DB_NAME, "-t", "-A", "-c", "SELECT current_database();"]);
  const actualDb = (checkDb.stdout || "").trim();
  if (actualDb !== DB_NAME) {
    console.error(`ABORT: current_database() = "${actualDb}", esperado "${DB_NAME}". No se aplica SQL.`);
    process.exit(1);
  }
  console.log(`[v3-clean] Guarda verificada: current_database()="${actualDb}" (coincide con el destino esperado).`);

  console.log(freshlyCreated ? "[v3-clean] Aplicando esquema completo (sql/*.sql en orden) vía bootstrap oficial SAFETY-1..." : "[v3-clean] Contenedor reutilizado - reaplicando sql/*.sql de todos modos (idempotente).");
  {
    const sqlFiles = orderedSqlFiles();
    console.log(`[v3-clean] ${sqlFiles.length} archivos SQL a aplicar, en orden.`);
    const bootstrapArgs = ["scripts/bootstrap-disposable-postgres.mjs", `--url=${connectionString}`, ...sqlFiles.map(f => `--sql=${f}`)];
    const bootstrapResult = run("node", bootstrapArgs, { cwd: REPO_ROOT });
    process.stdout.write(bootstrapResult.stdout ?? "");
    process.stderr.write(bootstrapResult.stderr ?? "");
    if (bootstrapResult.status !== 0) {
      console.error("ERROR: falló la aplicación del esquema.");
      process.exit(1);
    }
  }

  const envContent = [
    "# Generado por scripts/bootstrap-v3-clean-parallel.mjs - Postgres PARALELO de validación.",
    "# NO reemplaza .env.development.local. Uso manual/temporal solamente.",
    `SUPABASE_DB_URL=${connectionString}`,
    `SUPABASE_DB_URL_DIRECT=${connectionString}`,
    `WORKING_HOURS_DB_URL=${connectionString}`,
    `HOLIDAYS_DB_URL=${connectionString}`,
    "DATABASE_SSL_MODE=disable",
    ""
  ].join("\n");
  writeFileSync(ENV_FILE, envContent, "utf8");

  console.log("\n[v3-clean] Listo.");
  console.log(`  host=localhost port=${DB_PORT} database=${DB_NAME} sslMode=disable password=*** (ver ${path.relative(REPO_ROOT, ENV_FILE)}, no versionado)`);
  console.log(`  Contenedor persistente actual (${PERSISTENT.container}@${PERSISTENT.port}) NO fue tocado.`);
}

main();
