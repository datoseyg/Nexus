export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_STYLE: Record<StatusTone, { bg: string; fg: string }> = {
  success: { bg: "#eaf5ea", fg: "#2f5c2a" },
  warning: { bg: "#fdf1da", fg: "#8a5a06" },
  danger: { bg: "#fbeae9", fg: "#a03330" },
  info: { bg: "#e6f3f3", fg: "#175f5f" },
  neutral: { bg: "#eef1f0", fg: "#5e6b70" }
};

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  size?: "sm" | "md";
}

// Pill de estado - usado en la vista de Auditoría / Validación Manual
// para match_status, report_quality_status y zendesk_join_status (ver
// helpers de mapeo abajo), y en ConfidenceBadge.tsx para el score de
// confiabilidad de Trabajo Fuera de Horario. Nunca color-solo: siempre
// lleva texto.
export function StatusBadge({ label, tone = "neutral", size = "md" }: StatusBadgeProps) {
  const style = TONE_STYLE[tone];
  const sizeClass = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-semibold ${sizeClass}`}
      style={{ background: style.bg, color: style.fg }}
    >
      {label}
    </span>
  );
}

// Mapeos de vocabularios reales del pipeline -> {label, tone}. Documentado
// también en docs/MANUAL_REVIEW_VIEW.md - no inventan categorías nuevas,
// solo traducen los valores crudos ya definidos en DATA_DICTIONARY.md.
export function matchStatusBadge(status: string | null | undefined): { label: string; tone: StatusTone } {
  switch (status) {
    case "MATCHED":
      return { label: "Match confirmado", tone: "success" };
    case "AMBIGUOUS_MATCH":
      return { label: "Match ambiguo", tone: "warning" };
    case "PLACEHOLDER_VALUE":
      return { label: "Placeholder", tone: "neutral" };
    case "NO_MATCH":
      return { label: "Sin match", tone: "danger" };
    case "NO_PART_USED":
      return { label: "Sin repuesto utilizado", tone: "neutral" };
    default:
      return { label: status ?? "-", tone: "neutral" };
  }
}

export function reportQualityBadge(status: string | null | undefined): { label: string; tone: StatusTone } {
  switch (status) {
    case "OK":
      return { label: "OK", tone: "success" };
    case "NO_USED_PARTS":
      return { label: "Sin repuestos", tone: "neutral" };
    case "HAS_PLACEHOLDERS":
      return { label: "Con placeholders", tone: "warning" };
    case "HAS_UNMATCHED_PARTS":
      return { label: "Repuestos sin match", tone: "danger" };
    case "HAS_AMBIGUOUS_PARTS":
      return { label: "Matches ambiguos", tone: "warning" };
    case "REVIEW_REQUIRED":
      return { label: "Revisión requerida", tone: "warning" };
    default:
      return { label: status ?? "-", tone: "neutral" };
  }
}

export function zendeskJoinBadge(status: string | null | undefined): { label: string; tone: StatusTone } {
  switch (status) {
    case "LINKED_TO_ACCESSIBLE_ZENDESK":
      return { label: "Ticket accesible", tone: "success" };
    case "LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK":
      return { label: "Ticket faltante/restringido", tone: "danger" };
    case "NO_TICKET_REPORTED":
      return { label: "Sin ticket reportado", tone: "neutral" };
    default:
      return { label: status ?? "-", tone: "neutral" };
  }
}

// governance.issues.status (Gate B, B1) - estados persistentes del ciclo de
// vida de incidencias.
export function issueStatusBadge(status: string | null | undefined): { label: string; tone: StatusTone } {
  switch (status) {
    case "OPEN":
      return { label: "Abierta", tone: "danger" };
    case "IN_REVIEW":
      return { label: "En revisión", tone: "warning" };
    case "RESOLVED":
      return { label: "Resuelta", tone: "success" };
    case "DISMISSED":
      return { label: "Descartada", tone: "neutral" };
    default:
      return { label: status ?? "-", tone: "neutral" };
  }
}

// governance.issues.severity (Gate B, B1/B41).
export function severityBadge(severity: string | null | undefined): { label: string; tone: StatusTone } {
  switch (severity) {
    case "HIGH":
      return { label: "Alta", tone: "danger" };
    case "MEDIUM":
      return { label: "Media", tone: "warning" };
    case "LOW":
      return { label: "Baja", tone: "info" };
    case "WARNING":
      return { label: "Advertencia", tone: "warning" };
    default:
      return { label: severity ?? "-", tone: "neutral" };
  }
}

// governance.review_cases.status (Gate B, B4).
export function reviewCaseStatusBadge(status: string | null | undefined): { label: string; tone: StatusTone } {
  switch (status) {
    case "OPEN":
      return { label: "Abierto", tone: "info" };
    case "IN_REVIEW":
      return { label: "En revisión", tone: "warning" };
    case "RESOLVED":
      return { label: "Resuelto", tone: "success" };
    case "DISMISSED":
      return { label: "Descartado", tone: "neutral" };
    default:
      return { label: status ?? "-", tone: "neutral" };
  }
}

// calculation_status de marts.fieldbeat_working_hours_analysis - ver
// docs/CALCULATION_CONFIDENCE_MODEL.md.
export function calculationStatusBadge(status: string | null | undefined): { label: string; tone: StatusTone } {
  switch (status) {
    case "CALCULATED":
      return { label: "Calculado", tone: "success" };
    case "CALCULATED_WITH_WARNINGS":
      return { label: "Calculado con advertencias", tone: "warning" };
    case "NOT_CALCULABLE":
      return { label: "No calculable", tone: "danger" };
    default:
      return { label: status ?? "-", tone: "neutral" };
  }
}
