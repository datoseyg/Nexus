#!/usr/bin/env node
// Forma OFICIAL de correr holidays:import / contracts:import /
// working-hours:build contra el Postgres local desechable -evita el
// problema real que motivó este script: los 3 builders leen 3 nombres de
// variable DISTINTOS (WORKING_HOURS_DB_URL, HOLIDAYS_DB_URL,
// SUPABASE_DB_URL_DIRECT - ver src/{working-hours,holidays,contracts}/db-client.js),
// cada `import "dotenv/config"` resuelve `.env` relativo a process.cwd()
// (no a la ubicación del script), y SUPABASE_DB_URL_DIRECT en el .env raíz
// apunta a Supabase cloud real (usado por migrate-to-supabase.js) -nunca al
// Postgres local. Exportar variables a mano en la shell (`export` de Git
// Bash vs `$env:` de PowerShell vs `set` de cmd.exe) es exactamente el punto
// de fricción que hacía fallar los intentos manuales.
//
// Este wrapper resuelve todo eso de una vez: carga .env (raíz), luego
// SIEMPRE .env.working-hours.local por encima (override -ese archivo define
// WORKING_HOURS_DB_URL/HOLIDAYS_DB_URL/SUPABASE_DB_URL_DIRECT apuntando a la
// MISMA base local) y finalmente apps/nexus-bi-app/.env.development.local
// por encima de eso (override -las 7 variables GOVERNANCE_*_DB_URL que
// genera scripts/set-local-governance-role-passwords.mjs, necesarias para
// scripts/pipeline/local-refresh-worker.mjs) - y ejecuta el comando dado con
// ese entorno ya resuelto, sin importar desde qué shell o directorio se
// invoque este wrapper.
//
// El archivo de gobierno es OPCIONAL a nivel de este wrapper (a diferencia
// de .env.working-hours.local, que sigue siendo obligatorio): holidays:import/
// contracts:import/working-hours:build nunca leyeron variables GOVERNANCE_* y
// no deben romperse si ese archivo no existe todavía. El worker de refresh sí
// las necesita - su propia validación (ver local-refresh-worker.mjs) informa
// con claridad si faltan, en vez de que este wrapper aborte genéricamente.
//
// Uso (siempre desde la raíz del repo, cwd no importa para las variables
// -este script las fija igual- pero SÍ importa para rutas relativas como
// --file=data/...):
//   node scripts/with-local-pipeline-env.mjs npm run working-hours:build -- dry-run
//   node scripts/with-local-pipeline-env.mjs npm run holidays:import -- dry-run --file=data/config/holidays/CL/2024.json
//   node scripts/with-local-pipeline-env.mjs npm run contracts:import -- --dry-run --file="data/manual/contracts/Detalles Contractuales EyG.xlsx - Clientes (2).csv"
//   node scripts/with-local-pipeline-env.mjs node scripts/pipeline/local-refresh-worker.mjs

import { spawn } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertPersistentLocalDatabase, persistentLocalDatabaseUrl } from "./lib/persistent-local-database.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const overridePath = path.join(repoRoot, ".env.working-hours.local");
const governanceEnvPath = path.join(repoRoot, "apps", "nexus-bi-app", ".env.development.local");

loadDotenv({ path: path.join(repoRoot, ".env") });
const overrideResult = loadDotenv({ path: overridePath, override: true });

if (overrideResult.error) {
  console.error(`[with-local-pipeline-env] No se pudo cargar ${overridePath}: ${overrideResult.error.message}`);
  console.error(
    "[with-local-pipeline-env] Creá ese archivo con WORKING_HOURS_DB_URL / HOLIDAYS_DB_URL / " +
    "SUPABASE_DB_URL_DIRECT apuntando al Postgres local desechable (ver .env.working-hours.local.example)."
  );
  process.exit(1);
}

const governanceResult = loadDotenv({ path: governanceEnvPath, override: true });
if (governanceResult.error) {
  console.warn(
    `[with-local-pipeline-env] ${governanceEnvPath} no encontrado - las variables GOVERNANCE_*_DB_URL no estarán ` +
    "disponibles (solo hace falta para scripts/pipeline/local-refresh-worker.mjs; el resto de comandos de este " +
    "wrapper no las necesita). Generarlo con: node scripts/set-local-governance-role-passwords.mjs --url=<destino local>."
  );
}

// El destino analitico local es gobernado por el orquestador, no por los
// archivos .env. Esto evita que un .env historico vuelva a dirigir imports
// a Cloud o a la base desechable usada por tests.
const persistentDatabaseUrl = persistentLocalDatabaseUrl(process.env);
await assertPersistentLocalDatabase(persistentDatabaseUrl);
process.env.WORKING_HOURS_DB_URL = persistentDatabaseUrl;
process.env.HOLIDAYS_DB_URL = persistentDatabaseUrl;
process.env.SUPABASE_DB_URL_DIRECT = persistentDatabaseUrl;

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Uso: node scripts/with-local-pipeline-env.mjs <comando> [args...]");
  process.exit(1);
}

const ENV_NAMES_TO_LOG = [
  "WORKING_HOURS_DB_URL", "HOLIDAYS_DB_URL", "SUPABASE_DB_URL_DIRECT",
  "GOVERNANCE_PIPELINE_WORKER_DB_URL", "GOVERNANCE_RULE_EVALUATOR_DB_URL"
];
for (const name of ENV_NAMES_TO_LOG) {
  const value = process.env[name];
  // Enmascarado SIEMPRE (host/puerto/base visibles, usuario/contraseña
  // nunca) - nunca se imprime un valor ni una contraseña completa acá.
  const masked = value ? value.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@") : "(no definida)";
  console.log(`[with-local-pipeline-env] ${name}=${masked}`);
}

// shell:true SOLO para comandos que en Windows son .cmd/.bat (npm, npx) -no
// para `node` directo: cmd.exe re-tokeniza argv y rompe rutas con espacios/
// paréntesis (ej. "data/manual/contracts/Detalles Contractuales EyG.xlsx -
// Clientes (2).csv"), que sí llegan intactos a un spawn sin shell.
const needsShell = process.platform === "win32" && ["npm", "npx", "npm.cmd", "npx.cmd"].includes(cmd);

const child = spawn(cmd, args, {
  stdio: "inherit",
  cwd: repoRoot,
  env: process.env,
  shell: needsShell
});

child.on("exit", code => process.exit(code ?? 1));
child.on("error", error => {
  console.error("[with-local-pipeline-env] Error al lanzar el comando:", error);
  process.exit(1);
});
