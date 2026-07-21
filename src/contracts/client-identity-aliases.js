// ETAPA 6.5.2B1 - Gobernanza de alias de identidad de cliente
// (data/config/contracts/client-identity-aliases.json). Resuelve
// ÚNICAMENTE identidad de cliente -nunca vigencia contractual, sede,
// versión ni cobertura horaria (ver §4 del encargo). Un alias con
// approved=false nunca se consume: buildClientIdentityAliasIndex() lo
// excluye del índice, así que resolveCanonicalClientName() simplemente no
// lo encuentra y el nombre crudo pasa sin cambios -mismo comportamiento que
// si el alias no existiera. No hay fuzzy matching acá: la búsqueda es un
// lookup exacto en el índice tras el mismo plegado (fold) que usa
// fieldbeat-matcher.js para toda comparación de nombre de cliente.
import { readFileSync } from "node:fs";
import { foldName } from "./fieldbeat-matcher.js";

/**
 * @param {string} [path]
 * @returns {Array<object>} entradas crudas del JSON de alias
 */
export function loadClientIdentityAliases(path = "data/config/contracts/client-identity-aliases.json") {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return raw.entries ?? [];
}

/**
 * Construye el índice de resolución: nombre plegado (canónico o alias,
 * SOLO de entradas approved=true) -> nombre canónico real. El propio
 * nombre canónico también se indexa contra sí mismo para que la
 * resolución sea idempotente sin importar qué lado (crudo o ya-canónico)
 * se le pase.
 * @param {Array<object>} entries resultado de loadClientIdentityAliases()
 * @returns {Map<string, string>}
 */
export function buildClientIdentityAliasIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    if (!entry.approved) continue;
    index.set(foldName(entry.canonical_name), entry.canonical_name);
    for (const alias of entry.aliases ?? []) {
      index.set(foldName(alias), entry.canonical_name);
    }
  }
  return index;
}

/**
 * @param {string} rawName
 * @param {Map<string, string>} aliasIndex resultado de buildClientIdentityAliasIndex()
 * @returns {string} nombre canónico si existe una entrada aprobada, el nombre crudo sin cambios en caso contrario
 */
export function resolveCanonicalClientName(rawName, aliasIndex) {
  return aliasIndex?.get(foldName(rawName)) ?? rawName;
}
