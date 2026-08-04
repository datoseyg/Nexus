#!/usr/bin/env node
// ETAPA 6.6D-V - limpieza opcional del Postgres local desechable creado por
// setup-local-dev-db.mjs. Solo toca el contenedor `nexus_bi_dev_local` -
// nunca nexus-afterhours-realdata2 ni ningún otro contenedor.
//
// Uso:
//   node scripts/teardown-local-dev-db.mjs
import { spawnSync } from "node:child_process";

const CONTAINER_NAME = "nexus_bi_test_disposable";

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8" });
}

function main() {
  const inspect = run("docker", ["inspect", "--format", "{{.State.Running}}", CONTAINER_NAME]);
  if (inspect.status !== 0) {
    console.log(`[teardown-local-dev-db] "${CONTAINER_NAME}" no existe - nada que limpiar.`);
    return;
  }

  const purpose = run("docker", ["inspect", "--format", "{{ index .Config.Labels \"com.eyg.nexus.database-purpose\" }}", CONTAINER_NAME]);
  if (purpose.status !== 0 || purpose.stdout.trim() !== "disposable-test") {
    console.error(`[teardown-local-dev-db] ABORT: "${CONTAINER_NAME}" no tiene la etiqueta disposable-test esperada.`);
    process.exit(1);
  }

  console.log(`[teardown-local-dev-db] Deteniendo y eliminando "${CONTAINER_NAME}"...`);
  run("docker", ["stop", CONTAINER_NAME]);
  const rm = run("docker", ["rm", CONTAINER_NAME]);
  if (rm.status !== 0) {
    console.error("ERROR: no se pudo eliminar el contenedor.", rm.stderr);
    process.exit(1);
  }
  console.log(`[teardown-local-dev-db] "${CONTAINER_NAME}" eliminado. apps/nexus-bi-app/.env.development.local queda apuntando a un destino inexistente - bórralo o volvé a correr setup-local-dev-db.mjs.`);
}

main();
