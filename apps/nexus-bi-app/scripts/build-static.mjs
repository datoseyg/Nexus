import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Wrapper de `next build` para los modos Cloudflare Pages - "static" (ver
// docs/CLOUD_SMOKE_TEST.md) y "d1" (ver docs/CLOUDFLARE_D1_MIGRATION.md).
// `output: "export"` (activado en next.config.ts para cualquiera de los dos
// modos) es incompatible con los ~30 Route Handlers dinámicos de
// app/api/** (leen request.nextUrl.searchParams para filtrar contra
// DuckDB) - Next.js aborta el build entero si los detecta.
//
// En vez de tocar cada route.ts para forzarlo "static" (30 archivos, y de
// todos modos esos endpoints no tienen sentido sin el warehouse DuckDB en
// Cloudflare Pages), este script saca app/api/ del árbol ANTES de invocar
// `next build` y lo restaura después, pase lo que pase. El modo
// local-duckdb (`npm run dev` / `npm run build` normales) nunca pasa por
// este script y no se ve afectado.

const APP_DIR = path.join(process.cwd(), "app");
const API_DIR = path.join(APP_DIR, "api");
const API_STASH_DIR = path.join(process.cwd(), ".cloud-static-build-tmp", "api");
const NEXT_CACHE_DIR = path.join(process.cwd(), ".next");

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!["static", "d1"].includes(process.env.NEXT_PUBLIC_DATA_MODE)) {
    throw new Error(
      'build-static.mjs requiere NEXT_PUBLIC_DATA_MODE=static o "d1" (seteado por build:static / build:d1 vía cross-env).'
    );
  }

  if (await pathExists(API_STASH_DIR)) {
    throw new Error(
      `Ya existe ${API_STASH_DIR} de una corrida anterior interrumpida. Revisá manualmente si ` +
      "app/api/ debe restaurarse desde ahí antes de reintentar."
    );
  }

  const apiWasMoved = await pathExists(API_DIR);
  if (apiWasMoved) {
    await fs.mkdir(path.dirname(API_STASH_DIR), { recursive: true });
    await fs.rename(API_DIR, API_STASH_DIR);
    console.log(`app/api/ movido temporalmente a ${API_STASH_DIR} (incompatible con output: "export")`);
  }

  // `.next/` puede traer generado (por un `next dev`/`next build` local
  // previo) un validator de typed-routes que todavía importa los route.ts
  // de app/api/ que acabamos de mover - un build limpio evita ese desfase.
  if (await pathExists(NEXT_CACHE_DIR)) {
    await fs.rm(NEXT_CACHE_DIR, { recursive: true, force: true });
    console.log(".next/ eliminado para forzar un build limpio (evita typed-routes stale apuntando a app/api/).");
  }

  let buildResult;
  try {
    buildResult = spawnSync("npx", ["next", "build"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env
    });
  } finally {
    if (apiWasMoved) {
      await fs.rename(API_STASH_DIR, API_DIR);
      await fs.rm(path.dirname(API_STASH_DIR), { recursive: true, force: true });
      console.log("app/api/ restaurado - modo local-duckdb intacto.");
    }
  }

  if (buildResult.status !== 0) {
    throw new Error(`next build falló (exit code ${buildResult.status})`);
  }
}

main().catch(error => {
  console.error("ERROR EN build-static.mjs:");
  console.error(error);
  process.exit(1);
});
