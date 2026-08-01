// Reprocesa marts.used_parts_dolibarr_match (Postgres local desechable) con
// el mecanismo oficial (resolvePartIdentity real, sin reimplementar lógica),
// tras la ampliación de PLACEHOLDER_LITERALS. Recalcula TODAS las filas (no
// solo las NO_MATCH) para detectar cualquier regresión: un raw que antes
// matcheaba por REF_LIKE/ID_EXACT y que ahora cae en el catálogo de
// placeholders (el placeholder se evalúa ANTES que la cascada de matching,
// por diseño del resolver) debe verse y reportarse, nunca aplicarse a
// ciegas. Solo hace UPDATE de las columnas que resolvePartIdentity() calcula
// - nunca toca used_part_id/fieldbeat_task_id/part_name (columnas de origen,
// no de resolución). Modo dry-run por defecto; --apply para escribir.
import "dotenv/config";
import { Client } from "pg";
import { readCsv } from "../src/lib/csv.js";
import { resolvePartIdentity } from "../src/resolvers/part-identity-resolver.js";

const IDENTITY_MAP_FILE = "data/processed/dolibarr/DIM_Dolibarr_Product_Identity_Map.csv";
const ALIAS_FILE = "data/config/part_identity_aliases.csv";

const connectionString = process.env.WORKING_HOURS_DB_URL;
if (!connectionString || !connectionString.includes("localhost")) {
  console.error("REFUSING: WORKING_HOURS_DB_URL is not a localhost connection string.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const identityMap = await readCsv(IDENTITY_MAP_FILE);
  const aliasRows = await readCsv(ALIAS_FILE);
  console.log(`identityMap: ${identityMap.length} filas, aliasRows: ${aliasRows.length} filas`);

  const client = new Client({ connectionString });
  await client.connect();

  const { rows } = await client.query(
    `SELECT used_part_id, raw_part_identifier, match_status, match_method, match_confidence,
            normalized_part_identifier, needs_manual_review, candidate_dolibarr_product_ids,
            dolibarr_product_id, dolibarr_ref, dolibarr_barcode, dolibarr_label
     FROM marts.used_parts_dolibarr_match`
  );
  console.log(`Filas totales en marts.used_parts_dolibarr_match: ${rows.length}`);

  // Null (Postgres) vs "" (siempre el default del resolver para columnas de
  // texto no aplicables) no es una diferencia real - se normalizan igual
  // antes de comparar, campo por campo, para no marcar como "cambiada" una
  // fila que en realidad es idéntica.
  const textEq = (a, b) => (a ?? "") === (b ?? "");
  const changes = [];
  for (const row of rows) {
    const result = resolvePartIdentity(row.raw_part_identifier, identityMap, aliasRows);
    const changed =
      !textEq(result.match_status, row.match_status) ||
      !textEq(result.match_method, row.match_method) ||
      Number(result.match_confidence) !== Number(row.match_confidence ?? 0) ||
      !textEq(result.normalized_part_identifier, row.normalized_part_identifier) ||
      Boolean(result.needs_manual_review) !== Boolean(row.needs_manual_review) ||
      !textEq(result.candidate_dolibarr_product_ids, row.candidate_dolibarr_product_ids) ||
      !textEq(result.dolibarr_product_id, row.dolibarr_product_id) ||
      !textEq(result.dolibarr_ref, row.dolibarr_ref) ||
      !textEq(result.dolibarr_barcode, row.dolibarr_barcode) ||
      !textEq(result.dolibarr_label, row.dolibarr_label);

    if (changed) {
      changes.push({ used_part_id: row.used_part_id, before: row, after: result });
    }
  }

  console.log(`Filas con resultado distinto tras recalcular: ${changes.length}`);

  const statusTransitions = {};
  for (const c of changes) {
    const key = `${c.before.match_status} -> ${c.after.match_status}`;
    statusTransitions[key] = (statusTransitions[key] || 0) + 1;
  }
  console.log("Transiciones de match_status:", JSON.stringify(statusTransitions, null, 2));

  // Alerta explícita de regresión: cualquier fila que ANTES tenía un match
  // real (MATCHED/AMBIGUOUS_MATCH) y ahora cae en PLACEHOLDER_VALUE por la
  // ampliación del catálogo - no debería pasar (ningún literal nuevo es un
  // identificador Dolibarr real), pero se verifica en vez de asumir.
  const regressions = changes.filter(c => (c.before.match_status === "MATCHED" || c.before.match_status === "AMBIGUOUS_MATCH") && c.after.match_status === "PLACEHOLDER_VALUE");
  if (regressions.length > 0) {
    console.log("!!! REGRESIONES DETECTADAS (match real -> placeholder):", JSON.stringify(regressions.map(r => ({ used_part_id: r.used_part_id, raw: r.before.raw_part_identifier, before: r.before.match_status, after: r.after.match_status })), null, 2));
  } else {
    console.log("Sin regresiones: ninguna fila con match real pasó a PLACEHOLDER_VALUE.");
  }

  console.log("Muestra de 5 cambios:", JSON.stringify(changes.slice(0, 5).map(c => ({
    used_part_id: c.used_part_id, raw: c.before.raw_part_identifier,
    before_status: c.before.match_status, after_status: c.after.match_status,
    before_method: c.before.match_method, after_method: c.after.match_method
  })), null, 2));

  if (!APPLY) {
    console.log("DRY-RUN (sin --apply): no se escribió nada.");
    await client.end();
    return;
  }

  if (regressions.length > 0) {
    console.error("ABORTADO: hay regresiones (match real -> placeholder). No se aplica sin revisión manual.");
    await client.end();
    process.exit(1);
  }

  await client.query("BEGIN");
  let updated = 0;
  for (const c of changes) {
    await client.query(
      `UPDATE marts.used_parts_dolibarr_match SET
         match_status = $2, match_method = $3, match_confidence = $4,
         normalized_part_identifier = $5, needs_manual_review = $6,
         candidate_dolibarr_product_ids = $7, dolibarr_product_id = $8,
         dolibarr_ref = $9, dolibarr_barcode = $10, dolibarr_label = $11
       WHERE used_part_id = $1`,
      [
        c.used_part_id, c.after.match_status, c.after.match_method, c.after.match_confidence,
        c.after.normalized_part_identifier, c.after.needs_manual_review,
        c.after.candidate_dolibarr_product_ids || null, c.after.dolibarr_product_id || null,
        c.after.dolibarr_ref || null, c.after.dolibarr_barcode || null, c.after.dolibarr_label || null
      ]
    );
    updated += 1;
  }
  await client.query("COMMIT");
  console.log(`APLICADO: ${updated} filas actualizadas en marts.used_parts_dolibarr_match.`);
  await client.end();
}

main().catch(err => { console.error("ERROR:", err); process.exit(1); });
