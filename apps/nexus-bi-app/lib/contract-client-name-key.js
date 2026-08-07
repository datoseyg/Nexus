// Único helper de folding para identidad de cliente contractual (Bloque 2
// NEXUS V3). Vive acá, DENTRO de apps/nexus-bi-app, y no en src/contracts/
// (donde vive el resto del dominio contractual) por una restricción real de
// bundling descubierta durante la implementación: next.config.ts pinea
// turbopack.root a esta app a propósito (comentario ahí: evita que Turbopack
// infiera el workspace subiendo hasta eyg-nexus-local/) - un archivo FUERA
// de ese root nunca puede incluirse en un bundle de CLIENTE ("the chunking
// context does not support external modules", confirmado con `next build`
// real, ni siquiera vía turbopack.resolveAlias). Node (los scripts del
// pipeline en src/contracts/) no tiene esa restricción -puede importar este
// archivo con una ruta relativa normal- así que la ÚNICA implementación
// física vive acá y el pipeline la alcanza desde afuera, nunca al revés.
// Antes vivía duplicado en normalize-client.js#foldForComparison y
// fieldbeat-matcher.js#foldName (mismo cuerpo exacto) - ambos importan esta
// función. client_name_key (config.contract_equipment_versions) se persiste
// con este resultado.
const DIACRITICS_PATTERN = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

export function buildContractClientNameKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(DIACRITICS_PATTERN, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
