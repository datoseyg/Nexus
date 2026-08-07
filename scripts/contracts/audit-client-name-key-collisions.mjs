#!/usr/bin/env node
// Auditoría de una sola corrida, de solo lectura: agrupa
// config.contract_equipment_versions por client_name_key y reporta (1)
// claves vacías/NULL remanentes y (2) grupos donde más de una grafía de
// client_name_canonical comparte la misma clave.
//
// Clasificación: bajo el algoritmo real de folding (case-fold + strip de
// diacríticos + colapso de espacios, src/contracts/client-name-key.js), dos
// grafías solo pueden compartir clave si son ortográficamente casi
// idénticas (mismas palabras, mismo orden, solo difieren en
// mayúsculas/tildes/espacios) -el algoritmo no puede por sí mismo fusionar
// dos nombres con tokens distintos (ej. nunca fusionaría "ROS" con "Radio
// Oncología del Sur"). Por eso este script NO aplica un clasificador
// automático por distancia de edición (prohibido explícitamente por el
// plan) -sugiere ORTHOGRAPHIC_VARIANTS como default y deja evidencia
// completa para que la aprobación real sea humana; cualquier grupo se
// imprime igual, marcado NEEDS_HUMAN_REVIEW hasta que alguien lo revise.
//
// Uso:
//   node scripts/with-local-pipeline-env.mjs npm run contracts:audit-client-name-key
//
// Exit code: 0 siempre (es un reporte, no un gate) -sql/104 decide por su
// cuenta si abortar según NULLs remanentes; este script es evidencia para
// el reporte final, no un paso bloqueante en sí mismo.

import { createPool, getConnectionString } from "../../src/contracts/db-client.js";
import { assertWriteConfirmed, printConnectionPreflight } from "../../src/lib/db-safety.js";

const APPLICATION_NAME = "contracts-audit-client-name-key";

async function main() {
  const connectionString = getConnectionString();
  // Solo lectura, pero igual se pasa por el mismo guard de destino que el
  // resto de los scripts de esta familia -consistencia, y evita que este
  // reporte se corra sin querer contra un destino no confirmado.
  assertWriteConfirmed(connectionString, { environment: process.env.NODE_ENV ?? "development", applicationName: APPLICATION_NAME });
  printConnectionPreflight(connectionString, { environment: process.env.NODE_ENV ?? "development", applicationName: APPLICATION_NAME });

  const pool = createPool({ applicationName: APPLICATION_NAME });

  try {
    const blankOrNullResult = await pool.query(
      `SELECT contract_version_id, client_name_raw, client_name_key
       FROM config.contract_equipment_versions
       WHERE client_name_key IS NULL OR BTRIM(client_name_key) = ''
       ORDER BY contract_version_id`
    );

    console.log("\n[audit] Filas con client_name_key NULL o vacío:");
    if (blankOrNullResult.rows.length === 0) {
      console.log("  Ninguna.");
    } else {
      for (const row of blankOrNullResult.rows) {
        console.log(`  contract_version_id=${row.contract_version_id} client_name_raw=${JSON.stringify(row.client_name_raw)} client_name_key=${JSON.stringify(row.client_name_key)}`);
      }
    }

    const collisionResult = await pool.query(
      `SELECT client_name_key,
              array_agg(DISTINCT client_name_canonical ORDER BY client_name_canonical) AS canonical_variants,
              array_agg(contract_version_id ORDER BY contract_version_id) AS contract_version_ids
       FROM config.contract_equipment_versions
       WHERE client_name_key IS NOT NULL AND BTRIM(client_name_key) <> ''
       GROUP BY client_name_key
       HAVING COUNT(DISTINCT client_name_canonical) > 1
       ORDER BY client_name_key`
    );

    console.log("\n[audit] Grupos con más de una grafía canónica bajo la misma client_name_key:");
    if (collisionResult.rows.length === 0) {
      console.log("  Ninguno -cada client_name_key mapea a exactamente una grafía canónica.");
    } else {
      for (const row of collisionResult.rows) {
        console.log(`  client_name_key=${JSON.stringify(row.client_name_key)} -> ${JSON.stringify(row.canonical_variants)} (contract_version_id: ${row.contract_version_ids.join(", ")})`);
        console.log("    Clasificación sugerida: ORTHOGRAPHIC_VARIANTS (bajo el algoritmo real, solo mayúsculas/tildes/espacios pueden producir esta convergencia) -NEEDS_HUMAN_REVIEW antes de aprobar.");
      }
    }

    const totalGroupsResult = await pool.query(
      `SELECT COUNT(DISTINCT client_name_key)::int AS distinct_keys, COUNT(*)::int AS total_rows
       FROM config.contract_equipment_versions`
    );
    console.log(`\n[audit] Resumen: ${totalGroupsResult.rows[0].total_rows} filas totales, ${totalGroupsResult.rows[0].distinct_keys} claves de cliente distintas.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("[audit-client-name-key] Error inesperado:", error);
  process.exitCode = 1;
});
