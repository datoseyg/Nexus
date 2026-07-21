import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHoursOrDash, splitDateTime, totalAfterHoursHours } from "../../lib/after-hours-detail-view.ts";

// === splitDateTime ===

test("splitDateTime: separa fecha y hora (HH:mm) de un timestamp con espacio", () => {
  assert.deepEqual(splitDateTime("2026-07-16 08:30:00"), { date: "2026-07-16", time: "08:30" });
});

test("splitDateTime: acepta también el separador 'T'", () => {
  assert.deepEqual(splitDateTime("2026-07-16T08:30:00"), { date: "2026-07-16", time: "08:30" });
});

test("splitDateTime: null -> '-'/'-' , nunca lanza", () => {
  assert.deepEqual(splitDateTime(null), { date: "-", time: "-" });
});

// === totalAfterHoursHours: NONE nunca es "0" (§11) ===

test("totalAfterHoursHours: business_hours=null (NONE, no calculable) -> null, NUNCA 0", () => {
  const result = totalAfterHoursHours({ business_hours: null, after_hours: null, weekend_hours: null, holiday_hours: null });
  assert.equal(result, null);
});

test("totalAfterHoursHours: suma weekday+weekend+holiday cuando la tarea es calculable", () => {
  const result = totalAfterHoursHours({ business_hours: 4, after_hours: 1.5, weekend_hours: 0.5, holiday_hours: 0 });
  assert.equal(result, 2);
});

test("totalAfterHoursHours: business_hours=0 (calculable, 0 horas cubiertas) SÍ es un total real, distinto de NONE", () => {
  const result = totalAfterHoursHours({ business_hours: 0, after_hours: 3, weekend_hours: 0, holiday_hours: 0 });
  assert.equal(result, 3);
});

test("totalAfterHoursHours: campos individuales null dentro de una tarea calculable se tratan como 0 en la suma", () => {
  const result = totalAfterHoursHours({ business_hours: 2, after_hours: null, weekend_hours: 1, holiday_hours: null });
  assert.equal(result, 1);
});

// === formatHoursOrDash: la capa de presentación de "NONE = —" ===

test("formatHoursOrDash: null -> '—' (em dash), nunca '0 min' ni '0 h'", () => {
  assert.equal(formatHoursOrDash(null), "—");
});

test("formatHoursOrDash: 0 (numérico real) se muestra como '0 h', distinto de null", () => {
  assert.equal(formatHoursOrDash(0), "0 h");
  assert.notEqual(formatHoursOrDash(0), formatHoursOrDash(null));
});

test("formatHoursOrDash: redondea a 1 decimal y usa formato es-CL", () => {
  assert.equal(formatHoursOrDash(2.34), "2,3 h");
});

test("integración: una tarea NONE (business_hours=null) siempre termina en '—', nunca en '0 h'", () => {
  const total = totalAfterHoursHours({ business_hours: null, after_hours: null, weekend_hours: null, holiday_hours: null });
  assert.equal(formatHoursOrDash(total), "—");
});
