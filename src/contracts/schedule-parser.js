// Parsea únicamente los patrones contractuales gobernados:
// 24/7; 24/7 condicionado a fallas críticas; lunes a viernes con ventana
// explícita; lunes a jueves + viernes con ventana distinta; días hábiles
// con ventana explícita; y "Horario hábil", definido administrativamente
// como lunes a viernes de 08:30 a 17:30, sin festivos.
//
// Vacío, "N/A" o cualquier otro texto no reconocido queda en revisión;
// nunca se infiere un horario adicional.

const DAYS_MON_FRI = ["MON", "TUE", "WED", "THU", "FRI"];
const DAYS_ALL_WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const TIME_RANGE = "(\\d{1,2}):(\\d{2})\\s*a\\s*(\\d{1,2}):(\\d{2})";

const PATTERN_24X7 = /^24\/7$/;
const PATTERN_24X7_CONDITIONED = /^24\/7\s*\(([^)]+)\)$/i;
const CRITICAL_CONDITION_HINT = /falla/i;

const PATTERN_WEEKDAYS_WINDOW = new RegExp(
  `^Lun(?:es)?\\s*a\\s*Vie(?:rnes)?\\s*(?:de\\s*)?${TIME_RANGE}`,
  "i"
);
const PATTERN_BUSINESS_DAYS_WINDOW = new RegExp(
  `^D[ií]as h[áa]biles de ${TIME_RANGE}\\s*\\(No incluye fines de semana ni festivos\\)`,
  "i"
);
const PATTERN_MON_THU_FRI_SPLIT = new RegExp(
  `^Lun a Jue ${TIME_RANGE}\\s*-\\s*Vie ${TIME_RANGE}`,
  "i"
);

function fixedWindow(days, startH, startM, endH, endM) {
  const startTime = `${startH.padStart(2, "0")}:${startM}`;
  const endTime = `${endH.padStart(2, "0")}:${endM}`;
  return days.map(day => ({ dayOfWeek: day, startTime, endTime, allDay: false, includesHolidays: false }));
}

function allDayWindows() {
  return DAYS_ALL_WEEK.map(day => ({ dayOfWeek: day, startTime: null, endTime: null, allDay: true, includesHolidays: true }));
}

/**
 * @param {{ attentionScheduleRaw: string | null }} input
 * @returns {{ coverageType: string, coverageCondition: string | null, parseStatus: 'OK'|'REVIEW_REQUIRED', serviceWindowRows: Array<object>, issues: Array<{issueType: string, details: object}> }}
 */
export function parseAttentionSchedule({ attentionScheduleRaw }) {
  const raw = String(attentionScheduleRaw ?? "").trim();

  if (raw === "") {
    return {
      coverageType: "UNKNOWN",
      coverageCondition: null,
      parseStatus: "REVIEW_REQUIRED",
      serviceWindowRows: [],
      issues: [{ issueType: "MISSING_ATTENTION_SCHEDULE", details: { raw } }]
    };
  }

  if (raw.toUpperCase() === "N/A") {
    return {
      coverageType: "NOT_APPLICABLE",
      coverageCondition: null,
      parseStatus: "REVIEW_REQUIRED",
      serviceWindowRows: [],
      issues: [{ issueType: "MISSING_ATTENTION_SCHEDULE", details: { raw } }]
    };
  }

  if (/^Horario h[áa]bil$/i.test(raw)) {
  return {
    coverageType: "FIXED_WINDOW",
    coverageCondition: null,
    parseStatus: "OK",
    serviceWindowRows: fixedWindow(
      DAYS_MON_FRI,
      "08",
      "30",
      "17",
      "30"
    ),
    issues: []
  };
  }

  if (PATTERN_24X7.test(raw)) {
    return { coverageType: "FULL_24X7", coverageCondition: null, parseStatus: "OK", serviceWindowRows: allDayWindows(), issues: [] };
  }

  const conditioned = raw.match(PATTERN_24X7_CONDITIONED);
  if (conditioned) {
    const condition = conditioned[1].trim();
    if (CRITICAL_CONDITION_HINT.test(condition)) {
      return {
        coverageType: "CRITICAL_ONLY_24X7",
        coverageCondition: condition,
        parseStatus: "OK",
        serviceWindowRows: allDayWindows(),
        issues: []
      };
    }
    // 24/7 con una condición no reconocida como "solo fallas críticas" -no
    // se asume cobertura sin evidencia de criticidad demostrable.
    return {
      coverageType: "BUSINESS_HOURS_UNDEFINED",
      coverageCondition: condition,
      parseStatus: "REVIEW_REQUIRED",
      serviceWindowRows: [],
      issues: [{ issueType: "AMBIGUOUS_BUSINESS_HOURS", details: { raw, reason: "condición 24/7 no reconocida" } }]
    };
  }

  const monThuFriSplit = raw.match(PATTERN_MON_THU_FRI_SPLIT);
  if (monThuFriSplit) {
    const [, h1a, m1a, h1b, m1b, h2a, m2a, h2b, m2b] = monThuFriSplit;
    const windows = [
      ...fixedWindow(["MON", "TUE", "WED", "THU"], h1a, m1a, h1b, m1b),
      ...fixedWindow(["FRI"], h2a, m2a, h2b, m2b)
    ];
    return { coverageType: "FIXED_WINDOW", coverageCondition: null, parseStatus: "OK", serviceWindowRows: windows, issues: [] };
  }

  const businessDaysWindow = raw.match(PATTERN_BUSINESS_DAYS_WINDOW);
  if (businessDaysWindow) {
    const [, h1, m1, h2, m2] = businessDaysWindow;
    return {
      coverageType: "FIXED_WINDOW",
      coverageCondition: null,
      parseStatus: "OK",
      serviceWindowRows: fixedWindow(DAYS_MON_FRI, h1, m1, h2, m2),
      issues: []
    };
  }

  const weekdaysWindow = raw.match(PATTERN_WEEKDAYS_WINDOW);
  if (weekdaysWindow) {
    const [, h1, m1, h2, m2] = weekdaysWindow;
    return {
      coverageType: "FIXED_WINDOW",
      coverageCondition: null,
      parseStatus: "OK",
      serviceWindowRows: fixedWindow(DAYS_MON_FRI, h1, m1, h2, m2),
      issues: []
    };
  }

  // Cualquier otro texto no reconocido -nunca se asume un horario.
  return {
    coverageType: "UNKNOWN",
    coverageCondition: null,
    parseStatus: "REVIEW_REQUIRED",
    serviceWindowRows: [],
    issues: [{ issueType: "AMBIGUOUS_BUSINESS_HOURS", details: { raw, reason: "patrón no reconocido" } }]
  };
}
