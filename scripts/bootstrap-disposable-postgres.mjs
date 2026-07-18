#!/usr/bin/env node
// ETAPA SAFETY-1 - Bootstrap único y consistente para CUALQUIER Postgres
// desechable usado por una suite de integración de este repo. Aplica los
// archivos SQL pedidos y siembra la marca DISPOSABLE_TEST (COMMENT ON
// DATABASE) -el único mecanismo autorizado para hacerlo (ningún test puede
// sembrarla él mismo, ver src/lib/db-safety.js). Imprime el run_id
// generado; el caller debe exportarlo como variable de entorno para que la
// suite lo use en assertDisposableTarget().
//
// Uso:
//   node scripts/bootstrap-disposable-postgres.mjs \
//     --url=postgresql://postgres:localtest@localhost:PORT/DBNAME \
//     --sql=sql/000_roles_and_schemas.sql --sql=sql/005_raw.sql ...
//
// DBNAME DEBE terminar en _test o _disposable -este script se niega a
// sembrar la marca en cualquier otro nombre (defensa en profundidad: aunque
// alguien apunte esto por error a un destino real, el propio nombre no
// calificaría como desechable y el script aborta antes de tocar nada).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isLikelyDisposableName, describeConnectionTarget, PROTECTED_DATABASE_NAMES, seedDisposableMarker } from "../src/lib/db-safety.js";

function parseArgs(argv) {
  const url = argv.find(a => a.startsWith("--url="))?.slice("--url=".length);
  const sqlFiles = argv.filter(a => a.startsWith("--sql=")).map(a => a.slice("--sql=".length));
  return { url, sqlFiles };
}

async function main() {
  const { url, sqlFiles } = parseArgs(process.argv.slice(2));
  if (!url) throw new Error("Falta --url=postgresql://...");

  const target = describeConnectionTarget(url);
  if (PROTECTED_DATABASE_NAMES.has(target.database) || target.host.endsWith(".supabase.co")) {
    throw new Error(`ABORT: "${target.database}"@"${target.host}" es un entorno protegido -este script nunca siembra la marca ahí, sin excepción.`);
  }
  if (!isLikelyDisposableName(target.database)) {
    throw new Error(`ABORT: "${target.database}" no termina en _test/_disposable -este script se niega a operar sobre un nombre que no se autoidentifica como desechable.`);
  }

  const client = new pg.Client({ connectionString: url, application_name: "bootstrap-disposable-postgres" });
  await client.connect();
  try {
    for (const file of sqlFiles) {
      const ddl = await readFile(file, "utf8");
      await client.query(ddl);
    }
    const runId = randomUUID();
    await seedDisposableMarker(client, runId);
    console.log(`[bootstrap] destino: host=${target.host} port=${target.port} database=${target.database} user=${target.user}`);
    console.log(`[bootstrap] marca DISPOSABLE_TEST sembrada, run_id=${runId}`);
    console.log(runId); // última línea, sin prefijo -fácil de capturar con `tail -1` en scripts wrapper
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
