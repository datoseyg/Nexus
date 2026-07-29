// Estado de URL de los filtros de la pestaña "Bandeja" de Auditoría - mismo
// idioma que lib/fieldbeat-tabs-url-state.ts (useSearchParams + router.push,
// nunca useState local no persistido): filtros compartibles por link,
// sobreviven a un refresh, y son el destino real de la navegación desde
// Resumen (GovernanceKpisSection.onNavigateToInbox). Pure functions, sin
// DOM - testeables sin jsdom.
export const BANDEJA_STATUS_VALUES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;
export type BandejaStatusValue = (typeof BANDEJA_STATUS_VALUES)[number];

export const BANDEJA_SEVERITY_VALUES = ["HIGH", "MEDIUM", "LOW", "WARNING"] as const;
export type BandejaSeverityValue = (typeof BANDEJA_SEVERITY_VALUES)[number];

export const BANDEJA_HAS_CASE_VALUES = ["yes", "no"] as const;
export type BandejaHasCaseValue = (typeof BANDEJA_HAS_CASE_VALUES)[number];

export const BANDEJA_VERIFICATION_VALUES = ["pending", "still_detected", "passed", "dead_letter", "none"] as const;
export type BandejaVerificationValue = (typeof BANDEJA_VERIFICATION_VALUES)[number];

export interface BandejaUrlFilters {
  status?: BandejaStatusValue;
  severity?: BandejaSeverityValue;
  ruleCode?: string;
  entityType?: string;
  hasCase?: BandejaHasCaseValue;
  verification?: BandejaVerificationValue;
  q?: string;
}

export interface BandejaUrlState {
  filters: BandejaUrlFilters;
  page: number;
}

function str(params: URLSearchParams, key: string): string | undefined {
  const v = params.get(key);
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/** Exportado también para los route handlers de /api/audit/issues[/export] -
 * mismo parseo de enum de query param, una sola implementación (antes
 * duplicada como readEnumParam en ambas rutas). */
export function enumVal<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = str(params, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function readBandejaUrlState(params: URLSearchParams): BandejaUrlState {
  return {
    filters: {
      status: enumVal(params, "status", BANDEJA_STATUS_VALUES),
      severity: enumVal(params, "severity", BANDEJA_SEVERITY_VALUES),
      ruleCode: str(params, "ruleCode"),
      entityType: str(params, "entityType"),
      hasCase: enumVal(params, "hasCase", BANDEJA_HAS_CASE_VALUES),
      verification: enumVal(params, "verification", BANDEJA_VERIFICATION_VALUES),
      q: str(params, "q")
    },
    page: Math.max(1, Number(params.get("page")) || 1)
  };
}

/** Nunca escribe page=1 en la URL (es el default) - el resto de los
 * filtros solo se escriben cuando tienen un valor. */
export function buildBandejaQueryString(state: BandejaUrlState): string {
  const params = new URLSearchParams();
  const f = state.filters;
  if (f.status) params.set("status", f.status);
  if (f.severity) params.set("severity", f.severity);
  if (f.ruleCode) params.set("ruleCode", f.ruleCode);
  if (f.entityType) params.set("entityType", f.entityType);
  if (f.hasCase) params.set("hasCase", f.hasCase);
  if (f.verification) params.set("verification", f.verification);
  if (f.q) params.set("q", f.q);
  if (state.page > 1) params.set("page", String(state.page));
  return params.toString();
}

export function hasActiveBandejaFilters(filters: BandejaUrlFilters): boolean {
  return Object.values(filters).some(v => v !== undefined);
}

export const EMPTY_BANDEJA_FILTERS: BandejaUrlFilters = {};
