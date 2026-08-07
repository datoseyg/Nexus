#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isHttpServiceAvailable,
  resolvePredevApiUrl
} from "./lib/local-dev-runtime.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(repoRoot, "apps", "nexus-bi-app", ".env.local");
const apiUrl = resolvePredevApiUrl(
  process.env,
  existsSync(envFile) ? readFileSync(envFile, "utf8") : ""
);

if (!(await isHttpServiceAvailable(apiUrl))) {
  console.error([
    `El backend local de Nexus no está disponible en ${apiUrl}.`,
    "",
    "Ejecuta desde la raíz:",
    "npm run dev:local"
  ].join("\n"));
  process.exit(1);
}

console.log(`[predev] Backend local disponible en ${apiUrl}.`);
