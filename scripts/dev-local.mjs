#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachSignalForwarding,
  buildNextEnvironment,
  ensureLocalRuntime,
  shouldUseShellForNpm
} from "./lib/local-dev-runtime.mjs";
import { assertPersistentLocalDatabase, persistentLocalDatabaseUrl, retargetPersistentLocalDatabaseUrl } from "./lib/persistent-local-database.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const runtime = await ensureLocalRuntime({ repoRoot });
  console.log(
    runtime.action === "started"
      ? `[dev:local] Supabase local iniciado y disponible en ${runtime.apiUrl}.`
      : `[dev:local] Supabase local ya estaba disponible en ${runtime.apiUrl}.`
  );
  console.log("[dev:local] Iniciando Nexus. Ctrl+C detiene Next.js; Supabase permanece activo.");

  const analyticsDatabaseUrl = persistentLocalDatabaseUrl(process.env);
  await assertPersistentLocalDatabase(analyticsDatabaseUrl);

  const appEnvironmentPath = path.join(repoRoot, "apps", "nexus-bi-app", ".env.development.local");
  const appEnvironment = existsSync(appEnvironmentPath)
    ? parseDotenv(readFileSync(appEnvironmentPath, "utf8"))
    : {};
  const nextEnvironment = buildNextEnvironment(runtime.apiUrl, analyticsDatabaseUrl, {
    ...appEnvironment,
    ...process.env
  });
  for (const [name, value] of Object.entries(nextEnvironment)) {
    if (name.startsWith("GOVERNANCE_") && name.endsWith("_DB_URL") && value) {
      nextEnvironment[name] = retargetPersistentLocalDatabaseUrl(value);
    }
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "dev"], {
    cwd: path.join(repoRoot, "apps", "nexus-bi-app"),
    env: nextEnvironment,
    shell: shouldUseShellForNpm(),
    stdio: "inherit"
  });
  const detach = attachSignalForwarding(process, child);
  child.once("error", error => {
    detach();
    console.error(`[dev:local] No se pudo iniciar Next.js: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", code => {
    detach();
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(`[dev:local] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
