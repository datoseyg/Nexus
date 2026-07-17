// Resolución de tiempo DST-correcta para America/Santiago, sin dependencia
// nueva (usa el ICU/Intl que trae Node). Nunca usa aritmética de
// milisegundos (dayStart + 86_400_000) sobre instantes UTC reales -eso
// asume incorrectamente que todo día local dura 24h, lo cual es falso en
// los días de transición DST (23h o 25h reales en America/Santiago).
//
// Política DST ya aprobada (ETAPA 6.6B0/B1):
//   hora local inexistente (adelanto de reloj) -> primer instante real
//     válido posterior al salto.
//   hora local ambigua (atraso de reloj)       -> primera ocurrencia, con
//     el offset vigente ANTES del atraso (el offset "de verano"/DST).
// Documentado explícitamente acá -nunca delegado en silencio al
// comportamiento por defecto de una librería.

export const SANTIAGO_TZ = "America/Santiago";

const PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: SANTIAGO_TZ,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false
});
const OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", { timeZone: SANTIAGO_TZ, timeZoneName: "shortOffset" });

/** @param {number} utcMs @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number}} */
export function utcMsToSantiagoParts(utcMs) {
  const parts = Object.fromEntries(PARTS_FORMATTER.formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: parts.hour === "24" ? 0 : Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second)
  };
}

/** @param {number} utcMs @returns {number} offset en minutos (ej. -240 para GMT-4, -180 para GMT-3) */
export function offsetMinutesAt(utcMs) {
  const tzPart = OFFSET_FORMATTER.formatToParts(new Date(utcMs)).find(p => p.type === "timeZoneName")?.value ?? "GMT-4";
  const match = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return -240;
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  return hours < 0 ? hours * 60 - minutes : hours * 60 + minutes;
}

function partsEqual(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

/**
 * Encuentra el instante UTC exacto (en milisegundos) donde el offset de
 * America/Santiago cambia, dentro de [loUtcMs, hiUtcMs) -búsqueda binaria,
 * asume como mucho 1 transición en el rango (válido para rangos de pocos
 * días, que es como se usa acá).
 */
function findTransitionInstant(loUtcMs, hiUtcMs) {
  let lo = loUtcMs, hi = hiUtcMs;
  const offsetLo = offsetMinutesAt(lo);
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offsetMinutesAt(mid) === offsetLo) lo = mid; else hi = mid;
  }
  // Redondeo hacia arriba al segundo entero -Capa B/C exigen whole-seconds
  // (sql/081, date_trunc('second', x) = x); la búsqueda binaria converge al
  // milisegundo exacto, pero el "primer instante real tras el salto" puede
  // caer en un ms no-cero. Redondear hacia arriba preserva la política
  // aprobada (sigue siendo un instante posterior al salto, nunca anterior).
  return Math.ceil(hi / 1000) * 1000;
}

/**
 * Resuelve partes de hora local (America/Santiago) al instante UTC real
 * correcto, aplicando la política DST aprobada para horas inexistentes/
 * ambiguas. Chile solo usa 2 offsets reales (-240 GMT-4 estándar, -180
 * GMT-3 DST) -se prueban ambos candidatos explícitamente en vez de iterar
 * a punto fijo, evitando ambigüedad de convergencia.
 * @param {{year:number,month:number,day:number,hour:number,minute:number,second?:number}} target
 * @returns {{ utcMs: number, kind: 'unique'|'ambiguous'|'nonexistent' }}
 */
export function resolveSantiagoPartsToUtc(target) {
  const targetNormalized = { ...target, second: target.second ?? 0 };
  const naiveUtcMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second ?? 0);

  const candidateOffsets = [-240, -180];
  const candidates = candidateOffsets.map(offsetMin => {
    const utcMs = naiveUtcMs - offsetMin * 60000;
    return { utcMs, offsetMin, matches: partsEqual(utcMsToSantiagoParts(utcMs), targetNormalized) };
  });

  const matching = candidates.filter(c => c.matches);

  if (matching.length === 1) {
    return { utcMs: matching[0].utcMs, kind: "unique" };
  }

  if (matching.length === 2) {
    // Ambigua: primera ocurrencia = instante UTC más temprano = el que usa
    // el offset vigente ANTES del atraso (DST, -180).
    const earliest = matching.reduce((a, b) => (a.utcMs < b.utcMs ? a : b));
    return { utcMs: earliest.utcMs, kind: "ambiguous" };
  }

  // Inexistente (ningún candidato hace round-trip): buscar la transición
  // real entre los 2 candidatos y devolver el primer instante válido tras
  // el salto.
  const sorted = [...candidates].sort((a, b) => a.utcMs - b.utcMs);
  const transitionInstant = findTransitionInstant(sorted[0].utcMs - 2 * 3600000, sorted[1].utcMs + 2 * 3600000);
  return { utcMs: transitionInstant, kind: "nonexistent" };
}

/**
 * Día-walk DST-correcto: dado un instante UTC, retorna el instante UTC de
 * la PRÓXIMA medianoche local (America/Santiago) -nunca instant+86_400_000.
 * @param {number} utcMs
 * @returns {number}
 */
export function nextLocalMidnightUtc(utcMs) {
  const parts = utcMsToSantiagoParts(utcMs);
  const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const resolved = resolveSantiagoPartsToUtc({
    year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate(),
    hour: 0, minute: 0, second: 0
  });
  return resolved.utcMs;
}

/**
 * Instante UTC de la medianoche local del MISMO día que utcMs.
 * @param {number} utcMs
 * @returns {number}
 */
export function localMidnightUtc(utcMs) {
  const parts = utcMsToSantiagoParts(utcMs);
  return resolveSantiagoPartsToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 }).utcMs;
}

const DAY_OF_WEEK_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** @param {number} utcMs @returns {string} MON..SUN, del día local */
export function dayOfWeekAt(utcMs) {
  const parts = utcMsToSantiagoParts(utcMs);
  // getUTCDay() sobre un Date construido con las partes locales (sin
  // convertir zona) da el día de la semana correcto porque solo usamos los
  // campos de calendario, no el instante en sí.
  return DAY_OF_WEEK_NAMES[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
}

/** @param {number} utcMs @returns {string} YYYY-MM-DD local */
export function localDateStringAt(utcMs) {
  const parts = utcMsToSantiagoParts(utcMs);
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

/**
 * Resuelve una hora de reloj (HH:mm) en un local_date dado a un instante
 * UTC real, aplicando la política DST.
 * @param {string} localDate YYYY-MM-DD
 * @param {number} hour
 * @param {number} minute
 * @returns {number} utcMs
 */
export function resolveLocalClockOnDate(localDate, hour, minute) {
  const [year, month, day] = localDate.split("-").map(Number);
  return resolveSantiagoPartsToUtc({ year, month, day, hour, minute, second: 0 }).utcMs;
}
