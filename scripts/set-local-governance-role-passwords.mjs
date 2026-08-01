#!/usr/bin/env node
// Gate B - fundación de gobierno: los roles PostgreSQL creados por
// sql/089_governance_schema.sql (nexus_app_read, nexus_app_corrections,
// nexus_audit_restricted_read, nexus_rule_evaluator,
// nexus_command_attempt_logger) quedan con la contraseña placeholder
// "__SET_IN_SUPABASE_DASHBOARD__" (no permite login) - correcto para
// Supabase cloud (la contraseña real se fija en el dashboard, nunca en un
// archivo de este repo), pero inutilizable para ejercitar la separación real
// de roles en desarrollo local.
//
// Este script SOLO corre contra un destino local/desechable ya confirmado
// (mismo guard que scripts/bootstrap-disposable-postgres.mjs - nunca Supabase
// cloud, nunca nexus-afterhours-realdata2, nunca un nombre de base que no se
// autoidentifique _test/_disposable). Genera una contraseña aleatoria por rol
// (nunca impresa a stdout - "never print environment variable values,
// tokens, passwords, or credentialed URLs"), la fija con ALTER ROLE, y
// escribe/actualiza las variables GOVERNANCE_*_DB_URL en
// apps/nexus-bi-app/.env.development.local (mismo host/puerto/base que
// SUPABASE_DB_URL, solo cambia usuario+password) - preserva cualquier otra
// línea ya presente en el archivo.
//
// ADVERTENCIA (roles cluster-wide): un rol de PostgreSQL no pertenece a una
// base específica - vive a nivel del SERVIDOR completo. Si este mismo
// contenedor Postgres aloja varias bases (ej. nexus_bi_dev_local_test de
// `npm run dev` + una base efímera de run-integration-tests-fresh.mjs), fijar
// la contraseña de "nexus_app_corrections" contra CUALQUIERA de esas bases
// invalida inmediatamente la contraseña que otra base/consumidor ya tenía
// guardada para ESE MISMO rol - no son contraseñas independientes por base.
// run-integration-tests-fresh.mjs ya lo maneja correctamente (invoca este
// script con --print-env y usa el resultado solo para el proceso hijo de esa
// corrida, nunca lo escribe a .env.development.local) - pero si corriste una
// suite de integración fresh después de la última vez que corriste este
// script en modo interactivo, .env.development.local quedó con una
// contraseña vieja para estos roles y hay que volver a correr este script
// contra el destino que quieras usar interactivamente (ej. nexus_bi_dev_local_test).
//
// Uso:
//   SUPABASE_DB_URL=postgresql://postgres:localtest@localhost:55480/nexus_bi_dev_local_test \
//     node scripts/set-local-governance-role-passwords.mjs
//
// --url=<connectionString>  usa este destino en vez de SUPABASE_DB_URL (para
//                            que run-integration-tests-fresh.mjs lo invoque
//                            contra su base única por corrida, nunca la de
//                            npm run dev).
// --print-env                imprime las líneas GOVERNANCE_*_DB_URL=... a
//                            stdout (para que el caller las capture y las
//                            inyecte al entorno de un proceso hijo) EN VEZ DE
//                            escribir .env.development.local -uso pensado
//                            para orquestación por script, no para consola
//                            interactiva (igual nunca se imprime a un log
//                            persistente/consola compartida sin necesidad).
import pg from "pg";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLikelyDisposableName, isSupabaseCloudHost, describeConnectionTarget, PROTECTED_DATABASE_NAMES } from "../src/lib/db-safety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(REPO_ROOT, "apps", "nexus-bi-app", ".env.development.local");

const GOVERNANCE_ROLES = [
  { role: "nexus_app_read", envVar: "GOVERNANCE_APP_READ_DB_URL" },
  { role: "nexus_app_corrections", envVar: "GOVERNANCE_APP_CORRECTIONS_DB_URL" },
  { role: "nexus_audit_restricted_read", envVar: "GOVERNANCE_AUDIT_RESTRICTED_READ_DB_URL" },
  { role: "nexus_rule_evaluator", envVar: "GOVERNANCE_RULE_EVALUATOR_DB_URL" },
  { role: "nexus_command_attempt_logger", envVar: "GOVERNANCE_COMMAND_ATTEMPT_LOGGER_DB_URL" },
  { role: "nexus_pipeline_requester", envVar: "GOVERNANCE_PIPELINE_REQUESTER_DB_URL" },
  { role: "nexus_pipeline_worker", envVar: "GOVERNANCE_PIPELINE_WORKER_DB_URL" }
];

function generatePassword() {
  return randomBytes(24).toString("base64url");
}

function buildConnectionString(baseUrl, user, password) {
  const url = new URL(baseUrl);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  return url.toString();
}

function upsertEnvLines(existingContent, updates) {
  const lines = existingContent ? existingContent.split("\n") : [];
  const seenKeys = new Set();
  const result = lines.map(line => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
      seenKeys.add(match[1]);
      return `${match[1]}=${updates[match[1]]}`;
    }
    return line;
  });

  while (result.length > 0 && result[result.length - 1] === "") result.pop();

  for (const [key, value] of Object.entries(updates)) {
    if (!seenKeys.has(key)) result.push(`${key}=${value}`);
  }

  result.push("");
  return result.join("\n");
}

function parseArgs(argv) {
  const url = argv.find(a => a.startsWith("--url="))?.slice("--url=".length);
  const printEnv = argv.includes("--print-env");
  return { url, printEnv };
}

async function main() {
  const { url: urlArg, printEnv } = parseArgs(process.argv.slice(2));
  const baseUrl = urlArg ?? process.env.SUPABASE_DB_URL;
  if (!baseUrl) throw new Error("Falta --url=... o SUPABASE_DB_URL en el entorno (debe apuntar al Postgres local desechable).");

  const target = describeConnectionTarget(baseUrl);
  if (PROTECTED_DATABASE_NAMES.has(target.database) || isSupabaseCloudHost(target.host)) {
    throw new Error(`ABORT: "${target.database}"@"${target.host}" es un entorno protegido - este script nunca corre ahí, sin excepción.`);
  }
  if (!isLikelyDisposableName(target.database)) {
    throw new Error(`ABORT: "${target.database}" no termina en _test/_disposable - este script se niega a operar sobre un nombre que no se autoidentifica como desechable.`);
  }

  console.log(`[set-local-governance-role-passwords] destino confirmado local/desechable: host=${target.host} port=${target.port} database=${target.database}`);

  const client = new pg.Client({ connectionString: baseUrl, application_name: "set-local-governance-role-passwords" });
  await client.connect();

  const envUpdates = {};
  try {
    for (const { role, envVar } of GOVERNANCE_ROLES) {
      const roleExists = await client.query("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1", [role]);
      if (roleExists.rowCount === 0) {
        console.log(`[set-local-governance-role-passwords] rol "${role}" no existe todavía (¿sql/089 aplicado?) - se omite.`);
        continue;
      }

      const password = generatePassword();
      // Nombre de rol viene de una lista fija hardcodeada arriba (nunca de
      // input externo) - identifier-safe por construcción, igual se cita
      // como identificador Postgres por defensa en profundidad.
      const quotedRole = `"${role.replace(/"/g, '""')}"`;
      await client.query(`ALTER ROLE ${quotedRole} WITH PASSWORD '${password.replace(/'/g, "''")}'`);
      envUpdates[envVar] = buildConnectionString(baseUrl, role, password);
      console.log(`[set-local-governance-role-passwords] contraseña local fijada para "${role}" (no impresa).`);
    }
  } finally {
    await client.end();
  }

  if (printEnv) {
    // Última parte de stdout, sin prefijo de log -fácil de parsear por un
    // script wrapper (mismo criterio que el run_id de
    // bootstrap-disposable-postgres.mjs). Nunca se destina a consola
    // interactiva compartida/log persistente sin necesidad real.
    for (const [key, value] of Object.entries(envUpdates)) {
      console.log(`${key}=${value}`);
    }
    return;
  }

  const existingContent = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const updatedContent = upsertEnvLines(existingContent, envUpdates);
  writeFileSync(ENV_FILE, updatedContent, "utf8");

  console.log(`[set-local-governance-role-passwords] Escrito: ${path.relative(REPO_ROOT, ENV_FILE)} (${Object.keys(envUpdates).length} variable(s) GOVERNANCE_*_DB_URL actualizadas).`);
}

main().catch(err => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
