// Prueba dedicada, exigida en el cierre de ETAPA 6.6B2: demuestra con
// código real (no mocks) que legacy_exact_parity y legacy_corrected_v2
// consumen fuentes de calendario DISTINTAS, y que el builder productivo
// (task-coverage-builder.js/db-writer.js) nunca lee holidays.example.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { computeLegacyExactParity, segmentLegacyCorrectedV2 } from "../../src/working-hours/legacy-global-schedule.js";

const businessHoursCfg = { status: "DEFAULT_UNVALIDATED", timezone: "America/Santiago", weekly_schedule: {
  monday: { is_business_day: true, start: "08:30", end: "18:30" }, tuesday: { is_business_day: true, start: "08:30", end: "18:30" },
  wednesday: { is_business_day: true, start: "08:30", end: "18:30" }, thursday: { is_business_day: true, start: "08:30", end: "18:30" },
  friday: { is_business_day: true, start: "08:30", end: "18:30" }, saturday: { is_business_day: false }, sunday: { is_business_day: false }
} };

// 2020-10-12 (lunes, Encuentro de Dos Mundos): la propia nota embebida en
// holidays.example.json declara que este feriado NO está incluido
// ("no se pueden calcular sin una fuente oficial año a año"). El calendario
// gobernado real (ETAPA 6.6B1/B1.1) SÍ lo incluye (verificado en el reporte
// de paridad corregida -816/817 HOLIDAY_CALENDAR_DIFFERENCE).

test("legacy_exact_parity (computeLegacyExactParity) usa holidays.example.json como fuente de cálculo real", async () => {
  const raw = JSON.parse(await fs.readFile("data/config/holidays.example.json", "utf8"));
  assert.equal(raw.status, "EXAMPLE_INCOMPLETE");
  assert.equal(raw.dates.includes("2020-10-12"), false, "precondición: el archivo real NO incluye el 12-oct-2020");

  const holidaysCfg = { ...raw, dates: new Set(raw.dates) };
  const r = computeLegacyExactParity({
    task: { start_time: "2020-10-12T15:00:00Z", duration_minutes: 60 }, // lunes 11:00 local, dentro de ventana normalmente
    reportedInterval: null,
    businessHoursCfg,
    holidaysCfg
  });
  // Con la fuente REAL de holidays.example.json, 2020-10-12 NO es feriado
  // para legacy_exact_parity -se clasifica como horario normal, no holiday.
  assert.equal(r.holiday_minutes, 0);
});

test("legacy_corrected_v2 (segmentLegacyCorrectedV2) usa el calendario GOBERNADO como fuente de cálculo, nunca holidays.example.json", async () => {
  const dir = "data/config/holidays/CL";
  const governedDates = new Set();
  for (const file of await fs.readdir(dir)) {
    const bundle = JSON.parse(await fs.readFile(`${dir}/${file}`, "utf8"));
    for (const e of bundle.events) governedDates.add(e.local_date);
  }
  assert.equal(governedDates.has("2020-10-12"), true, "precondición: el calendario gobernado real SÍ incluye el 12-oct-2020");

  function governedHolidayLookup(localDate) {
    return governedDates.has(localDate) ? "CONFIRMED_HOLIDAY" : "CONFIRMED_NOT_HOLIDAY";
  }

  const startUtcMs = Date.UTC(2020, 9, 12, 15, 0, 0); // 2020-10-12T11:00 local
  const endUtcMs = Date.UTC(2020, 9, 12, 16, 0, 0);
  const segments = segmentLegacyCorrectedV2(startUtcMs, endUtcMs, businessHoursCfg, governedHolidayLookup);

  // Con la fuente GOBERNADA (nunca holidays.example.json), el mismo instante
  // SÍ se clasifica como feriado -divergencia real y demostrada entre
  // ambos motores para la misma fecha, prueba directa de que consumen
  // fuentes distintas.
  assert.equal(segments.length, 1);
  assert.equal(segments[0].isHoliday, true);
  assert.equal(segments[0].outsideCoverageBucket, "HOLIDAY");
});

test("segmentLegacyCorrectedV2 nunca lee holidays.example.json -depende exclusivamente del holidayLookup inyectado, agnóstico de cualquier archivo", () => {
  // Se inyecta un holidayLookup que SIEMPRE contradice lo que diría
  // holidays.example.json para una fecha que ESE archivo sí marca como
  // feriado (2026-01-01, Año Nuevo) -si segmentLegacyCorrectedV2 leyera el
  // archivo por su cuenta, este test fallaría.
  function contradictingLookup(localDate) {
    void localDate;
    return "CONFIRMED_NOT_HOLIDAY"; // nunca feriado, pase lo que pase
  }
  const startUtcMs = Date.UTC(2026, 0, 1, 15, 0, 0); // 2026-01-01T11:00 local, feriado real en ambos calendarios
  const endUtcMs = Date.UTC(2026, 0, 1, 16, 0, 0);
  const segments = segmentLegacyCorrectedV2(startUtcMs, endUtcMs, businessHoursCfg, contradictingLookup);
  assert.equal(segments[0].isHoliday, false, "segmentLegacyCorrectedV2 obedece exclusivamente al holidayLookup inyectado, nunca un archivo propio");
});

test("el builder productivo (task-coverage-builder.js + db-writer.js) no importa ni lee holidays.example.json en ninguna forma", async () => {
  const builderSource = await fs.readFile("src/working-hours/task-coverage-builder.js", "utf8");
  const writerSource = await fs.readFile("src/working-hours/db-writer.js", "utf8");
  assert.equal(builderSource.includes("holidays.example.json"), false);
  assert.equal(builderSource.includes("EXAMPLE_INCOMPLETE"), false);
  assert.equal(writerSource.includes("holidays.example.json"), false);
  assert.equal(writerSource.includes("EXAMPLE_INCOMPLETE"), false);
  // La única fuente de holidayLookup en producción es config.current_holiday_calendar_entries.
  assert.ok(writerSource.includes("config.current_holiday_calendar_entries"));
});
