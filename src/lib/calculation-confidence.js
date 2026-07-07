// Modelo de confiabilidad reutilizable para "Trabajo Fuera de Horario" (y
// cualquier otro calculo futuro que necesite lo mismo). Ver
// docs/CALCULATION_CONFIDENCE_MODEL.md para la explicacion completa.
//
// IMPORTANTE: esto NO es una probabilidad estadistica. Es un score de
// confiabilidad METODOLOGICA (0-100) basado en calidad de datos,
// trazabilidad y supuestos del calculo - no una medida de probabilidad de
// que el numero sea "correcto". Nunca presentar este score como una
// garantia de certeza.

export const CONFIDENCE_TIERS = [
  { min: 0, max: 39, label: "Insuficiente", tone: "danger", description: "El dato base no permite confiar en el cálculo." },
  { min: 40, max: 64, label: "Baja", tone: "warning", description: "El cálculo usa datos incompletos o supuestos fuertes." },
  { min: 65, max: 84, label: "Media", tone: "info", description: "El cálculo es razonable, pero depende de supuestos o campos derivados." },
  { min: 85, max: 100, label: "Alta", tone: "success", description: "El cálculo usa datos completos, consistentes y reglas validadas." }
];

export const CALCULATION_METHODS = [
  "EXACT_REPORTED_START_END",
  "ESTIMATED_FROM_START_DURATION",
  "PARTIAL_ESTIMATE",
  "INVALID_START_TIME",
  "INVALID_DURATION",
  "INSUFFICIENT_DATA"
];

const NOT_CALCULABLE_METHODS = new Set(["INVALID_START_TIME", "INVALID_DURATION", "INSUFFICIENT_DATA"]);

function clampScore(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function findTier(score) {
  const clamped = clampScore(score);
  return CONFIDENCE_TIERS.find(t => clamped >= t.min && clamped <= t.max) || CONFIDENCE_TIERS[0];
}

export function getConfidenceLabel(score) {
  const tier = findTier(score);
  return { label: tier.label, description: tier.description };
}

export function getConfidenceColor(score) {
  return findTier(score).tone;
}

// Deriva el status coarse (3 valores) usado para filtrar/contar KPI 6
// ("tareas no calculables") a partir del calculation_method (6 valores).
export function calculationStatusFromMethod(method) {
  if (method === "PARTIAL_ESTIMATE") return "CALCULATED_WITH_WARNINGS";
  if (NOT_CALCULABLE_METHODS.has(method)) return "NOT_CALCULABLE";
  return "CALCULATED";
}

// Calcula el score de confiabilidad (0-100) y el calculation_method de UNA
// tarea. `task` trae los campos crudos relevantes de fieldbeat_tasks;
// `context.reportedInterval` (si existe) ya fue resuelto+validado por el
// mart builder contra fieldbeat_report_fields (ver src/lib/business-hours.js
// y src/marts/build-fieldbeat-working-hours-analysis.js) - esta función no
// vuelve a parsear report_fields, solo interpreta el resultado.
//
// context = {
//   businessHoursStatus: "VALIDATED" | "DEFAULT_UNVALIDATED" | "MISSING",
//   holidaysStatus: "VALIDATED" | "EXAMPLE_INCOMPLETE" | "MISSING",
//   reportedInterval: { startMs, endMs, plausible: boolean } | null
// }
export function calculateTaskTimeConfidence(task, context = {}) {
  const factorDetails = [];
  let score = 0;

  // Factor 1 (+25/+0): start_time válido.
  const startTimeRaw = task.start_time ?? task.start_time_utc;
  const startDate = startTimeRaw ? new Date(startTimeRaw) : null;
  const startValid = !!startDate && !Number.isNaN(startDate.getTime());

  if (startValid) {
    score += 25;
    factorDetails.push({ factor: "start_time", points: 25, max: 25, reason: "start_time válido" });
  } else {
    factorDetails.push({ factor: "start_time", points: 0, max: 25, reason: "start_time ausente o inválido" });
  }

  // Factor 2 (+25/+10/+0): duration_minutes válido.
  const durationNum = Number(task.duration_minutes);
  const durationPresent = task.duration_minutes !== undefined && task.duration_minutes !== null && task.duration_minutes !== "" && !Number.isNaN(durationNum);
  const durationPositive = durationPresent && durationNum > 0;
  const durationSuspicious = durationPositive && (durationNum < 5 || durationNum >= 480 || durationNum === 1440);
  const durationValid = durationPositive && !durationSuspicious;

  if (durationValid) {
    score += 25;
    factorDetails.push({ factor: "duration_minutes", points: 25, max: 25, reason: "duration_minutes válido" });
  } else if (durationSuspicious) {
    score += 10;
    factorDetails.push({ factor: "duration_minutes", points: 10, max: 25, reason: "duration_minutes sospechoso o extremo" });
  } else {
    factorDetails.push({ factor: "duration_minutes", points: 0, max: 25, reason: "duration_minutes ausente, cero o negativo" });
  }

  // Factor 3 (+15/+5/+0): hora real de término.
  const reportedInterval = context.reportedInterval || null;
  const hasPlausibleReported = !!(reportedInterval && reportedInterval.plausible);

  if (hasPlausibleReported) {
    score += 15;
    factorDetails.push({ factor: "hora_termino", points: 15, max: 15, reason: "hora de término reportada y validada (plausible contra duration_minutes)" });
  } else if (startValid) {
    score += 5;
    factorDetails.push({ factor: "hora_termino", points: 5, max: 15, reason: "hora de término estimada (start_time + duration_minutes)" });
  } else {
    factorDetails.push({ factor: "hora_termino", points: 0, max: 15, reason: "no se puede estimar hora de término (start_time inválido)" });
  }

  // Factor 4 (+15/+8/+0): calendario laboral configurado.
  const businessHoursStatus = context.businessHoursStatus || "MISSING";
  if (businessHoursStatus === "VALIDATED") {
    score += 15;
    factorDetails.push({ factor: "calendario_laboral", points: 15, max: 15, reason: "calendario laboral configurado y validado con negocio" });
  } else if (businessHoursStatus === "DEFAULT_UNVALIDATED") {
    score += 8;
    factorDetails.push({ factor: "calendario_laboral", points: 8, max: 15, reason: "calendario laboral configurado pero sin validar con negocio (default)" });
  } else {
    factorDetails.push({ factor: "calendario_laboral", points: 0, max: 15, reason: "no existe calendario laboral configurado" });
  }

  // Factor 5 (+10/+3/+0): feriados configurados.
  const holidaysStatus = context.holidaysStatus || "MISSING";
  if (holidaysStatus === "VALIDATED") {
    score += 10;
    factorDetails.push({ factor: "feriados", points: 10, max: 10, reason: "feriados validados con negocio" });
  } else if (holidaysStatus === "EXAMPLE_INCOMPLETE") {
    score += 3;
    factorDetails.push({ factor: "feriados", points: 3, max: 10, reason: "feriados: solo fechas fijas, archivo example incompleto" });
  } else {
    factorDetails.push({ factor: "feriados", points: 0, max: 10, reason: "no hay calendario de feriados configurado" });
  }

  // Factor 6 (+10/+5/+0): trazabilidad de fuente.
  const hasClient = !!String(task.client_key ?? "").trim();
  const hasTaskType = !!String(task.task_type ?? "").trim();
  const hasTechnician = !!String(task.assigned_to ?? "").trim();
  const secondaryCount = [hasTaskType, hasTechnician].filter(Boolean).length;

  if (hasClient && secondaryCount === 2) {
    score += 10;
    factorDetails.push({ factor: "trazabilidad", points: 10, max: 10, reason: "trazabilidad completa (cliente, tipo de tarea, técnico)" });
  } else if (hasClient && secondaryCount === 1) {
    score += 5;
    factorDetails.push({ factor: "trazabilidad", points: 5, max: 10, reason: "trazabilidad parcial (falta tipo de tarea o técnico)" });
  } else {
    factorDetails.push({ factor: "trazabilidad", points: 0, max: 10, reason: "trazabilidad insuficiente (falta cliente y/o dos campos secundarios)" });
  }

  const clampedScore = clampScore(score);
  const { label } = getConfidenceLabel(clampedScore);

  // calculation_method - ver docs/CALCULATION_CONFIDENCE_MODEL.md para la
  // tabla de decisión completa.
  let method;
  if (!startValid) {
    method = "INVALID_START_TIME";
  } else if (hasPlausibleReported) {
    method = "EXACT_REPORTED_START_END";
  } else if (durationValid) {
    method = "ESTIMATED_FROM_START_DURATION";
  } else if (durationSuspicious || (reportedInterval && !reportedInterval.plausible)) {
    method = "PARTIAL_ESTIMATE";
  } else if (!durationPositive) {
    method = "INVALID_DURATION";
  } else {
    method = "INSUFFICIENT_DATA";
  }

  return {
    score: clampedScore,
    label,
    color: getConfidenceColor(clampedScore),
    method,
    factors: factorDetails.map(f => `${f.reason} (+${f.points})`).join(" | "),
    factorDetails
  };
}

function simpleAverageScore(rows) {
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, row) => sum + (Number(row.confidence_score) || 0), 0);
  return total / rows.length;
}

// Agrega confidence_score de un conjunto de filas del mart a nivel de KPI.
// metricType "hours": promedio ponderado por duration_minutes (una tarea
// de 10h de baja confianza pesa más que una de 5 min). metricType "count":
// promedio simple (cada tarea es una unidad discreta; ponderar por
// duración duplicaría la señal ya usada en los KPIs de horas). Ver
// docs/CALCULATION_CONFIDENCE_MODEL.md.
export function aggregateMetricConfidence(rows, metricType) {
  const list = Array.isArray(rows) ? rows : [];

  if (list.length === 0) {
    const zero = clampScore(0);
    return {
      score: zero,
      label: getConfidenceLabel(zero).label,
      color: getConfidenceColor(zero),
      method: metricType === "hours" ? "duration_weighted" : "simple_average",
      sampleSize: 0
    };
  }

  let rawScore;
  let method;

  if (metricType === "hours") {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const row of list) {
      const weight = Number(row.duration_minutes) || 0;
      weightedSum += (Number(row.confidence_score) || 0) * weight;
      weightTotal += weight;
    }
    rawScore = weightTotal > 0 ? weightedSum / weightTotal : simpleAverageScore(list);
    method = "duration_weighted";
  } else {
    rawScore = simpleAverageScore(list);
    method = "simple_average";
  }

  const score = clampScore(rawScore);
  return {
    score,
    label: getConfidenceLabel(score).label,
    color: getConfidenceColor(score),
    method,
    sampleSize: list.length
  };
}
