import fs from "node:fs/promises";

export const SANTIAGO_TZ = "America/Santiago";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const BUSINESS_HOURS_FILE = "data/config/business-hours.json";
const HOLIDAYS_FILE = "data/config/holidays.json";
const HOLIDAYS_EXAMPLE_FILE = "data/config/holidays.example.json";

// Convierte un instante UTC a sus partes de calendario en America/Santiago,
// usando el Intl/ICU que trae Node (sin dependencia nueva). Validado
// empiricamente contra fieldbeat_report_fields: el start_time UTC del task
// 943 (2021-01-29T11:30:00.000Z) convierte a 08:30 local, que calza exacto
// con "HORA DE INICIO DEL TRABAJO" = "29/01/2021 08:30" que el tecnico
// escribio a mano para ese mismo task.
export function toSantiagoParts(dateOrIso) {
  const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(date.getTime())) return null;

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SANTIAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === "24" ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

// Representa un instante de hora local como si fuera UTC (truco estandar
// "fake-UTC local"): toda la aritmetica posterior (diffs, limites de dia,
// dia de la semana) es resta de milisegundos simple, sin volver a tocar
// DST/timezone. start_time (UTC real) y los campos de report_fields (ya
// locales, sin marcador) terminan en el mismo espacio de milisegundos
// comparable.
export function partsToFakeUtcMs(parts) {
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
}

export function utcIsoToLocalFakeMs(isoOrDate) {
  const parts = toSantiagoParts(isoOrDate);
  return partsToFakeUtcMs(parts);
}

// "HORA DE INICIO/TERMINO DEL TRABAJO" en fieldbeat_report_fields vienen
// como "DD/MM/YYYY HH:mm" (orden chileno), sin marcador de timezone -
// el tecnico ya escribe hora local, asi que se parsean directo a la misma
// representacion fake-UTC local, sin pasar por Intl.
const CHILE_WALL_CLOCK_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;

export function parseChileWallClock(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(CHILE_WALL_CLOCK_RE);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  return Date.UTC(year, month - 1, day, hour, minute, 0);
}

export function formatLocalFakeMs(fakeMs) {
  if (fakeMs === null || fakeMs === undefined || Number.isNaN(fakeMs)) return "";
  return new Date(fakeMs).toISOString().replace("T", " ").replace(".000Z", "");
}

function dateKeyOfDayStart(dayStartMs) {
  return new Date(dayStartMs).toISOString().slice(0, 10);
}

function weekdayNameOfDayStart(dayStartMs) {
  return WEEKDAY_NAMES[new Date(dayStartMs).getUTCDay()];
}

function parseHHMM(value) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Particiona un intervalo [startMs, endMs) (fake-UTC local) en 4 buckets
// mutuamente excluyentes que suman exacto el total del intervalo:
// business / after_hours_weekday (fuera de ventana pero dia habil) /
// weekend (o cualquier dia marcado is_business_day=false) / holiday.
// Prioridad: feriado > no habil > split contra la ventana horaria.
// Camina dia por dia para soportar tareas que cruzan medianoche o varios
// dias. Ver docs/CALCULATION_CONFIDENCE_MODEL.md.
export function classifyInterval(startMs, endMs, businessHoursCfg, holidaysCfg) {
  const totals = {
    business_minutes: 0,
    after_hours_weekday_minutes: 0,
    weekend_minutes: 0,
    holiday_minutes: 0
  };

  if (!(typeof startMs === "number") || !(typeof endMs === "number") || !(endMs > startMs)) {
    return totals;
  }

  const holidaySet = holidaysCfg?.dates instanceof Set ? holidaysCfg.dates : new Set(holidaysCfg?.dates || []);
  const schedule = businessHoursCfg?.weekly_schedule || {};

  let cursor = startMs;

  while (cursor < endMs) {
    const dayStart = Math.floor(cursor / DAY_MS) * DAY_MS;
    const segmentEnd = Math.min(endMs, dayStart + DAY_MS);
    const segmentMinutes = (segmentEnd - cursor) / 60000;
    const dateKey = dateKeyOfDayStart(dayStart);

    if (holidaySet.has(dateKey)) {
      totals.holiday_minutes += segmentMinutes;
    } else {
      const daySchedule = schedule[weekdayNameOfDayStart(dayStart)];

      if (!daySchedule || daySchedule.is_business_day === false) {
        totals.weekend_minutes += segmentMinutes;
      } else {
        const winStartMin = parseHHMM(daySchedule.start);
        const winEndMin = parseHHMM(daySchedule.end);

        if (winStartMin === null || winEndMin === null) {
          totals.weekend_minutes += segmentMinutes;
        } else {
          const windowStart = dayStart + winStartMin * 60000;
          const windowEnd = dayStart + winEndMin * 60000;
          const overlapMinutes = Math.max(0, (Math.min(segmentEnd, windowEnd) - Math.max(cursor, windowStart)) / 60000);

          totals.business_minutes += overlapMinutes;
          totals.after_hours_weekday_minutes += segmentMinutes - overlapMinutes;
        }
      }
    }

    cursor = segmentEnd;
  }

  return totals;
}

async function readJsonSoft(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadBusinessHoursConfig() {
  const parsed = await readJsonSoft(BUSINESS_HOURS_FILE);
  if (!parsed) return { status: "MISSING", weekly_schedule: {} };
  return parsed;
}

// A diferencia de todo otro *.example.* del repo (inerte hasta que se copia
// a su nombre real - ver data/config/part_identity_aliases.example.csv),
// acá el .example.json SI se usa activamente cuando no existe el archivo
// real: si no, el "+3 si existe archivo example o incompleto" del modelo
// de confiabilidad nunca se cumpliría. Excepción deliberada, documentada
// en docs/CALCULATION_CONFIDENCE_MODEL.md.
export async function loadHolidaysConfig() {
  const real = await readJsonSoft(HOLIDAYS_FILE);
  if (real) {
    return { status: real.status || "VALIDATED", dates: new Set(real.dates || []) };
  }

  const example = await readJsonSoft(HOLIDAYS_EXAMPLE_FILE);
  if (example) {
    return { status: example.status || "EXAMPLE_INCOMPLETE", dates: new Set(example.dates || []) };
  }

  return { status: "MISSING", dates: new Set() };
}
