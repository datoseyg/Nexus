import { buildClientIdentityAliasIndex, loadClientIdentityAliases } from "./client-identity-aliases.js";
import { matchAll } from "./fieldbeat-matcher.js";

function sameMatch(contract, match) {
  return contract.previous_match_status === match.matchStatus
    && contract.previous_match_method === match.matchMethod
    && (contract.previous_fieldbeat_equipment_key ?? null) === match.fieldbeatEquipmentKey
    && (contract.previous_fieldbeat_equipment_uuid ?? null) === match.fieldbeatEquipmentUuid
    && (contract.previous_fieldbeat_internal_id ?? null) === match.fieldbeatInternalId
    && Number(contract.previous_candidate_count ?? -1) === match.candidateCount;
}

export function buildContractRematchPlan({
  contracts,
  fieldbeatEquipments,
  fieldbeatClients,
  overrides,
  clientAliasIndex
}) {
  const matches = matchAll(contracts.map(contract => ({
    equipmentKey: contract.equipment_key,
    clientNameCanonical: contract.client_name_canonical,
    equipmentModel: contract.equipment_model,
    serialNumber: contract.serial_number
  })), { fieldbeatEquipments, fieldbeatClients, overrides, clientAliasIndex });

  const rows = matches.map((match, index) => ({
    observationId: contracts[index].observation_id,
    matchStatus: match.matchStatus,
    matchMethod: match.matchMethod,
    fieldbeatEquipmentKey: match.fieldbeatEquipmentKey,
    fieldbeatEquipmentUuid: match.fieldbeatEquipmentUuid,
    fieldbeatInternalId: match.fieldbeatInternalId,
    candidateCount: match.candidateCount,
    matchDetails: match.matchDetails,
    changed: !sameMatch(contracts[index], match)
  }));

  return {
    rows,
    summary: {
      total: rows.length,
      matched: rows.filter(row => row.matchStatus === "MATCHED").length,
      ambiguous: rows.filter(row => row.matchStatus === "AMBIGUOUS").length,
      unmatched: rows.filter(row => row.matchStatus === "UNMATCHED").length
    }
  };
}

async function loadRematchInputs(client) {
  const contracts = await client.query(`
      SELECT DISTINCT ON (v.equipment_key)
        o.observation_id,
        v.equipment_key,
        v.client_name_canonical,
        v.equipment_model,
        v.serial_number,
        previous.match_status AS previous_match_status,
        previous.match_method AS previous_match_method,
        previous.fieldbeat_equipment_key AS previous_fieldbeat_equipment_key,
        previous.fieldbeat_equipment_uuid AS previous_fieldbeat_equipment_uuid,
        previous.fieldbeat_internal_id AS previous_fieldbeat_internal_id,
        previous.candidate_count AS previous_candidate_count
      FROM config.contract_equipment_versions v
      JOIN config.contract_equipment_observations o
        ON o.contract_version_id = v.contract_version_id
      LEFT JOIN LATERAL (
        SELECT m.*
        FROM config.contract_equipment_matches m
        JOIN config.contract_equipment_observations mo ON mo.observation_id = m.observation_id
        WHERE mo.equipment_key = v.equipment_key
        ORDER BY mo.effective_date DESC, m.matched_at DESC, m.match_id DESC
        LIMIT 1
      ) previous ON true
      WHERE v.is_current = true
      ORDER BY v.equipment_key, o.effective_date DESC, o.created_at DESC, o.observation_id DESC
    `);
  const equipments = await client.query("SELECT equipment_key, equipment_uuid, internal_id, client_key FROM processed.fieldbeat_equipments");
  const clients = await client.query("SELECT client_key, client_name FROM processed.fieldbeat_clients");
  const overrides = await client.query("SELECT equipment_key, fieldbeat_equipment_id FROM config.contract_equipment_match_overrides WHERE active = true");

  return {
    contracts: contracts.rows,
    fieldbeatEquipments: equipments.rows,
    fieldbeatClients: clients.rows,
    overrides: overrides.rows.map(row => ({ equipmentKey: row.equipment_key, fieldbeatEquipmentId: row.fieldbeat_equipment_id })),
    clientAliasIndex: buildClientIdentityAliasIndex(loadClientIdentityAliases())
  };
}

async function insertChangedMatches(client, rows) {
  if (rows.length === 0) return;
  const values = [];
  const tuples = rows.map((row, index) => {
    const base = index * 8;
    values.push(
      row.observationId,
      row.matchStatus,
      row.matchMethod,
      row.fieldbeatEquipmentKey,
      row.fieldbeatEquipmentUuid,
      row.fieldbeatInternalId,
      row.candidateCount,
      JSON.stringify(row.matchDetails ?? {})
    );
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
  });
  await client.query(`
    INSERT INTO config.contract_equipment_matches
      (observation_id, match_status, match_method, fieldbeat_equipment_key,
       fieldbeat_equipment_uuid, fieldbeat_internal_id, candidate_count, match_details)
    VALUES ${tuples.join(",")}
  `, values);
}

export async function refreshContractEquipmentMatches(pool, { apply = false } = {}) {
  const client = await pool.connect();
  try {
    if (apply) {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["nexus-contract-equipment-rematch"]);
    }
    const plan = buildContractRematchPlan(await loadRematchInputs(client));
    const changedRows = plan.rows.filter(row => row.changed);
    if (apply) {
      await insertChangedMatches(client, changedRows);
      await client.query("COMMIT");
    }
    return { ...plan, changed: changedRows.length, applied: apply ? changedRows.length : 0 };
  } catch (error) {
    if (apply) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
