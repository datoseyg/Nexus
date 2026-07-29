#!/usr/bin/env node
// Comando único para el pipeline completo de "Horas fuera de jornada":
// feriados (CL, todos los años con bundle disponible en
// data/config/holidays/CL/*.json, aplicados y publicados) -> construcción
// de working-hours (dry-run + apply). Contratos queda aparte a propósito
// (ver más abajo) - es un import de una sola vez con una fecha de negocio
// real (--effective-date), no algo seguro de re-ejecutar con un default
// inventado.
//
// Reutiliza el MISMO mecanismo de entorno que scripts/with-local-pipeline-env.mjs
// (.env + .env.working-hours.local por encima, override) - nunca duplica
// esa resolución de variables ni asume nombres de conexión propios.
//
// Seguro por defecto: SIN --confirm, corre SOLO los dry-run de cada
// builder (feriados: validate+dry-run por año; working-hours: dry-run) e
// imprime el plan completo - CERO escrituras. Recién con --confirm se
// aplican/publican los feriados y se hace working-hours:build apply.
//
// Uso (desde la raíz del repo):
//   node scripts/import-after-hours-pipeline.mjs                 (plan, sin escribir)
//   node scripts/import-after-hours-pipeline.mjs --confirm       (ejecuta todo)
//   node scripts/import-after-hours-pipeline.mjs --confirm --from-year=2020 --to-year=2024
//   node scripts/import-after-hours-pipeline.mjs --confirm --contracts-file="data/manual/contracts/Detalles Contractuales EyG.xlsx - Clientes (2).csv" --contracts-effective-date=2026-07-27
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(here, "..");

// Mismo override que scripts/with-local-pipeline-env.mjs - .env (raíz) +
// .env.working-hours.local ENCIMA (los 3 nombres de variable de conexión
// apuntando a la MISMA base local desechable).
loadDotenv({ path: path.join(REPO_ROOT, ".env") });
const overridePath = path.join(REPO_ROOT, ".env.working-hours.local");
const overrideResult = loadDotenv({ path: overridePath, override: true });
if (overrideResult.error) {
  console.error(`[import-after-hours-pipeline] No se pudo cargar ${overridePath}: ${overrideResult.error.message}`);
  console.error("[import-after-hours-pipeline] Creá ese archivo (ver .env.working-hours.local.example) antes de continuar.");
  process.exit(1);
}

function parseArgs(argv) {
  const confirm = argv.includes("--confirm");
  const fromYear = Number(argv.find(a => a.startsWith("--from-year="))?.slice("--from-year=".length)) || 2018;
  const toYear = Number(argv.find(a => a.startsWith("--to-year="))?.slice("--to-year=".length)) || new Date().getFullYear();
  const contractsFile = argv.find(a => a.startsWith("--contracts-file="))?.slice("--contracts-file=".length) ?? null;
  const contractsEffectiveDate = argv.find(a => a.startsWith("--contracts-effective-date="))?.slice("--contracts-effective-date=".length) ?? null;
  return { confirm, fromYear, toYear, contractsFile, contractsEffectiveDate };
}

const args = parseArgs(process.argv.slice(2));

for (const name of ["WORKING_HOURS_DB_URL", "HOLIDAYS_DB_URL", "SUPABASE_DB_URL_DIRECT"]) {
  const value = process.env[name];
  const masked = value ? value.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@") : "(no definida)";
  console.log(`[import-after-hours-pipeline] ${name}=${masked}`);
}
console.log(`[import-after-hours-pipeline] modo=${args.confirm ? "CONFIRM (escribe)" : "PLAN (solo lectura, sin --confirm)"}\n`);

function runNode(scriptRelPath, nodeArgs, { capture = false } = {}) {
  const result = spawnSync(process.execPath, [scriptRelPath, ...nodeArgs], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return result;
}

function fail(step, result) {
  console.error(`\n[import-after-hours-pipeline] FALLÓ en "${step}" (código ${result.status}). Abortando el resto del pipeline.`);
  process.exit(result.status ?? 1);
}

// ============================================================================
// 1. Feriados CL - todos los años con bundle real en data/config/holidays/CL/
//    (nunca se inventa un año sin archivo fuente - ver data/config/holidays.example.json
//    para la política de "solo fuentes oficiales, nunca calculado a mano").
// ============================================================================
console.log(`=== 1. Feriados CL, ${args.fromYear}-${args.toYear} ===`);
for (let year = args.fromYear; year <= args.toYear; year++) {
  const bundlePath = path.posix.join("data", "config", "holidays", "CL", `${year}.json`);
  if (!existsSync(path.join(REPO_ROOT, bundlePath))) {
    console.log(`  [${year}] sin bundle en ${bundlePath} - omitido (nunca se inventa un calendario sin fuente oficial).`);
    continue;
  }

  const dryRun = runNode("src/holidays/import-holidays.js", ["dry-run", `--file=${bundlePath}`]);
  if (dryRun.status !== 0) fail(`holidays dry-run ${year}`, dryRun);

  if (!args.confirm) continue;

  const apply = runNode("src/holidays/import-holidays.js", ["apply", `--file=${bundlePath}`, "--confirm"], { capture: true });
  if (apply.status !== 0) fail(`holidays apply ${year}`, apply);

  const alreadyImported = /Ya importado anteriormente/.test(apply.stdout ?? "");
  if (alreadyImported) {
    console.log(`  [${year}] ya estaba importado - sin filas nuevas, publish omitido.`);
    continue;
  }
  const coverageMatch = /coverage_id=(\d+)/.exec(apply.stdout ?? "");
  if (!coverageMatch) {
    console.error(`  [${year}] apply no devolvió coverage_id - salida inesperada, revisar manualmente.`);
    process.exit(1);
  }
  const publish = runNode("src/holidays/import-holidays.js", ["publish", `--coverage-id=${coverageMatch[1]}`]);
  if (publish.status !== 0) fail(`holidays publish ${year}`, publish);
}

// ============================================================================
// 2. Contratos - OPCIONAL, solo si se pasan ambos flags explícitos. Nunca
//    corre con una --effective-date inventada (es una fecha de negocio
//    real, no un default seguro) - por eso queda fuera del modo --confirm
//    genérico si no se especifica.
// ============================================================================
console.log(`\n=== 2. Contratos ===`);
if (!args.contractsFile) {
  console.log("  Omitido (pasa --contracts-file=<ruta> --contracts-effective-date=YYYY-MM-DD para incluirlo).");
} else {
  const dryRun = runNode("src/contracts/import-contracts.js", ["--dry-run", `--file=${args.contractsFile}`]);
  if (dryRun.status !== 0) fail("contracts dry-run", dryRun);

  if (args.confirm) {
    if (!args.contractsEffectiveDate) {
      console.error("  --contracts-file fue provisto pero falta --contracts-effective-date=YYYY-MM-DD (requerido por --apply). Omitiendo el apply de contratos.");
    } else {
      const apply = runNode("src/contracts/import-contracts.js", ["--apply", `--file=${args.contractsFile}`, `--effective-date=${args.contractsEffectiveDate}`]);
      if (apply.status !== 0) fail("contracts apply", apply);
    }
  }
}

// ============================================================================
// 3. Working-hours - dry-run siempre; apply solo con --confirm.
// ============================================================================
console.log(`\n=== 3. Working-hours build ===`);
const whDryRun = runNode("src/working-hours/build-working-hours.js", ["dry-run"]);
if (whDryRun.status !== 0) fail("working-hours dry-run", whDryRun);

if (args.confirm) {
  const whApply = runNode("src/working-hours/build-working-hours.js", ["apply", "--confirm"]);
  if (whApply.status !== 0) fail("working-hours apply", whApply);
}

console.log(`\n[import-after-hours-pipeline] Completo${args.confirm ? "" : " (PLAN - nada se escribió, correr de nuevo con --confirm para aplicar)"}.`);
