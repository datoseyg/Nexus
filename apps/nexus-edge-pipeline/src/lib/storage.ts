// Adaptador de I/O de Fase 1 (ver target-architecture-cloudflare.html,
// seccion 2) - equivalente edge de src/lib/save-json.js y src/lib/csv.js
// del pipeline local. Misma firma conceptual (saveJson/writeCsv), pero
// contra R2 en vez de node:fs/node:path - ninguno de los dos compila en un
// isolate de Workers.
//
// Diseño (principios SOLID aplicados, no solo nombrados):
//
// - Responsabilidad unica: este archivo separa tres cosas que
//   save-json.js/csv.js mezclaban en un solo lugar - construir el string
//   (serializacion pura, sin I/O), hablar con el binding de storage
//   (R2StorageAdapter) y decidir cómo reportar una falla (StorageWriteError/
//   StorageReadError). Cada una puede cambiar sin tocar las otras.

// - Abierto/cerrado: agregar un backend nuevo (ej. un fake en memoria para
//   tests, o un bucket S3 externo) significa implementar StorageAdapter -
//   saveJson/writeCsv/readJson/readCsv no se tocan.

// - Sustitucion de Liskov: cualquier StorageAdapter debe devolver `null`
//   en `get()` cuando la clave no existe (nunca lanzar), y lanzar
//   Storage*Error cuando la operacion en sí falla - ningún caller de este
//   modulo necesita saber qué implementación concreta está usando.

// - Segregacion de interfaces: StorageAdapter expone put/get/list, no la
//   superficie completa de R2Bucket (head, multipart, condicionales, etc.)
//   que el pipeline no necesita. `list` se sumo recien en la Fase 4 (ver
//   src/use-cases/build-marts.ts) porque el orquestador Fan-In de MARTS es
//   el primer consumidor que necesita descubrir claves por prefijo en vez
//   de leer una clave puntual conocida de antemano - hasta entonces
//   deliberadamente no estaba, para no exponer mas superficie de la que
//   algun caller usaba.

// - Inversion de dependencias: saveJson/writeCsv/readJson/readCsv reciben
//   un StorageAdapter ya construido - nunca importan R2Bucket ni leen
//   `env` directamente. Quien arma el R2StorageAdapter a partir de `env`
//   es el composition root (el handler del Worker, ver src/index.ts), no
//   este modulo.

export interface StorageEnv {
  DATA_LAKE: R2Bucket;
}

export interface StorageAdapter {
  put(key: string, body: string, contentType: string): Promise<void>;
  get(key: string): Promise<string | null>;
  // Devuelve solo las keys bajo `prefix` (sin metadata) - es lo unico que
  // necesita un caller que solo quiere saber "que corridas/paginas
  // existen" antes de leerlas con get()/readCsv().
  list(prefix: string): Promise<string[]>;
}

export class StorageWriteError extends Error {
  constructor(key: string, cause: unknown) {
    super(`No se pudo escribir "${key}" en el storage: ${describeCause(cause)}`);
    this.name = "StorageWriteError";
    this.cause = cause;
  }
}

export class StorageReadError extends Error {
  constructor(key: string, cause: unknown) {
    super(`No se pudo leer "${key}" desde el storage: ${describeCause(cause)}`);
    this.name = "StorageReadError";
    this.cause = cause;
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// Unica implementacion concreta de StorageAdapter en esta fase. No atrapa
// ni reintenta errores de R2 en silencio - los envuelve en un error propio
// y los relanza. Un handler `queue()` futuro (Fase 3 del blueprint) decide
// ahi, por mensaje, si hace `msg.retry()` o deja que expire hacia la Dead
// Letter Queue; a este adaptador no le corresponde saber eso.
export class R2StorageAdapter implements StorageAdapter {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, body: string, contentType: string): Promise<void> {
    try {
      await this.bucket.put(key, body, { httpMetadata: { contentType } });
    } catch (cause) {
      throw new StorageWriteError(key, cause);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      const object = await this.bucket.get(key);
      if (!object) return null;
      return await object.text();
    } catch (cause) {
      throw new StorageReadError(key, cause);
    }
  }

  // R2 pagina list() de a lo sumo 1000 objetos por llamada (truncated +
  // cursor) - se agota la paginacion completa acá adentro para que el
  // caller reciba SIEMPRE el set completo de keys bajo el prefijo, nunca
  // una pagina parcial silenciosa. Solo se retiene `.key` de cada
  // R2Object (no httpMetadata/customMetadata/etc.) porque es lo unico
  // que build-marts.ts necesita.
  async list(prefix: string): Promise<string[]> {
    try {
      const keys: string[] = [];
      let cursor: string | undefined;

      for (;;) {
        const page = await this.bucket.list({ prefix, cursor });
        for (const object of page.objects) keys.push(object.key);
        if (!page.truncated) break;
        cursor = page.cursor;
      }

      return keys;
    } catch (cause) {
      throw new StorageReadError(prefix, cause);
    }
  }
}

// Composition root helper: construye el adaptador a partir del binding de
// `env`. Se llama una sola vez por invocacion del Worker (fetch/queue/
// scheduled) y el resultado se inyecta hacia el resto del pipeline - ver
// src/index.ts.
export function createStorageAdapter(env: StorageEnv): StorageAdapter {
  return new R2StorageAdapter(env.DATA_LAKE);
}

// ---------------------------------------------------------------------
// Serializacion pura (sin I/O) - mismo contrato de escape que
// src/lib/csv.js del pipeline local, para que un CSV escrito por el
// Worker sea indistinguible de uno escrito por el pipeline Node.
// ---------------------------------------------------------------------

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Exportada a proposito: los casos de uso (ver
// src/use-cases/process-zendesk-raw.ts) necesitan el string CSV en si
// (para loguear conteos, o para escribirlo con un content-type explicito)
// antes de decidir dónde guardarlo - no siempre alcanza con el atajo
// writeCsv() de mas abajo, que ya asume la clave de destino.
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(","), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))];
  return lines.join("\n");
}

// Parser CSV propio, sin dependencias externas: `csv-parse` (usado en el
// pipeline Node) esta pensado para ese runtime y no está verificado contra
// el bundler de Workers en este corte - preferible un parser minimo y
// auditable a asumir compatibilidad sin probarla. Cubre el mismo dialecto
// que csvEscape() produce (comillas dobles, escapadas duplicando `""`); si
// una fase futura necesita un CSV más permisivo, se reemplaza esta función
// sola, el resto del modulo no depende de su implementacion.
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function parseCsv(raw: string): Array<Record<string, string>> {
  const lines = raw.split(/\r\n|\n/).filter(line => line.length > 0);
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
  });
}

// ---------------------------------------------------------------------
// API de alto nivel - equivalente edge de saveJson()/writeCsv() de
// src/lib/save-json.js y src/lib/csv.js. Los contrapartes de lectura
// (readJson/readCsv) se agregan acá porque "I/O" es de ida y vuelta: un
// normalizador tiene que poder leer de vuelta lo que la ingesta escribió a
// RAW, igual que el resolver de identidad lee PROCESSED - ver diagrama 01
// de target-architecture-cloudflare.html.
// ---------------------------------------------------------------------

export async function saveJson(storage: StorageAdapter, key: string, data: unknown): Promise<void> {
  await storage.put(key, JSON.stringify(data, null, 2), "application/json");
}

export async function readJson<T = unknown>(storage: StorageAdapter, key: string): Promise<T | null> {
  const raw = await storage.get(key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

export async function writeCsv(storage: StorageAdapter, key: string, rows: Array<Record<string, unknown>>): Promise<void> {
  await storage.put(key, toCsv(rows), "text/csv");
}

export async function readCsv(storage: StorageAdapter, key: string): Promise<Array<Record<string, string>>> {
  const raw = await storage.get(key);
  if (raw === null || raw.trim() === "") return [];
  return parseCsv(raw);
}
