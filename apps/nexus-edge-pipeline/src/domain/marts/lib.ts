// Utilidades puras compartidas entre los tres constructores MARTS
// (used-parts-match.ts, ticket-fieldbeat-view.ts,
// ticket-fieldbeat-dolibarr-view.ts). Sin I/O, sin estado - centralizadas
// aca para no repetir la misma logica de limpieza/agrupacion en cada
// archivo (una sola version que corregir si alguna vez tiene un bug).

export function cleanId(value: unknown): string {
  return String(value ?? "").trim();
}

// Los booleans de las tablas PROCESSED pueden llegar como boolean real
// (cuando un mart alimenta a otro en memoria dentro de la misma corrida de
// build-marts.ts) o como string "true"/"false" (cuando vienen de un CSV
// leido de R2) - String(true) === "true", así que esta unica funcion cubre
// ambos casos sin que el caller necesite saber cual de los dos esta
// recibiendo.
export function isTrue(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function uniqueNonEmpty(values: unknown[]): string[] {
  const seen = new Set<string>();

  for (const value of values) {
    const clean = String(value ?? "").trim();
    if (clean) seen.add(clean);
  }

  return Array.from(seen);
}

// Agrupa filas por una columna clave usando un Map - O(n) de un solo
// recorrido. Reemplaza el patron "por cada fila externa, filtrar el array
// completo de filas internas" (O(externas * internas), el tipo de ciclo
// anidado que el limite de 128MB/CPU de un Worker no perdona) por un unico
// indice construido una vez y consultado en O(1) por clave.
export function groupBy<T extends Record<string, unknown>>(rows: T[], keyName: keyof T): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const row of rows) {
    const key = cleanId(row[keyName]);
    if (!key) continue;

    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }

  return map;
}
