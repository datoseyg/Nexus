import { CONTRACT_TRANSFORM_VERSION } from "./transform-version.js";

export function contractImportLockKey(sourceSha256, transformVersion = CONTRACT_TRANSFORM_VERSION) {
  return `${sourceSha256}:${transformVersion}`;
}

export async function findSuccessfulContractImport(queryable, {
  sourceSha256,
  transformVersion = CONTRACT_TRANSFORM_VERSION
}) {
  const result = await queryable.query(
    `SELECT import_id
     FROM config.contract_import_runs
     WHERE source_sha256 = $1
       AND transform_version = $2
       AND import_status = 'SUCCESS'
     ORDER BY imported_at DESC, import_id DESC
     LIMIT 1`,
    [sourceSha256, transformVersion]
  );
  return result.rows[0] ?? null;
}
