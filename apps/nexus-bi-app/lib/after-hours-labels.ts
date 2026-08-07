import type { StatusTone } from "@/components/ui/StatusBadge";
import type {
  AfterHoursCalculationStatus,
  AfterHoursCoverageClassification,
  AfterHoursCoverageReasonCode,
  AfterHoursDataBasis
} from "@/types/after-hours";

// Vocabularios de negocio de /dashboard/after-hours, centralizados
// (ETAPA 6.6D §14) - ningún componente debe repetir un ternario o switch
// sobre estos códigos. Cada entrada define label/shortLabel/description/
// severity; un código desconocido (dato futuro no contemplado) degrada de
// forma segura vía las funciones getters de más abajo, nunca lanza.

export interface CodeLabel {
  label: string;
  shortLabel: string;
  description: string;
  severity: StatusTone;
}

const UNKNOWN_LABEL: CodeLabel = {
  label: "Sin clasificar",
  shortLabel: "N/D",
  description: "Valor no reconocido por la interfaz.",
  severity: "neutral"
};

function lookup<K extends string>(map: Record<K, CodeLabel>, code: K | string | null | undefined): CodeLabel {
  if (code === null || code === undefined) return UNKNOWN_LABEL;
  return (map as Record<string, CodeLabel>)[code] ?? UNKNOWN_LABEL;
}

// === data_basis ===
const DATA_BASIS_LABELS: Record<AfterHoursDataBasis, CodeLabel> = {
  CONTRACTUAL: {
    label: "Con contrato vigente",
    shortLabel: "Contrato",
    description: "El cálculo usó la cobertura de un contrato de servicio vigente para el equipo de la tarea.",
    severity: "success"
  },
  LEGACY_SCHEDULE: {
    label: "Con horario global",
    shortLabel: "Horario global",
    description: "El intento contractual no pudo resolverse; el cálculo usó el horario laboral global de respaldo.",
    severity: "info"
  },
  NONE: {
    label: "No calculable",
    shortLabel: "No calculable",
    description: "Ni el contrato ni el horario global pudieron calcular la cobertura de esta tarea.",
    severity: "neutral"
  }
};
export function getDataBasisLabel(code: AfterHoursDataBasis | string | null | undefined): CodeLabel {
  return lookup(DATA_BASIS_LABELS, code);
}

// === coverage_classification / contractual_coverage_classification ===
const COVERAGE_CLASSIFICATION_LABELS: Record<AfterHoursCoverageClassification, CodeLabel> = {
  FULLY_COVERED: {
    label: "Totalmente cubierta",
    shortLabel: "Cubierta",
    description: "Toda la duración de la tarea cayó dentro de la ventana de cobertura.",
    severity: "success"
  },
  PARTIALLY_COVERED: {
    label: "Parcialmente cubierta",
    shortLabel: "Parcial",
    description: "Parte de la tarea cayó dentro de la ventana de cobertura y parte fuera.",
    severity: "warning"
  },
  NOT_COVERED: {
    label: "Sin cobertura",
    shortLabel: "Sin cobertura",
    description: "Toda la duración de la tarea cayó fuera de la ventana de cobertura.",
    severity: "danger"
  },
  NOT_CALCULABLE: {
    label: "No calculable",
    shortLabel: "No calculable",
    description: "No fue posible determinar la cobertura de esta tarea.",
    severity: "neutral"
  }
};
export function getCoverageClassificationLabel(code: AfterHoursCoverageClassification | string | null | undefined): CodeLabel {
  return lookup(COVERAGE_CLASSIFICATION_LABELS, code);
}

// === coverage_reason_code / contractual_reason_code (17 códigos
// compartidos - contractual_reason_code simplemente nunca usa
// WITHIN_LEGACY_SCHEDULE, mismo mapa sirve para ambos campos). ===
const REASON_CODE_LABELS: Record<AfterHoursCoverageReasonCode, CodeLabel> = {
  WITHIN_MATCHED_CONTRACT: {
    label: "Dentro del contrato vigente",
    shortLabel: "Contrato",
    description: "El equipo tiene un contrato vigente que cubre (total o parcialmente) el horario de la tarea.",
    severity: "success"
  },
  WITHIN_LEGACY_SCHEDULE: {
    label: "Horario global de respaldo",
    shortLabel: "Horario global",
    description: "Para el cálculo se usó el horario laboral general (Lunes a Viernes 8h00 - 18h00) dado que se ha detectado una excepcionalidad con este Reporte, revisar motivos más abajo.",
    severity: "info"
  },
  MULTIPLE_EQUIPMENT_SAME_COVERAGE: {
    label: "Varios equipos, misma cobertura",
    shortLabel: "Multi-equipo",
    description: "La tarea involucra más de un equipo, todos con cobertura contractual idéntica.",
    severity: "success"
  },
  MULTIPLE_EQUIPMENT_CONFLICT: {
    label: "Equipos con cobertura distinta",
    shortLabel: "Conflicto multi-equipo",
    description: "La tarea involucra más de un equipo con coberturas contractuales distintas entre sí.",
    severity: "warning"
  },
  NO_EQUIPMENT: {
    label: "Sin equipo asociado",
    shortLabel: "Sin equipo",
    description: "La tarea no tiene ningún equipo FieldBeat asociado para intentar la resolución contractual.",
    severity: "neutral"
  },
  EQUIPMENT_UNMATCHED: {
    label: "Equipo sin identificar",
    shortLabel: "Sin match",
    description: "El equipo de la tarea no pudo vincularse a ningún equipo con contrato conocido.",
    severity: "warning"
  },
  EQUIPMENT_AMBIGUOUS: {
    label: "Equipo ambiguo",
    shortLabel: "Ambiguo",
    description: "El equipo de la tarea coincide con más de un equipo contractual posible.",
    severity: "warning"
  },
  NO_CONTRACT_AT_TASK_DATE: {
    label: "Sin contrato en esa fecha",
    shortLabel: "Sin contrato",
    description: "El equipo no tenía un contrato vigente en la fecha en que ocurrió la tarea.",
    severity: "neutral"
  },
  NO_CONTRACT: {
    label: "Sin contrato de atención",
    shortLabel: "Sin contrato",
    description: "El equipo está explícitamente registrado sin contrato de atención; se utiliza el horario global como fallback.",
    severity: "neutral"
  },
  NO_CONTRACT_STATUS: {
    label: "Sin estado de contrato",
    shortLabel: "Sin contrato",
    description: "El contrato del equipo no tiene un estado activo registrado.",
    severity: "neutral"
  },
  ON_DEMAND_UNDEFINED: {
    label: "Cobertura a demanda no definida",
    shortLabel: "A demanda",
    description: "El contrato es a demanda y no define una ventana horaria fija que calcular.",
    severity: "neutral"
  },
  CONTRACT_STATUS_DEINSTALLED: {
    label: "Equipo desinstalado",
    shortLabel: "Desinstalado",
    description: "El equipo figura como desinstalado en el contrato a la fecha de la tarea.",
    severity: "neutral"
  },
  SCHEDULE_REVIEW_REQUIRED: {
    label: "Horario contractual requiere revisión",
    shortLabel: "Requiere revisión",
    description: "El horario de cobertura del contrato no pudo interpretarse automáticamente.",
    severity: "warning"
  },
  CRITICALITY_UNKNOWN: {
    label: "Criticidad no disponible",
    shortLabel: "Sin señal",
    description: "El contrato exige distinguir equipos críticos, pero no existe esa señal en el origen de datos.",
    severity: "neutral"
  },
  HOLIDAY_COVERAGE_UNKNOWN: {
    label: "Calendario de feriados sin cobertura",
    shortLabel: "Sin calendario",
    description: "No existe información de feriados gobernada para la fecha de la tarea.",
    severity: "neutral"
  },
  INVALID_START_TIME: {
    label: "Hora de inicio inválida",
    shortLabel: "Sin inicio",
    description: "La tarea no tiene una hora de inicio válida para calcular ningún intervalo.",
    severity: "neutral"
  },
  INVALID_DURATION: {
    label: "Duración inválida",
    shortLabel: "Sin duración",
    description: "La tarea no tiene una duración válida para calcular ningún intervalo.",
    severity: "neutral"
  },
  INSUFFICIENT_DATA: {
    label: "Datos insuficientes",
    shortLabel: "Datos insuficientes",
    description: "No hay datos suficientes en el origen para calcular esta tarea.",
    severity: "neutral"
  }
};
export function getReasonCodeLabel(code: AfterHoursCoverageReasonCode | string | null | undefined): CodeLabel {
  return lookup(REASON_CODE_LABELS, code);
}

// === calculation_status ===
const CALCULATION_STATUS_LABELS: Record<AfterHoursCalculationStatus, CodeLabel> = {
  CALCULATED: { label: "Calculado", shortLabel: "Calculado", description: "El cálculo se completó sin advertencias.", severity: "success" },
  CALCULATED_WITH_WARNINGS: {
    label: "Calculado con advertencias",
    shortLabel: "Con advertencias",
    description: "El cálculo se completó, pero con datos parciales o supuestos adicionales.",
    severity: "warning"
  },
  NOT_CALCULABLE: { label: "No calculable", shortLabel: "No calculable", description: "No fue posible completar el cálculo para esta tarea.", severity: "neutral" }
};
export function getCalculationStatusLabel(code: AfterHoursCalculationStatus | string | null | undefined): CodeLabel {
  return lookup(CALCULATION_STATUS_LABELS, code);
}

// === fallback_used ===
export function getFallbackLabel(fallbackUsed: boolean | null | undefined): CodeLabel {
  if (fallbackUsed === true) {
    return {
      label: "Usó horario de respaldo",
      shortLabel: "Con fallback",
      description: "El intento contractual falló y se usó el horario global como respaldo.",
      severity: "info"
    };
  }
  if (fallbackUsed === false) {
    return { label: "Sin respaldo", shortLabel: "Sin fallback", description: "No fue necesario recurrir al horario de respaldo.", severity: "neutral" };
  }
  return UNKNOWN_LABEL;
}

// === confidence_label (tiers ya vienen como string del backend, ETAPA 6.6B) ===
const CONFIDENCE_TIER_LABELS: Record<string, CodeLabel> = {
  Alta: { label: "Alta", shortLabel: "Alta", description: "El cálculo usa datos completos, consistentes y reglas validadas.", severity: "success" },
  Media: { label: "Media", shortLabel: "Media", description: "El cálculo es razonable, pero depende de supuestos o campos derivados.", severity: "info" },
  Baja: { label: "Baja", shortLabel: "Baja", description: "El cálculo usa datos incompletos o supuestos fuertes.", severity: "warning" },
  Insuficiente: { label: "Insuficiente", shortLabel: "Insuficiente", description: "El dato base no permite confiar en el cálculo.", severity: "danger" }
};
export function getConfidenceTierLabel(tier: string | null | undefined): CodeLabel {
  if (tier === null || tier === undefined) {
    return { label: "Sin información", shortLabel: "Sin info.", description: "No hay un puntaje de confianza calculado para este registro.", severity: "neutral" };
  }
  return lookup(CONFIDENCE_TIER_LABELS, tier);
}

// === día de la semana (ETAPA 6.6D) - ISODOW (lunes=1..domingo=7), mismo
// orden que DAY_ORDER en src/contracts/contract-fingerprint.js. Nunca el
// DOW nativo de Postgres (domingo=0), para que la semana siempre empiece
// en lunes tanto en SQL como en la UI. ===
export const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo"
};

const WEEKDAY_SHORT_LABELS: Record<number, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mié",
  4: "Jue",
  5: "Vie",
  6: "Sáb",
  7: "Dom"
};

function normalizeIsoDow(isoDow: number | string | null | undefined): number | null {
  if (isoDow === null || isoDow === undefined) return null;
  const n = typeof isoDow === "string" ? Number(isoDow) : isoDow;
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

export function getWeekdayLabel(isoDow: number | string | null | undefined): string {
  const n = normalizeIsoDow(isoDow);
  return n === null ? "Sin día" : WEEKDAY_LABELS[n];
}

export function getWeekdayShortLabel(isoDow: number | string | null | undefined): string {
  const n = normalizeIsoDow(isoDow);
  return n === null ? "N/D" : WEEKDAY_SHORT_LABELS[n];
}

/**
 * Construye el texto de "Diagnóstico" para la tabla de detalle (§11):
 * combina data_basis + fallback_used + coverage_reason_code/
 * contractual_reason_code en una frase legible, nunca códigos técnicos
 * como texto principal. El código técnico queda disponible como `code`
 * para tooltips/depuración, no para mostrarse solo.
 */
export function buildDiagnosis(input: {
  dataBasis: AfterHoursDataBasis | string | null | undefined;
  fallbackUsed: boolean | null | undefined;
  coverageReasonCode: AfterHoursCoverageReasonCode | string | null | undefined;
  contractualReasonCode: AfterHoursCoverageReasonCode | string | null | undefined;
}): { primary: CodeLabel; secondary: string | null } {
  const basis = getDataBasisLabel(input.dataBasis);

  if (input.dataBasis === "NONE") {
    const reason = getReasonCodeLabel(input.coverageReasonCode);
    return { primary: reason, secondary: null };
  }

  if (input.fallbackUsed === true) {
    const contractualReason = getReasonCodeLabel(input.contractualReasonCode);
    return {
      primary: basis,
      secondary: `Intento contractual: ${contractualReason.label.toLowerCase()}.`
    };
  }

  return { primary: basis, secondary: null };
}
