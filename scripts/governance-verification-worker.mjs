#!/usr/bin/env node
// Gate B - worker de verificación (outbox con lease + fencing token, B7/B8/
// B79/B84/B88) y disparador manual del ejecutor de reglas
// (governance.fn_run_rule_evaluation). Corre como identidad de servicio
// dedicada (rol PostgreSQL nexus_rule_evaluator, GOVERNANCE_RULE_EVALUATOR_DB_URL)
// - nunca reutiliza sesión humana ni el token admin legacy (Gate A 23.4).
//
// Reclamo corto vía FOR UPDATE SKIP LOCKED (fn_claim_verification_requests) +
// fencing token (claim_token) - un worker cuya lease expiró nunca puede
// completar una solicitud que otro worker ya reclamó de nuevo (B88): toda
// llamada posterior exige el claim_token vigente, devuelve false/CLAIM_LOST
// si no coincide, sin tocar issue/evidence/request/event log.
//
// governance.fn_run_rule_evaluation usa pg_advisory_xact_lock (B7/B85) - se
// libera automáticamente al terminar la transacción implícita de una sola
// sentencia, así que una llamada vía pool.query() normal es segura (no es el
// caso de pg_advisory_lock de sesión, que sí requeriría una conexión
// dedicada retenida con try/finally).
//
// Uso:
//   node scripts/governance-verification-worker.mjs verify [--once] [--batch-size=10] [--lease-seconds=60] [--poll-interval-ms=5000]
//   node scripts/governance-verification-worker.mjs evaluate --scope=FULL
//   node scripts/governance-verification-worker.mjs evaluate --scope=SCOPED --rule-code=PART_NO_MATCH [--entity-key=...] [--occurrence-key=...]
import pg from "pg";
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const command = argv[0];
  const flags = {};
  for (const arg of argv.slice(1)) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] ?? true;
  }
  return { command, flags };
}

function resolveConnectionString() {
  const connectionString = process.env.GOVERNANCE_RULE_EVALUATOR_DB_URL;
  if (!connectionString) {
    throw new Error(
      "Falta GOVERNANCE_RULE_EVALUATOR_DB_URL en el entorno - este worker corre exclusivamente con el rol " +
      "nexus_rule_evaluator (nunca con SUPABASE_DB_URL/sesión humana). En desarrollo local: " +
      "node scripts/set-local-governance-role-passwords.mjs. En producción: fijar la contraseña del rol en " +
      "el dashboard de Supabase y configurar esta variable."
    );
  }
  return connectionString;
}

const SERVICE_KEY = `governance-verification-worker:${process.pid}:${randomUUID().slice(0, 8)}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function claimBatch(pool, batchSize, leaseSeconds) {
  const result = await pool.query(
    "SELECT * FROM governance.fn_claim_verification_requests($1, $2, $3)",
    [SERVICE_KEY, batchSize, leaseSeconds]
  );
  return result.rows;
}

async function processClaim(pool, claim) {
  try {
    const result = await pool.query(
      "SELECT governance.fn_complete_verification_request($1, $2, $3::uuid) AS result",
      [SERVICE_KEY, claim.request_id, claim.claim_token]
    );
    const outcome = result.rows[0]?.result;
    console.log(`[governance-verification-worker] request_id=${claim.request_id} issue_id=${claim.issue_id} rule=${claim.rule_code} -> ${JSON.stringify(outcome)}`);
    return outcome;
  } catch (error) {
    console.error(`[governance-verification-worker] request_id=${claim.request_id} ERROR: ${error.message} - reprogramando`);
    await pool.query(
      "SELECT governance.fn_reschedule_verification_request($1, $2, $3::uuid, $4, $5)",
      [SERVICE_KEY, claim.request_id, claim.claim_token, error.code ?? "OPERATIONAL_ERROR", 60]
    );
    return { result: "OPERATIONAL_ERROR", error: error.message };
  }
}

async function runVerifyOnce(pool, batchSize, leaseSeconds) {
  const claims = await claimBatch(pool, batchSize, leaseSeconds);
  if (claims.length === 0) {
    console.log("[governance-verification-worker] nada pendiente para reclamar.");
    return 0;
  }
  console.log(`[governance-verification-worker] ${claims.length} solicitud(es) reclamada(s).`);
  for (const claim of claims) {
    await processClaim(pool, claim);
  }
  return claims.length;
}

async function commandVerify(flags) {
  const once = flags.once === true;
  const batchSize = Number(flags["batch-size"] ?? 10);
  const leaseSeconds = Number(flags["lease-seconds"] ?? 60);
  const pollIntervalMs = Number(flags["poll-interval-ms"] ?? 5000);

  const pool = new pg.Pool({ connectionString: resolveConnectionString(), max: 3 });
  console.log(`[governance-verification-worker] service_key=${SERVICE_KEY} batchSize=${batchSize} leaseSeconds=${leaseSeconds} once=${once}`);

  try {
    if (once) {
      await runVerifyOnce(pool, batchSize, leaseSeconds);
      return;
    }

    let shuttingDown = false;
    const shutdown = () => {
      console.log("[governance-verification-worker] señal de apagado recibida, terminando tras el ciclo en curso...");
      shuttingDown = true;
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    while (!shuttingDown) {
      const claimed = await runVerifyOnce(pool, batchSize, leaseSeconds);
      if (claimed === 0) await sleep(pollIntervalMs);
    }
  } finally {
    await pool.end();
  }
}

async function commandEvaluate(flags) {
  const scope = flags.scope ?? "FULL";
  if (scope !== "FULL" && scope !== "SCOPED") {
    throw new Error(`--scope debe ser FULL o SCOPED (recibido: ${scope})`);
  }
  if (scope === "SCOPED" && !flags["rule-code"]) {
    throw new Error("--scope=SCOPED requiere --rule-code");
  }

  const pool = new pg.Pool({ connectionString: resolveConnectionString(), max: 1 });
  try {
    console.log(`[governance-verification-worker] disparando fn_run_rule_evaluation(scope=${scope})...`);
    const result = await pool.query(
      "SELECT governance.fn_run_rule_evaluation($1, $2, $3, $4, 'MANUAL_ADMIN') AS run_id",
      [scope, flags["rule-code"] ?? null, flags["entity-key"] ?? null, flags["occurrence-key"] ?? null]
    );
    const runId = result.rows[0]?.run_id;
    const runInfo = await pool.query(
      "SELECT status, issues_new, issues_disappeared, error_message FROM governance.rule_evaluation_runs WHERE evaluation_run_id = $1",
      [runId]
    );
    console.log(`[governance-verification-worker] evaluation_run_id=${runId}`, runInfo.rows[0]);
  } finally {
    await pool.end();
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === "verify") {
    await commandVerify(flags);
  } else if (command === "evaluate") {
    await commandEvaluate(flags);
  } else {
    console.error("Uso: node scripts/governance-verification-worker.mjs <verify|evaluate> [flags]");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
