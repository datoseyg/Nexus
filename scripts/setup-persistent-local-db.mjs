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

const existing = run("docker", ["inspect", PERSISTENT_LOCAL_DATABASE.container]);
if (existing.status === 0) {
  const purpose = run("docker", ["inspect", "--format", `{{ index .Config.Labels "${LABEL_KEY}" }}`, PERSISTENT_LOCAL_DATABASE.container]);
  if (purpose.stdout.trim() !== LABEL_VALUE) {
    fail(`el contenedor ${PERSISTENT_LOCAL_DATABASE.container} existe pero no tiene la etiqueta persistente; se preserva y se aborta.`);
  }
  const start = run("docker", ["start", PERSISTENT_LOCAL_DATABASE.container]);
  if (start.status !== 0 && !/already running/i.test(start.stderr)) fail(start.stderr.trim());
  console.log("[db:persistent:setup] contenedor persistente ya existente; no se recreo ni se altero su volumen.");
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
console.log("[db:persistent:setup] contenedor y volumen persistentes creados; falta restaurar o inicializar el esquema antes de usar dev:local.");
