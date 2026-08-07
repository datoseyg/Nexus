#!/usr/bin/env node
// Backfill de una sola corrida: calcula
// config.contract_equipment_versions.client_name_key para filas existentes
// (client_name_key IS NULL), reutilizando el MISMO helper que ya usa el
// importador (src/contracts/client-name-key.js) -cero reimplementación del
// algoritmo de folding. Es una función pura por fila (client_name_key =
// buildContractClientNameKey(client_name_raw)) -no depende de reproducir el
// orden histórico de corridas de importación, a diferencia de
// client_name_canonical.
//
// Debe correr DESPUÉS de aplicar sql/103 Y de desplegar el writer ya
// actualizado (src/contracts/db-writer.js persistiendo client_name_key en
// filas nuevas) -si el backfill corriera antes, una importación nueva
// podría colarse con la columna vacía entre este backfill y sql/104's SET
// NOT NULL (ver "Orden de despliegue real" del plan).
//
// Uso (siempre vía el wrapper oficial -nunca variables de entorno a mano,
// ver scripts/with-local-pipeline-env.mjs):
//   node scripts/with-local-pipeline-env.mjs npm run contracts:backfill-client-name-key
//   node scripts/with-local-pipeline-env.mjs npm run contracts:backfill-client-name-key -- --apply
//
// Por defecto corre en modo dry-run (calcula y reporta, nunca escribe)
// -mismo convenio que src/contracts/cli.js (contracts:import): --apply
// nunca es implícito. assertWriteConfirmed() (mismo guard que
// applyContracts()) se evalúa ANTES de abrir cualquier conexión, en ambos
// modos -así un --apply accidental contra un destino no confirmado nunca
// pasa desapercibido solo porque la corrida anterior fue dry-run.

import { createPool, getConnectionString } from "../../src/contracts/db-client.js";
import { assertWriteConfirmed, printConnectionPreflight } from "../../src/lib/db-safety.js";
// Ver comentario en apps/nexus-bi-app/lib/contract-client-name-key.js sobre
// por qué la implementación vive ahí (Bloque 2 NEXUS V3).
import { buildContractClientNameKey } from "../../apps/nexus-bi-app/lib/contract-client-name-key.js";

const BATCH_SIZE = 500;
const APPLICATION_NAME = "contracts-backfill-client-name-key";

function parseArgs(argv) {
  return { apply: argv.includes("--apply") };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const connectionString = getConnectionString();

  assertWriteConfirmed(connectionString, {
    environment: process.env.NODE_ENV ?? "development",
    applicationName: APPLICATION_NAME
  });
  printConnectionPreflight(connectionString, { environment: process.env.NODE_ENV ?? "development", applicationName: APPLICATION_NAME });
  console.log(`[backfill-client-name-key] Modo: ${apply ? "APPLY (escribe)" : "DRY-RUN (solo reporta, no escribe)"}`);

  const pool = createPool({ applicationName: APPLICATION_NAME });

  let rowsRead = 0;
  let rowsUpdated = 0;
  const blankKeyRows = [];

  try {
    const alreadyKeyedResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM config.contract_equipment_versions WHERE client_name_key IS NOT NULL`
    );
    const rowsAlreadyKeyed = alreadyKeyedResult.rows[0].count;

    // Paginación por keyset (contract_version_id > lastSeenId), no por el
    // WHERE client_name_key IS NULL por sí solo -en dry-run nunca se
    // actualiza nada, así que un cursor basado en "lo que ya no aparece en
    // el WHERE" nunca avanzaría (loop infinito). El keyset avanza siempre,
    // en ambos modos.
    let lastSeenId = 0;
    for (;;) {
      const batchResult = await pool.query(
        `SELECT contract_version_id, client_name_raw
         FROM config.contract_equipment_versions
         WHERE client_name_key IS NULL AND contract_version_id > $1
         ORDER BY contract_version_id
         LIMIT $2`,
        [lastSeenId, BATCH_SIZE]
      );

      if (batchResult.rows.length === 0) break;

      for (const row of batchResult.rows) {
        lastSeenId = row.contract_version_id;
        rowsRead += 1;

        const key = buildContractClientNameKey(row.client_name_raw);
        if (key === "") {
          // Nunca se persiste una clave vacía -ver "NOT NULL no evita
          // claves vacías" del plan. Se reporta para revisión humana, no se
          // omite silenciosamente.
          blankKeyRows.push({ contractVersionId: row.contract_version_id, clientNameRaw: row.client_name_raw });
          continue;
        }

        if (apply) {
          await pool.query(
            `UPDATE config.contract_equipment_versions SET client_name_key = $1 WHERE contract_version_id = $2`,
            [key, row.contract_version_id]
          );
        }
        rowsUpdated += 1;
      }
    }

    console.log("\n[backfill-client-name-key] Resultado:");
    console.log(`  Filas con clave ya asignada antes de esta corrida: ${rowsAlreadyKeyed}`);
    console.log(`  Filas leídas (client_name_key IS NULL): ${rowsRead}`);
    console.log(`  Filas ${apply ? "actualizadas" : "que se actualizarían con --apply"}: ${rowsUpdated}`);
    console.log(`  Filas con clave vacía (bloqueantes, NUNCA persistidas): ${blankKeyRows.length}`);
    if (blankKeyRows.length > 0) {
      console.log("  Detalle de filas con clave vacía:");
      for (const r of blankKeyRows) {
        console.log(`    contract_version_id=${r.contractVersionId} client_name_raw=${JSON.stringify(r.clientNameRaw)}`);
      }
    }

    if (apply) {
      const remainingNullResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM config.contract_equipment_versions WHERE client_name_key IS NULL`
      );
      const remainingNull = remainingNullResult.rows[0].count;
      console.log(`  Filas con client_name_key todavía NULL al terminar: ${remainingNull}`);
      if (remainingNull > 0) {
        console.error(
          "\n[backfill-client-name-key] ABORT: quedan filas con client_name_key NULL tras el backfill " +
          "(coincide con las de clave vacía listadas arriba) -no se puede aplicar sql/104 (SET NOT NULL) " +
          "hasta resolverlas manualmente."
        );
        process.exitCode = 1;
        return;
      }
    }

    if (blankKeyRows.length > 0) {
      console.error(
        `\n[backfill-client-name-key] ABORT: ${blankKeyRows.length} fila(s) con client_name_raw vacío/solo-espacios ` +
        "produjeron una clave vacía -revisar el dato fuente antes de reintentar (ver detalle arriba)."
      );
      process.exitCode = 1;
      return;
    }

    console.log(`\n[backfill-client-name-key] OK${apply ? "" : " (dry-run -nada se escribió; reintentar con --apply)"}.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("[backfill-client-name-key] Error inesperado:", error);
  process.exitCode = 1;
});
