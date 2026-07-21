import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionInterval, computeBoundaries, isWithinWindow } from "../../src/working-hours/segment-boundaries.js";

const FIXED_WINDOW_MON_FRI_08_17 = ["MON", "TUE", "WED", "THU", "FRI"].map(dayOfWeek => ({ dayOfWeek, startMinute: 8 * 60, endMinute: 17 * 60, allDay: false }));

// Ejemplo trabajado ya documentado en etapas previas: Linac 2026-08-10
// 16:00 -> 2026-08-11 10:00 (hora local, ventana Lun-Vie 08:00-17:00) debe
// producir EXACTAMENTE 4 segmentos: 60min (16:00-17:00 cubierto),
// 420min/7h (17:00-2026-08-11T00:00 fuera), 480min/8h (00:00-08:00 fuera),
// 120min/2h (08:00-10:00 cubierto).
test("partitionInterval: ejemplo trabajado Linac produce exactamente 4 segmentos con la duración esperada", () => {
  const startUtcMs = Date.UTC(2026, 7, 10, 20, 0, 0); // 2026-08-10T16:00 local (GMT-4, agosto)
  const endUtcMs = Date.UTC(2026, 7, 11, 14, 0, 0); // 2026-08-11T10:00 local
  const segments = partitionInterval(startUtcMs, endUtcMs, FIXED_WINDOW_MON_FRI_08_17);

  assert.equal(segments.length, 4);
  const minutes = segments.map(s => (s.endUtcMs - s.startUtcMs) / 60000);
  assert.deepEqual(minutes, [60, 420, 480, 120]);
  assert.deepEqual(segments.map(s => s.withinWindow), [true, false, false, true]);

  const totalMinutes = minutes.reduce((a, b) => a + b, 0);
  assert.equal(totalMinutes, (endUtcMs - startUtcMs) / 60000, "la suma de segmentos debe ser EXACTA a la duración total, sin pérdida ni doble conteo");
});

test("partitionInterval: intervalo enteramente dentro de una ventana -> 1 solo segmento COVERED", () => {
  const startUtcMs = Date.UTC(2026, 7, 10, 13, 0, 0); // 09:00 local lunes
  const endUtcMs = Date.UTC(2026, 7, 10, 15, 0, 0); // 11:00 local lunes
  const segments = partitionInterval(startUtcMs, endUtcMs, FIXED_WINDOW_MON_FRI_08_17);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].withinWindow, true);
});

test("partitionInterval: fin de semana completo -> 1 segmento fuera de ventana (sin horario ese día)", () => {
  const startUtcMs = Date.UTC(2026, 7, 15, 14, 0, 0); // sábado 10:00 local
  const endUtcMs = Date.UTC(2026, 7, 15, 18, 0, 0); // sábado 14:00 local
  const segments = partitionInterval(startUtcMs, endUtcMs, FIXED_WINDOW_MON_FRI_08_17);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].withinWindow, false);
  assert.equal(segments[0].dayOfWeek, "SAT");
});

test("partitionInterval: cruce de medianoche local sin cambio de ventana produce partición por fecha", () => {
  const startUtcMs = Date.UTC(2026, 7, 10, 2, 0, 0); // 2026-08-09T22:00 local (fuera de ventana, martes... en realidad lunes tarde)
  const endUtcMs = Date.UTC(2026, 7, 10, 6, 0, 0); // 2026-08-10T02:00 local
  const segments = partitionInterval(startUtcMs, endUtcMs, FIXED_WINDOW_MON_FRI_08_17);
  assert.ok(segments.length >= 2, "debe partir al menos en la medianoche local");
  const localDates = new Set(segments.map(s => s.localDate));
  assert.equal(localDates.size, 2);
});

test("partitionInterval: día de transición DST (23h/25h real) se particiona en el instante exacto de la transición, no a las 24h fijas", () => {
  // Transición real confirmada: 2026-04-05T03:00:00Z, offset -180->-240.
  const startUtcMs = Date.UTC(2026, 3, 4, 12, 0, 0); // 2026-04-04T09:00 local
  const endUtcMs = Date.UTC(2026, 3, 5, 12, 0, 0); // 2026-04-05T08:00 local (tras el salto)
  const segments = partitionInterval(startUtcMs, endUtcMs, FIXED_WINDOW_MON_FRI_08_17);
  const totalSeconds = segments.reduce((acc, s) => acc + (s.endUtcMs - s.startUtcMs) / 1000, 0);
  assert.equal(totalSeconds, (endUtcMs - startUtcMs) / 1000, "suma exacta de segmentos incluso cruzando DST");
  // Debe existir un límite exactamente en el instante de transición.
  const boundaries = computeBoundaries(startUtcMs, endUtcMs, FIXED_WINDOW_MON_FRI_08_17);
  assert.ok(boundaries.includes(Date.UTC(2026, 3, 5, 3, 0, 0)), "debe incluir el instante exacto de transición DST como límite");
});

test("computeBoundaries: todos los límites devueltos son whole-seconds (sql/081 lo exige)", () => {
  const startUtcMs = Date.UTC(2026, 3, 4, 12, 0, 0);
  const endUtcMs = Date.UTC(2026, 3, 6, 12, 0, 0);
  const boundaries = computeBoundaries(startUtcMs, endUtcMs, FIXED_WINDOW_MON_FRI_08_17);
  for (const b of boundaries) assert.equal(b % 1000, 0, `límite ${new Date(b).toISOString()} no es whole-second`);
});

test("isWithinWindow: allDay=true cubre cualquier hora de ese día", () => {
  const windows = [{ dayOfWeek: "MON", startMinute: null, endMinute: null, allDay: true }];
  const segStart = Date.UTC(2026, 7, 11, 3, 0, 0); // 2026-08-10T23:00 local (lunes, madrugada)
  const segEnd = Date.UTC(2026, 7, 11, 4, 0, 0);
  assert.equal(isWithinWindow(segStart, segEnd, windows), true);
});

test("isWithinWindow: sin horario definido para ese día -> false", () => {
  assert.equal(isWithinWindow(Date.UTC(2026, 7, 15, 14, 0, 0), Date.UTC(2026, 7, 15, 15, 0, 0), FIXED_WINDOW_MON_FRI_08_17), false);
});

test("partitionInterval: límite de vigencia contractual dentro del intervalo produce una partición adicional", () => {
  const startUtcMs = Date.UTC(2026, 7, 10, 13, 0, 0); // 09:00 local
  const endUtcMs = Date.UTC(2026, 7, 10, 17, 0, 0); // 13:00 local
  const validToUtcMs = Date.UTC(2026, 7, 10, 15, 0, 0); // 11:00 local, vigencia termina a mitad del intervalo
  const segments = partitionInterval(startUtcMs, endUtcMs, FIXED_WINDOW_MON_FRI_08_17, { validToUtcMs });
  assert.ok(segments.some(s => s.endUtcMs === validToUtcMs || s.startUtcMs === validToUtcMs));
});
