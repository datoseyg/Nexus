import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttentionSchedule } from "../../src/contracts/schedule-parser.js";

test("24/7 -> FULL_24X7, 7 ventanas all_day", () => {
  const r = parseAttentionSchedule({ attentionScheduleRaw: "24/7" });
  assert.equal(r.coverageType, "FULL_24X7");
  assert.equal(r.parseStatus, "OK");
  assert.equal(r.serviceWindowRows.length, 7);
  assert.ok(r.serviceWindowRows.every(w => w.allDay === true));
  assert.equal(r.issues.length, 0);
});

test("24/7 condicionado a fallas críticas -> CRITICAL_ONLY_24X7, condición preservada", () => {
  const r = parseAttentionSchedule({ attentionScheduleRaw: "24/7 (fuera de horario hábil solo fallas que impidan tratamiento de pacientes)" });
  assert.equal(r.coverageType, "CRITICAL_ONLY_24X7");
  assert.equal(r.coverageCondition, "fuera de horario hábil solo fallas que impidan tratamiento de pacientes");
  assert.equal(r.parseStatus, "OK");
  assert.equal(r.serviceWindowRows.length, 7);
});

test("24/7 con condición NO reconocida -> no se asume cobertura, REVIEW_REQUIRED", () => {
  const r = parseAttentionSchedule({ attentionScheduleRaw: "24/7 (algo distinto no documentado)" });
  assert.equal(r.coverageType, "BUSINESS_HOURS_UNDEFINED");
  assert.equal(r.parseStatus, "REVIEW_REQUIRED");
  assert.equal(r.serviceWindowRows.length, 0);
});

test("Lun a Vie ventana fija -> FIXED_WINDOW, 5 ventanas MON-FRI", () => {
  const r = parseAttentionSchedule({ attentionScheduleRaw: "Lun a Vie de 8:00 a 17:00 (mientras este vigente la garantia)" });
  assert.equal(r.coverageType, "FIXED_WINDOW");
  assert.equal(r.serviceWindowRows.length, 5);
  assert.deepEqual(r.serviceWindowRows.map(w => w.dayOfWeek), ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.ok(r.serviceWindowRows.every(w => w.startTime === "08:00" && w.endTime === "17:00"));
});

test("Días hábiles HH:MM a HH:MM -> FIXED_WINDOW, 5 ventanas, nunca fin de semana", () => {
  const r = parseAttentionSchedule({ attentionScheduleRaw: "Días hábiles de 07:00 a 19:00 (No incluye fines de semana ni festivos)" });
  assert.equal(r.coverageType, "FIXED_WINDOW");
  assert.equal(r.serviceWindowRows.length, 5);
  assert.ok(!r.serviceWindowRows.some(w => w.dayOfWeek === "SAT" || w.dayOfWeek === "SUN"));
});

test("Lun a Jue X - Vie Y -> FIXED_WINDOW, 5 ventanas (4 iguales + 1 distinta)", () => {
  const r = parseAttentionSchedule({ attentionScheduleRaw: "Lun a Jue 8:00 a 17:00 - Vie 7:00 a 16:00 (Mant. fuera de horario)" });
  assert.equal(r.serviceWindowRows.length, 5);
  const monThu = r.serviceWindowRows.filter(w => ["MON", "TUE", "WED", "THU"].includes(w.dayOfWeek));
  const fri = r.serviceWindowRows.find(w => w.dayOfWeek === "FRI");
  assert.equal(monThu.length, 4);
  assert.ok(monThu.every(w => w.startTime === "08:00" && w.endTime === "17:00"));
  assert.equal(fri.startTime, "07:00");
  assert.equal(fri.endTime, "16:00");
});

test("'Horario hábil' -> Lun-Vie 08:30-17:30 sin festivos", () => {
  const r = parseAttentionSchedule({
    attentionScheduleRaw: "Horario hábil"
  });

  assert.equal(r.coverageType, "FIXED_WINDOW");
  assert.equal(r.coverageCondition, null);
  assert.equal(r.parseStatus, "OK");
  assert.deepEqual(r.issues, []);

  assert.deepEqual(r.serviceWindowRows, [
    {
      dayOfWeek: "MON",
      startTime: "08:30",
      endTime: "17:30",
      allDay: false,
      includesHolidays: false
    },
    {
      dayOfWeek: "TUE",
      startTime: "08:30",
      endTime: "17:30",
      allDay: false,
      includesHolidays: false
    },
    {
      dayOfWeek: "WED",
      startTime: "08:30",
      endTime: "17:30",
      allDay: false,
      includesHolidays: false
    },
    {
      dayOfWeek: "THU",
      startTime: "08:30",
      endTime: "17:30",
      allDay: false,
      includesHolidays: false
    },
    {
      dayOfWeek: "FRI",
      startTime: "08:30",
      endTime: "17:30",
      allDay: false,
      includesHolidays: false
    }
  ]);
});

test("normaliza variantes de 'Horario hábil'", () => {
  for (const raw of [
    "Horario hábil",
    "HORARIO HÁBIL",
    "horario habil",
    "  Horario hábil  "
  ]) {
    const r = parseAttentionSchedule({
      attentionScheduleRaw: raw
    });

    assert.equal(r.coverageType, "FIXED_WINDOW");
    assert.equal(r.parseStatus, "OK");
    assert.equal(r.serviceWindowRows.length, 5);
    assert.deepEqual(r.issues, []);
  }
});

test("'N/A' -> NOT_APPLICABLE, revisión, sin ventanas inventadas", () => {
  const r = parseAttentionSchedule({ attentionScheduleRaw: "N/A" });
  assert.equal(r.coverageType, "NOT_APPLICABLE");
  assert.equal(r.parseStatus, "REVIEW_REQUIRED");
  assert.equal(r.serviceWindowRows.length, 0);
  assert.equal(r.issues[0].issueType, "MISSING_ATTENTION_SCHEDULE");
});

test("vacío -> UNKNOWN, revisión", () => {
  const r = parseAttentionSchedule({ attentionScheduleRaw: "" });
  assert.equal(r.coverageType, "UNKNOWN");
  assert.equal(r.parseStatus, "REVIEW_REQUIRED");
  assert.equal(r.issues[0].issueType, "MISSING_ATTENTION_SCHEDULE");
});
