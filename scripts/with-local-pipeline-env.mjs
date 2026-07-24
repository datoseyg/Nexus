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
// Este wrapper resuelve todo eso de una vez: carga .env (raíz) y luego
// SIEMPRE .env.working-hours.local por encima (override) -ese archivo
// define los 3 nombres de variable apuntando a la MISMA base local- y
// ejecuta el comando dado con ese entorno ya resuelto, sin importar desde
// qué shell o directorio se invoque este wrapper.
//
// Uso (siempre desde la raíz del repo, cwd no importa para las variables
// -este script las fija igual- pero SÍ importa para rutas relativas como
// --file=data/...):
//   node scripts/with-local-pipeline-env.mjs npm run working-hours:build -- dry-run
//   node scripts/with-local-pipeline-env.mjs npm run holidays:import -- dry-run --file=data/config/holidays/CL/2024.json
//   node scripts/with-local-pipeline-env.mjs npm run contracts:import -- --dry-run --file="data/manual/contracts/Detalles Contractuales EyG.xlsx - Clientes (2).csv"

import { spawn } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const overridePath = path.join(repoRoot, ".env.working-hours.local");

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

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Uso: node scripts/with-local-pipeline-env.mjs <comando> [args...]");
  process.exit(1);
}

for (const name of ["WORKING_HOURS_DB_URL", "HOLIDAYS_DB_URL", "SUPABASE_DB_URL_DIRECT"]) {
  const value = process.env[name];
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
