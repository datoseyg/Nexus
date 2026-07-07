// Sanitización + tipado SQLite para el export a Cloudflare D1 (Fase 2
// Cloud, ver docs/CLOUDFLARE_D1_MIGRATION.md). Reusa la misma redacción de
// email/teléfono/token que el snapshot estático de Fase 1
// (sanitize-cloud-export.js) - una sola fuente de verdad para esos regex -
// y agrega acá lo específico de "convertir un valor DuckDB a un literal SQL
// de INSERT válido para SQLite".
import { sanitizeString, containsSuspiciousPii } from "./sanitize-cloud-export.js";

export { containsSuspiciousPii };

// RUT chileno (o cualquier identificador similar): conserva solo los
// últimos 2 caracteres alfanuméricos (dígito de verificación + el dígito
// anterior), reemplaza el resto por "*" preservando separadores
// (puntos/guión) tal cual - decisión explícita del negocio (ver
// docs/CLOUDFLARE_D1_MIGRATION.md § client_rut), NUNCA se exporta el RUT
// completo a una capa cloud.
export function maskClientRut(value) {
  if (value === null || value === undefined) return value;
  const text = String(value).trim();
  if (text === "") return text;

  const alnumPositions = [];
  for (let i = 0; i < text.length; i += 1) {
    if (/[A-Za-z0-9]/.test(text[i])) alnumPositions.push(i);
  }

  const keepFrom = alnumPositions.length > 2 ? alnumPositions[alnumPositions.length - 2] : -1;

  return text
    .split("")
    .map((char, i) => (/[A-Za-z0-9]/.test(char) && i < keepFrom ? "*" : char))
    .join("");
}

// client_key en marts.fieldbeat_report_dolibarr_operational_view y
// marts.fieldbeat_working_hours_analysis viene en formato compuesto
// "FIELD_BEAT_CLIENT|<rut>|<nombre_cliente>" (100% de las filas, verificado
// contra el warehouse) - el RUT queda embebido SIN el formato con puntos de
// la columna client_rut. Enmascara únicamente el segmento del medio,
// preservando el resto de la clave (necesaria para JOIN/GROUP BY).
export function maskClientKey(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  const parts = text.split("|");
  if (parts.length !== 3) return text; // formato inesperado - no hay un segmento de RUT identificable con certeza
  return `${parts[0]}|${maskClientRut(parts[1])}|${parts[2]}`;
}

// DuckDB devuelve BIGINT como bigint nativo. SQLite/D1 soporta enteros de
// 64 bits, pero JSON/JS pierde precisión pasado Number.MAX_SAFE_INTEGER -
// en ese caso (no debería pasar con los conteos de este warehouse, pero la
// tarea lo pide explícito) se exporta como TEXT en vez de trozarlo.
export function normalizeBigInt(value) {
  if (typeof value !== "bigint") return value;
  const abs = value < 0n ? -value : value;
  return abs > BigInt(Number.MAX_SAFE_INTEGER) ? value.toString() : Number(value);
}

export function toSqliteBoolean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value === 0n ? 0 : 1;
  if (typeof value === "number") return value === 0 ? 0 : 1;
  if (typeof value === "string") return ["true", "t", "1", "yes"].includes(value.toLowerCase()) ? 1 : 0;
  return null;
}

// Fechas/timestamps de DuckDB llegan como instancias propias
// (constructor !== Object/Date con su propio toString "YYYY-MM-DD
// HH:MM:SS[-TZ]") o como Date nativo - se normalizan a texto ISO-like
// simple (TEXT en SQLite, sin tipo DATE nativo).
export function toSqliteDateText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return String(value);
  return String(value);
}

// Convierte un valor ya "tipado" (número, texto, null) en el literal SQL
// que va dentro del INSERT. Las comillas simples se escapan duplicándolas
// (estándar SQL) - nunca se interpola texto de usuario sin pasar por acá.
export function toSqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}

// Punto de entrada único usado por export-d1-seed.js: dado un valor crudo
// de DuckDB + metadata de la columna destino, devuelve el literal SQL final
// listo para el INSERT (ya sanitizado y tipado).
export function sanitizeD1Value(rawValue, { columnName, sqlType }) {
  if (rawValue === null || rawValue === undefined) return "NULL";

  if (columnName === "client_rut") {
    return toSqlLiteral(maskClientRut(String(rawValue)));
  }
  if (columnName === "client_key") {
    return toSqlLiteral(maskClientKey(String(rawValue)));
  }

  if (sqlType === "INTEGER" && typeof rawValue !== "boolean") {
    return toSqlLiteral(normalizeBigInt(rawValue));
  }
  if (sqlType === "INTEGER") {
    return toSqlLiteral(toSqliteBoolean(rawValue));
  }
  if (sqlType === "REAL") {
    const n = typeof rawValue === "bigint" ? Number(rawValue) : Number(rawValue);
    return Number.isFinite(n) ? toSqlLiteral(n) : "NULL";
  }

  // TEXT (default): fechas DuckDB, o texto libre que pasa por la misma
  // redacción de email/teléfono/token + truncado que la Fase 1 estática.
  if (typeof rawValue === "object" && !(rawValue instanceof Date)) {
    return toSqlLiteral(sanitizeString(toSqliteDateText(rawValue)));
  }
  if (rawValue instanceof Date) {
    return toSqlLiteral(toSqliteDateText(rawValue));
  }

  return toSqlLiteral(sanitizeString(String(rawValue)));
}
