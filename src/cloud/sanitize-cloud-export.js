// Sanitización de defensa-en-profundidad para el snapshot estático de
// Cloudflare Pages (ver docs/CLOUD_SMOKE_TEST.md). export-cloud-snapshot.js
// ya selecciona columnas "seguras" a propósito (nunca lee `description`,
// `client_rut`, etc.), pero este módulo se corre igual sobre CADA valor
// antes de escribir JSON, por si algún campo de texto libre trae un email,
// teléfono o token pegado adentro por error humano en el dato de origen.

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Teléfonos chilenos: +56 9 XXXX XXXX / 9XXXXXXXX (sin separador, pero
// siempre 9 dígitos exactos empezando en "9" - móvil chileno), o cualquier
// secuencia con separadores explícitos entre grupos (espacio/punto/guión).
// A propósito NO matchea una corrida larga de dígitos sin separadores que
// no empiece en "9" (ver nota de TOKEN_REGEX: eso son sumas/conteos
// agregados del propio dataset BI, no teléfonos).
const PHONE_REGEX = /(?:\+?56[\s.-]?)?\b9[\s.-]?\d{4}[\s.-]?\d{4}\b|\b\d{2,3}[\s.-]+\d{3,4}[\s.-]+\d{4}\b/g;

// Tokens/secretos reales: Bearer, "algo_key=..."/"secret: ..." literal,
// AWS access key ID, hash hex de 32+ caracteres, o una cadena opaca de 24+
// caracteres SIN separadores que mezcle mayúsculas + minúsculas + dígitos
// (forma típica de un token/base64 real). A propósito NO usa un catch-all
// "cualquier alfanumérico largo": este snapshot está lleno de nombres de
// campo/enum legítimos en snake_case o camelCase largos (ej.
// "zendesk_backfill_tickets_forbidden", "reportsLinkedMissingOrRestricted")
// que nunca deben redactarse - la condición de "mezcla de casos + dígitos
// sin separador" los excluye (son todo-minúscula o todo-mayúscula con "_").
const TOKEN_REGEX =
  /\bBearer\s+[A-Za-z0-9\-._~+/]{15,}={0,2}\b|\b(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?[A-Za-z0-9+/_\-]{12,}["']?|\bAKIA[0-9A-Z]{16}\b|\b[0-9a-fA-F]{32,}\b|(?=[A-Za-z0-9+/]{24,}(?![A-Za-z0-9+/]))(?=[A-Za-z0-9+/]*[0-9])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{24,}/g;

const DEFAULT_MAX_TEXT_LENGTH = 300;

export function redactEmails(text) {
  return text.replace(EMAIL_REGEX, "[REDACTED_EMAIL]");
}

export function redactPhones(text) {
  return text.replace(PHONE_REGEX, "[REDACTED_PHONE]");
}

export function redactTokens(text) {
  return text.replace(TOKEN_REGEX, "[REDACTED_TOKEN]");
}

export function truncateLongText(text, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}… [truncado por cloud:export-snapshot]`;
}

export function sanitizeString(value, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  const redacted = redactTokens(redactPhones(redactEmails(value)));
  return truncateLongText(redacted, maxLength);
}

// Recorre recursivamente objetos/arrays y aplica sanitizeString a cada hoja
// de tipo string. Números, booleanos, null y undefined pasan sin cambios.
export function sanitizeValue(value, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  if (typeof value === "string") return sanitizeString(value, maxLength);
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, maxLength));
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = sanitizeValue(nested, maxLength);
    }
    return result;
  }
  return value;
}

export function sanitizeRows(rows, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  return rows.map(row => sanitizeValue(row, maxLength));
}

// Detección (no redacción) para src/cloud/preflight-cloud-demo.js - usa
// String.prototype.match en vez de RegExp.test para no arrastrar el
// `lastIndex` de estos regex globales entre llamadas sucesivas.
export function containsSuspiciousPii(text) {
  return Boolean(text.match(EMAIL_REGEX) || text.match(PHONE_REGEX) || text.match(TOKEN_REGEX));
}
