// Estado de URL de la pestaña activa de /audit/manual-review - mismo idioma
// que lib/fieldbeat-tabs-url-state.ts (useSearchParams + router.push, nunca
// useState local no persistido) para que back/forward y enlaces directos
// funcionen. Pure functions, sin DOM - testeables sin jsdom.
export const AUDIT_TABS = ["summary", "inbox", "cases", "corrections", "rules", "history", "sources"] as const;
export type AuditTab = (typeof AUDIT_TABS)[number];
export const DEFAULT_AUDIT_TAB: AuditTab = "inbox";

const AUDIT_TAB_LABELS: Record<AuditTab, string> = {
  summary: "Resumen",
  inbox: "Bandeja",
  cases: "Casos",
  corrections: "Correcciones",
  rules: "Reglas",
  history: "Historial",
  sources: "Fuentes y pipeline"
};

export function auditTabLabel(tab: AuditTab): string {
  return AUDIT_TAB_LABELS[tab];
}

/** Un valor de tab inválido o ausente siempre resuelve a "inbox" (Bandeja -
 * la superficie operativa principal, no Resumen). */
export function readAuditTab(params: URLSearchParams): AuditTab {
  const raw = params.get("tab");
  return raw && (AUDIT_TABS as readonly string[]).includes(raw) ? (raw as AuditTab) : DEFAULT_AUDIT_TAB;
}

export function buildAuditTabQuery(tab: AuditTab): string {
  if (tab === DEFAULT_AUDIT_TAB) return "";
  const params = new URLSearchParams();
  params.set("tab", tab);
  return params.toString();
}
