#!/usr/bin/env node
import "dotenv/config";
import pg from "pg";
import { refreshContractEquipmentMatches } from "../../src/contracts/rematch-contracts.js";

const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm");
if (apply && !confirmed) {
  throw new Error("--apply requiere --confirm; sin ambos flags el comando es sólo lectura.");
}

const connectionString = process.env.WORKING_HOURS_DB_URL;
if (!connectionString) throw new Error("Falta WORKING_HOURS_DB_URL.");
const target = new URL(connectionString);
if (!['localhost', '127.0.0.1'].includes(target.hostname)) {
  throw new Error(`contracts:rematch sólo admite PostgreSQL local; host recibido: ${target.hostname}.`);
}

const pool = new pg.Pool({ connectionString, ssl: false, max: 2, application_name: "contracts-rematch" });
try {
  const result = await refreshContractEquipmentMatches(pool, { apply });
  console.log(JSON.stringify({ ...result.summary, changed: result.changed, applied: result.applied, mode: apply ? "apply" : "dry-run" }));
} finally {
  await pool.end();
}
