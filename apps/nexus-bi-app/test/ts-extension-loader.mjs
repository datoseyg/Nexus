// Loader ESM mínimo, solo para node --test: resuelve imports relativos sin
// extensión (convención estándar de TypeScript/Next.js, ej. "./dashboard-filters")
// probando ".ts" antes de rendirse - Node nativo exige extensión explícita
// y no entiende esta convención por su cuenta. No toca ningún archivo de
// producción; existe solo para que la suite de tests corra con
// node --experimental-strip-types sin reescribir los imports existentes.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// tsconfig.json: "paths": { "@/*": ["./*"] } - alias que solo entiende
// tsc/Next.js, resuelto acá contra la raíz de apps/nexus-bi-app/.
const APP_ROOT = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return resolve("./" + specifier.slice(2), { ...context, parentURL: APP_ROOT.href }, nextResolve);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;

    // Imports relativos sin extensión (convención TypeScript/Next.js, ej.
    // "./dashboard-filters") -Node exige extensión explícita.
    if (specifier.startsWith(".")) {
      const basePath = fileURLToPath(new URL(specifier, context.parentURL));
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(basePath + ext)) return nextResolve(specifier + ext, context);
      }
      throw error;
    }

    // Subpaths de paquetes sin "exports" en su package.json (ej.
    // "next/server" -> node_modules/next/server.js) - Next.js resuelve
    // esto por su cuenta en dev/build; el loader ESM nativo de Node no,
    // fuera del runtime de Next.
    if (!specifier.startsWith("next/")) throw error;
    return nextResolve(`${specifier}.js`, context);
  }
}
