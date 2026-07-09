// Utilidades puras para el esquema de "runKey" que usa TODA la escalera
// del medallon en R2 (RAW -> PROCESSED -> MARTS -> GOLD): cada build
// escribe bajo un prefijo `<capa>/<runKey>/...` inmutable, nunca sobre el
// mismo archivo - así RAW/PROCESSED/MARTS/GOLD comparten la misma
// propiedad de auditabilidad (se puede reconstruir exactamente que
// snapshot de una capa produjo cual snapshot de la siguiente).
//
// Compartido entre src/use-cases/build-marts.ts (descubre el PROCESSED
// mas reciente de cada dominio, y genera su propio runKey de MARTS al
// escribir) y src/use-cases/build-gold.ts (descubre el MARTS mas
// reciente, y genera su propio runKey de GOLD) - misma logica en los dos
// sentidos (generar y descubrir), una sola vez.
//
// Sin I/O: recibe/devuelve strings, nunca toca R2 directamente.

// Mismo formato que `scheduledAt.toISOString().replace(/[:.]/g, "-")` en
// cada *-miner.ts (ver src/workers/*-miner.ts): ISO8601 con ":"/"."
// reemplazados por "-". Se preserva el mismo formato en TODAS las capas a
// propósito - es lo que permite comparar runKey de capas distintas como
// strings ordenables sin tener que parsear fechas.
export function makeRunKey(at: Date = new Date()): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

// El runKey mas reciente bajo un prefijo, a partir de una lista de keys ya
// obtenida via StorageAdapter.list(prefix). Los runKey son ISO8601 (mismo
// largo, mismos componentes en el mismo orden) - comparacion de strings ES
// comparacion cronologica, así que una sola pasada lineal (maximo
// corriente) alcanza; no hace falta juntar+ordenar todas las keys solo
// para quedarse con una.
export function findLatestRunKey(keys: string[], prefix: string): string | null {
  let latest: string | null = null;

  for (const key of keys) {
    const runKey = key.slice(prefix.length).split("/")[0];
    if (!runKey) continue;
    if (latest === null || runKey > latest) latest = runKey;
  }

  return latest;
}
