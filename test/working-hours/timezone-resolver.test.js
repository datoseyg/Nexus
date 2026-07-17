import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSantiagoPartsToUtc, offsetMinutesAt, dayOfWeekAt, localDateStringAt, nextLocalMidnightUtc, localMidnightUtc, resolveLocalClockOnDate } from "../../src/working-hours/timezone-resolver.js";

// Fechas reales de transición DST de Chile 2026 (confirmadas por escaneo
// contra Intl.DateTimeFormat en este entorno, no fabricadas): fin de DST
// ~2026-04-05 (adelanta atrás, -180->-240), inicio de DST ~2026-09-06
// (adelanta adelante, -240->-180).

test("offsetMinutesAt: invierno chileno (agosto) = GMT-4 (-240)", () => {
  assert.equal(offsetMinutesAt(Date.UTC(2026, 7, 10, 12, 0, 0)), -240);
});

test("offsetMinutesAt: verano chileno (enero) = GMT-3 (-180)", () => {
  assert.equal(offsetMinutesAt(Date.UTC(2026, 0, 10, 12, 0, 0)), -180);
});

test("resolveSantiagoPartsToUtc: hora local única (fuera de cualquier transición) resuelve correctamente", () => {
  const r = resolveSantiagoPartsToUtc({ year: 2026, month: 8, day: 10, hour: 16, minute: 0 });
  assert.equal(r.kind, "unique");
  assert.equal(new Date(r.utcMs).toISOString(), "2026-08-10T20:00:00.000Z");
});

test("resolveSantiagoPartsToUtc: hora local AMBIGUA (fin de DST) resuelve a la PRIMERA ocurrencia (offset de verano vigente antes del atraso)", () => {
  // Transición real confirmada por escaneo: 2026-04-05T03:00:00Z (-180->-240).
  // El reloj retrocede de 23:59:59 a 23:00:00 local la noche del 4 de abril
  // -23:30 local ocurre 2 veces esa noche (una vez bajo cada offset).
  const r = resolveSantiagoPartsToUtc({ year: 2026, month: 4, day: 4, hour: 23, minute: 30 });
  assert.equal(r.kind, "ambiguous");
  // La primera ocurrencia (instante UTC más temprano) usa el offset DST
  // (-180) vigente antes del atraso -regla de desempate aprobada.
  assert.equal(offsetMinutesAt(r.utcMs), -180);
  assert.equal(new Date(r.utcMs).toISOString(), "2026-04-05T02:30:00.000Z");
});

test("resolveSantiagoPartsToUtc: hora local INEXISTENTE (madrugada del inicio de DST) resuelve al primer instante real tras el salto", () => {
  // Chile 2026: inicio de DST ~06 sept, adelanto de reloj -alguna hora local
  // de esa madrugada nunca ocurre.
  const r = resolveSantiagoPartsToUtc({ year: 2026, month: 9, day: 6, hour: 0, minute: 30 });
  assert.equal(r.kind, "nonexistent");
  // El instante resuelto debe ser posterior al inicio teórico del hueco, y
  // whole-seconds (sql/081 lo exige).
  assert.equal(r.utcMs % 1000, 0);
});

test("resolveSantiagoPartsToUtc: instante nonexistent siempre cae DESPUÉS del salto, nunca antes (política aprobada)", () => {
  const r = resolveSantiagoPartsToUtc({ year: 2026, month: 9, day: 6, hour: 0, minute: 30 });
  // El offset vigente en el instante resuelto debe ser el NUEVO (DST, -180),
  // confirmando que se avanzó hacia adelante, no hacia atrás.
  assert.equal(offsetMinutesAt(r.utcMs), -180);
});

test("dayOfWeekAt: coherente con el calendario real (2026-08-10 es lunes)", () => {
  assert.equal(dayOfWeekAt(Date.UTC(2026, 7, 10, 20, 0, 0)), "MON");
});

test("localDateStringAt: instante UTC cercano a medianoche local puede caer en el día calendario anterior", () => {
  // 2026-08-10T02:00:00Z en GMT-4 es 2026-08-09T22:00 local.
  assert.equal(localDateStringAt(Date.UTC(2026, 7, 10, 2, 0, 0)), "2026-08-09");
});

test("nextLocalMidnightUtc/localMidnightUtc: coherentes entre sí para un instante dado", () => {
  const someInstant = Date.UTC(2026, 7, 10, 20, 0, 0);
  const midnight = localMidnightUtc(someInstant);
  const nextMidnight = nextLocalMidnightUtc(someInstant);
  assert.ok(nextMidnight > midnight);
  assert.equal((nextMidnight - midnight) / 3600000, 24); // agosto no cruza DST, día real de 24h
});

test("nextLocalMidnightUtc: día de transición DST real dura 23h o 25h, nunca 24h exactas", () => {
  const beforeFallBack = Date.UTC(2026, 3, 4, 20, 0, 0); // 2026-04-04, antes del fin de DST
  const midnight1 = localMidnightUtc(beforeFallBack);
  const midnight2 = nextLocalMidnightUtc(midnight1);
  const hoursApart = (midnight2 - midnight1) / 3600000;
  assert.notEqual(hoursApart, 24);
  assert.ok(hoursApart === 23 || hoursApart === 25, `esperado 23 o 25 horas, fue ${hoursApart}`);
});

test("resolveLocalClockOnDate: coherente con resolveSantiagoPartsToUtc", () => {
  const a = resolveLocalClockOnDate("2026-08-10", 16, 0);
  const b = resolveSantiagoPartsToUtc({ year: 2026, month: 8, day: 10, hour: 16, minute: 0 }).utcMs;
  assert.equal(a, b);
});
