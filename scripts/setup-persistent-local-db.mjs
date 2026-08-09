#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { PERSISTENT_LOCAL_DATABASE } from "./lib/persistent-local-database.mjs";

const LABEL_KEY = "com.eyg.nexus.database-purpose";
const LABEL_VALUE = "persistent-development";
const PASSWORD = process.env.NEXUS_LOCAL_DB_PASSWORD ?? "localtest";

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
}

function fail(message) {
  console.error(`[db:persistent:setup] ${message}`);
  process.exit(1);
}

function waitForPostgresReady(container, timeoutMs = 45000) {
  const start = Date.now();
  let consecutiveReadyChecks = 0;
  const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() - start < timeoutMs) {
    const result = run("docker", ["exec", container, "pg_isready", "-U", "postgres"]);
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

// Bug real corregido acá: este script nunca sembraba la marca
// NEXUS_PERSISTENT_DEVELOPMENT:v1 que assertPersistentLocalDatabase()
// (scripts/lib/persistent-local-database.mjs) exige antes de que dev-local.mjs
// o with-local-pipeline-env.mjs acepten el destino - un contenedor "fresco"
// creado solo por este script quedaba con el label Docker correcto pero sin
// la marca a nivel Postgres, y `npm run dev:local` fallaba igual.
function seedPersistentMarker(container, database) {
  if (!waitForPostgresReady(container)) {
    fail("Postgres no respondió pg_isready dentro del timeout; no se sembró la marca de desarrollo persistente.");
  }
  const comment = run("docker", [
    "exec", container, "psql", "-U", "postgres", "-d", "postgres",
    "-c", `COMMENT ON DATABASE ${database} IS '${PERSISTENT_LOCAL_DATABASE.marker}';`
  ]);
  if (comment.status !== 0) fail(`no se pudo sembrar la marca de desarrollo persistente: ${comment.stderr.trim()}`);
  console.log(`[db:persistent:setup] marca "${PERSISTENT_LOCAL_DATABASE.marker}" sembrada en ${database}.`);
}

const existing = run("docker", ["inspect", PERSISTENT_LOCAL_DATABASE.container]);
if (existing.status === 0) {
  const purpose = run("docker", ["inspect", "--format", `{{ index .Config.Labels "${LABEL_KEY}" }}`, PERSISTENT_LOCAL_DATABASE.container]);
  if (purpose.stdout.trim() !== LABEL_VALUE) {
    fail(`el contenedor ${PERSISTENT_LOCAL_DATABASE.container} existe pero no tiene la etiqueta persistente; se preserva y se aborta.`);
  }
  const start = run("docker", ["start", PERSISTENT_LOCAL_DATABASE.container]);
  if (start.status !== 0 && !/already running/i.test(start.stderr)) fail(start.stderr.trim());
  console.log("[db:persistent:setup] contenedor persistente ya existente; no se recreo ni se altero su volumen.");
  seedPersistentMarker(PERSISTENT_LOCAL_DATABASE.container, PERSISTENT_LOCAL_DATABASE.database);
  process.exit(0);
}

const label = `${LABEL_KEY}=${LABEL_VALUE}`;
const volume = run("docker", ["volume", "create", "--label", label, PERSISTENT_LOCAL_DATABASE.volume]);
if (volume.status !== 0) fail(volume.stderr.trim());

const created = run("docker", [
  "run", "-d",
  "--name", PERSISTENT_LOCAL_DATABASE.container,
  "--label", label,
  "--mount", `type=volume,source=${PERSISTENT_LOCAL_DATABASE.volume},target=/var/lib/postgresql/data`,
  "-e", `POSTGRES_PASSWORD=${PASSWORD}`,
  "-e", `POSTGRES_DB=${PERSISTENT_LOCAL_DATABASE.database}`,
  "-p", `${PERSISTENT_LOCAL_DATABASE.port}:5432`,
  "postgres:16"
]);
if (created.status !== 0) fail(created.stderr.trim());
seedPersistentMarker(PERSISTENT_LOCAL_DATABASE.container, PERSISTENT_LOCAL_DATABASE.database);
console.log("[db:persistent:setup] contenedor y volumen persistentes creados; falta restaurar o inicializar el esquema antes de usar dev:local.");
