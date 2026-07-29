"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, issueStatusBadge, severityBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { ExplorerDetailDrawer } from "@/components/explorer/ExplorerDetailDrawer";
import { triggerBlobDownload } from "@/lib/csv-export";
import { ENTITY_TYPE_LABELS, entityTypeLabel, verificationProcessingStatusLabel, verificationOutcomeLabel } from "@/lib/audit-vocabulary";
import {
  BANDEJA_STATUS_VALUES,
  BANDEJA_SEVERITY_VALUES,
  BANDEJA_HAS_CASE_VALUES,
  BANDEJA_VERIFICATION_VALUES,
  readBandejaUrlState,
  buildBandejaQueryString,
  hasActiveBandejaFilters,
  type BandejaUrlFilters
} from "@/lib/audit-bandeja-url-state";

interface IssuesBandejaSectionProps {
  role: "gerencia" | "administracion";
}

interface IssueRow {
  id: string;
  rule_code: string;
  rule_title: string;
  severity: string;
  status: string;
  entity_type: string;
  entity_key: string;
  occurrence_key: string;
  first_seen_at: string;
  last_seen_at: string;
  is_currently_detected: boolean;
  active_review_case_id: string | null;
  active_review_case_status: string | null;
  verification_processing_status: string | null;
  verification_outcome: string | null;
}

interface IssuesResponse {
  rows: IssueRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

interface RuleOption {
  rule_code: string;
  title: string;
}

const VERIFICATION_FILTER_LABELS: Record<string, string> = {
  pending: "Verificación pendiente",
  still_detected: "Problema persiste",
  passed: "Verificación aprobada",
  dead_letter: "Reintentos agotados",
  none: "Sin verificación"
};

function verificationBadge(row: IssueRow): { label: string; tone: StatusTone } | null {
  if (!row.verification_processing_status) return null;
  if (row.verification_outcome === "PASSED") return { label: verificationOutcomeLabel("PASSED"), tone: "success" };
  if (row.verification_outcome === "STILL_DETECTED") return { label: verificationOutcomeLabel("STILL_DETECTED"), tone: "danger" };
  if (row.verification_processing_status === "DEAD_LETTERED") return { label: verificationProcessingStatusLabel("DEAD_LETTERED"), tone: "danger" };
  if (row.verification_processing_status === "PENDING" || row.verification_processing_status === "RUNNING") {
    return { label: verificationProcessingStatusLabel(row.verification_processing_status), tone: "info" };
  }
  return { label: verificationProcessingStatusLabel(row.verification_processing_status), tone: "neutral" };
}

// Gate B - Familia 4/8: pestaña "Bandeja" - backlog completo de incidencias
// (governance.issues), filtros reales (estado/severidad/regla/entidad/
// asignación/verificación/búsqueda) persistidos en la URL - mismo idioma
// que lib/fieldbeat-tabs-url-state.ts, para que un link a "solo lo que
// falta verificar" sea compartible y sobreviva a un refresh. Reutiliza el
// drawer canónico de Incidencias del Explorador (ExplorerDetailDrawer, ya
// incluye IssueLifecycleActions) - nunca un segundo drawer de incidencia
// (B22: un solo drawer por entidad en todo el producto).
export function IssuesBandejaSection({ role }: IssuesBandejaSectionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { filters, page } = readBandejaUrlState(searchParams);

  const [ruleOptions, setRuleOptions] = useState<RuleOption[]>([]);
  const [data, setData] = useState<IssuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [qDraft, setQDraft] = useState(filters.q ?? "");

  useEffect(() => {
    fetch("/api/audit/rules")
      .then(res => res.json())
      .then(body => setRuleOptions((body.rows ?? []).map((r: { rule_code: string; title: string }) => ({ rule_code: r.rule_code, title: r.title }))))
      .catch(() => setRuleOptions([]));
  }, []);

  useEffect(() => {
    setQDraft(filters.q ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  function pushState(patch: Partial<BandejaUrlFilters> & { page?: number }, resetPage = true) {
    const nextFilters: BandejaUrlFilters = { ...filters, ...patch };
    const nextPage = patch.page ?? (resetPage ? 1 : page);
    const qs = buildBandejaQueryString({ filters: nextFilters, page: nextPage });
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function setFilter<K extends keyof BandejaUrlFilters>(key: K, value: BandejaUrlFilters[K] | "") {
    pushState({ [key]: value === "" ? undefined : value } as Partial<BandejaUrlFilters>);
  }

  function removeFilterChip(key: keyof BandejaUrlFilters) {
    if (key === "q") setQDraft("");
    setFilter(key, "");
  }

  function clearAllFilters() {
    router.push(pathname, { scroll: false });
  }

  function buildApiFilterParams() {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.ruleCode) params.set("ruleCode", filters.ruleCode);
    if (filters.entityType) params.set("entityType", filters.entityType);
    if (filters.hasCase) params.set("hasCase", filters.hasCase);
    if (filters.verification) params.set("verification", filters.verification);
    if (filters.q) params.set("q", filters.q);
    return params;
  }

  // Mismo patrón que FieldbeatReportsTab.handleExport: fetch en vez de <a
  // href> plano, porque el servidor puede rechazar con 413
  // (EXPORT_LIMIT_EXCEEDED) y esa respuesta es JSON, no CSV - un <a> nativo
  // la descargaría como si fuera el archivo.
  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const res = await fetch(`/api/audit/issues/export?${buildApiFilterParams().toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setExportError(body?.error ?? `No fue posible exportar (HTTP ${res.status}).`);
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] ?? "nexus-auditoria-bandeja.csv";
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
    } catch {
      setExportError("No fue posible exportar - revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  function refetch() {
    setLoading(true);
    setError(null);
    const params = buildApiFilterParams();
    params.set("page", String(page));
    params.set("pageSize", "25");
    fetch(`/api/audit/issues?${params.toString()}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }

  useEffect(refetch, [filters.status, filters.severity, filters.ruleCode, filters.entityType, filters.hasCase, filters.verification, filters.q, page]);

  const activeFilterChips: Array<{ key: keyof BandejaUrlFilters; label: string }> = [];
  if (filters.status) activeFilterChips.push({ key: "status", label: `Estado: ${issueStatusBadge(filters.status).label}` });
  if (filters.severity) activeFilterChips.push({ key: "severity", label: `Severidad: ${severityBadge(filters.severity).label}` });
  if (filters.ruleCode) {
    const ruleTitle = ruleOptions.find(r => r.rule_code === filters.ruleCode)?.title ?? filters.ruleCode;
    activeFilterChips.push({ key: "ruleCode", label: `Regla: ${ruleTitle}` });
  }
  if (filters.entityType) activeFilterChips.push({ key: "entityType", label: `Entidad: ${entityTypeLabel(filters.entityType)}` });
  if (filters.hasCase) activeFilterChips.push({ key: "hasCase", label: filters.hasCase === "yes" ? "Con caso asignado" : "Sin caso asignado" });
  if (filters.verification) activeFilterChips.push({ key: "verification", label: VERIFICATION_FILTER_LABELS[filters.verification] ?? filters.verification });
  if (filters.q) activeFilterChips.push({ key: "q", label: `Búsqueda: "${filters.q}"` });

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        quickAccess={
          <>
            {BANDEJA_STATUS_VALUES.map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={filters.status === option}
                onClick={() => setFilter("status", filters.status === option ? "" : option)}
                className="rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  borderColor: filters.status === option ? "var(--nx-accent-indigo)" : "var(--nx-border)",
                  color: filters.status === option ? "var(--nx-accent-indigo)" : "var(--nx-text-secondary)",
                  outlineColor: "var(--nx-focus-ring-color)"
                }}
              >
                {issueStatusBadge(option).label}
              </button>
            ))}
          </>
        }
        actions={
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
          >
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
        }
        chips={
          activeFilterChips.length > 0 ? (
            <>
              <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                Filtros aplicados:
              </span>
              {activeFilterChips.map(chip => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5 text-xs font-semibold"
                  style={{ background: "var(--nx-sidebar-bg)", color: "var(--nx-sidebar-text-primary)" }}
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={() => removeFilterChip(chip.key)}
                    aria-label={`Quitar filtro ${chip.label}`}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ color: "var(--nx-sidebar-text-secondary)", outlineColor: "var(--nx-focus-ring-color)" }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" onClick={clearAllFilters} className="text-xs underline" style={{ color: "var(--nx-text-secondary)" }}>
                Limpiar todos
              </button>
            </>
          ) : undefined
        }
      >
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: "var(--nx-text-secondary)" }}>Severidad</span>
          <select
            value={filters.severity ?? ""}
            onChange={event => setFilter("severity", event.target.value as BandejaUrlFilters["severity"])}
            className="rounded border px-2 py-1"
            style={{ borderColor: "var(--nx-border)" }}
          >
            <option value="">Todas</option>
            {BANDEJA_SEVERITY_VALUES.map(option => (
              <option key={option} value={option}>
                {severityBadge(option).label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: "var(--nx-text-secondary)" }}>Regla</span>
          <select
            value={filters.ruleCode ?? ""}
            onChange={event => setFilter("ruleCode", event.target.value)}
            className="rounded border px-2 py-1"
            style={{ borderColor: "var(--nx-border)" }}
          >
            <option value="">Todas</option>
            {ruleOptions.map(option => (
              <option key={option.rule_code} value={option.rule_code}>
                {option.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: "var(--nx-text-secondary)" }}>Entidad</span>
          <select
            value={filters.entityType ?? ""}
            onChange={event => setFilter("entityType", event.target.value)}
            className="rounded border px-2 py-1"
            style={{ borderColor: "var(--nx-border)" }}
          >
            <option value="">Todas</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: "var(--nx-text-secondary)" }}>Asignación</span>
          <select
            value={filters.hasCase ?? ""}
            onChange={event => setFilter("hasCase", event.target.value as BandejaUrlFilters["hasCase"])}
            className="rounded border px-2 py-1"
            style={{ borderColor: "var(--nx-border)" }}
          >
            <option value="">Todas</option>
            {BANDEJA_HAS_CASE_VALUES.map(option => (
              <option key={option} value={option}>
                {option === "yes" ? "Con caso asignado" : "Sin caso asignado"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: "var(--nx-text-secondary)" }}>Verificación</span>
          <select
            value={filters.verification ?? ""}
            onChange={event => setFilter("verification", event.target.value as BandejaUrlFilters["verification"])}
            className="rounded border px-2 py-1"
            style={{ borderColor: "var(--nx-border)" }}
          >
            <option value="">Todas</option>
            {BANDEJA_VERIFICATION_VALUES.map(option => (
              <option key={option} value={option}>
                {VERIFICATION_FILTER_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <form
          className="flex flex-col gap-1 text-xs"
          onSubmit={event => {
            event.preventDefault();
            setFilter("q", qDraft);
          }}
        >
          <span style={{ color: "var(--nx-text-secondary)" }}>Buscar por entidad</span>
          <input
            type="text"
            value={qDraft}
            onChange={event => setQDraft(event.target.value)}
            onBlur={() => setFilter("q", qDraft)}
            placeholder="ID de entidad…"
            className="rounded border px-2 py-1"
            style={{ borderColor: "var(--nx-border)" }}
          />
        </form>
      </FilterBar>

      {exportError && (
        <div role="alert" className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--nx-danger-fg, #c0392b)", color: "var(--nx-danger-fg, #c0392b)" }}>
          {exportError}
        </div>
      )}

      <ResponsiveTableShell
        title="Bandeja de incidencias"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage={hasActiveBandejaFilters(filters) ? "Sin incidencias para este filtro." : "Sin incidencias registradas."}
        maxHeight={520}
        footer={
          data && (
            <>
              <span>
                Página {data.page} de {data.totalPages}
              </span>
              <button
                type="button"
                onClick={() => pushState({ page: page - 1 }, false)}
                disabled={page <= 1}
                className="rounded border px-2"
                style={{ borderColor: "var(--nx-border)" }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => pushState({ page: page + 1 }, false)}
                disabled={page >= data.totalPages}
                className="rounded border px-2"
                style={{ borderColor: "var(--nx-border)" }}
              >
                ›
              </button>
            </>
          )
        }
      >
        {/* Tabla - solo escritorio/tablet ancho. En mobile una tabla de 7
            columnas se vuelve ilegible incluso con scroll horizontal (QA
            visual previo: solo 2 columnas visibles) - la alternativa de
            tarjetas de abajo es la vista real en mobile, no un fallback
            degradado. */}
        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr>
              <th className="text-left">Regla</th>
              <th className="text-left">Severidad</th>
              <th className="text-left">Estado</th>
              <th className="text-left">Entidad</th>
              <th className="text-left">Verificación</th>
              <th className="text-left">Última detección</th>
              <th className="text-left">Caso activo</th>
              <th className="text-left"></th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => {
              const vBadge = verificationBadge(row);
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelectedIssueId(row.id)}
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedIssueId(row.id);
                    }
                  }}
                >
                  <td>{row.rule_title}</td>
                  <td>
                    <StatusBadge {...severityBadge(row.severity)} size="sm" />
                  </td>
                  <td>
                    <StatusBadge {...issueStatusBadge(row.status)} size="sm" />
                  </td>
                  <td>
                    {entityTypeLabel(row.entity_type)}: {row.entity_key}
                  </td>
                  <td>{vBadge ? <StatusBadge {...vBadge} size="sm" /> : <span style={{ color: "var(--nx-text-secondary)" }}>-</span>}</td>
                  <td>{row.last_seen_at ? new Date(row.last_seen_at).toLocaleString("es-CL") : "-"}</td>
                  <td>
                    {row.active_review_case_id ? (
                      <span style={{ color: "var(--nx-text-secondary)" }}>Caso #{row.active_review_case_id}</span>
                    ) : (
                      <span style={{ color: "var(--nx-text-secondary)" }}>-</span>
                    )}
                  </td>
                  <td style={{ color: "var(--nx-accent-indigo)" }}>Ver detalle ›</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Tarjetas - vista real en mobile (< md), no una tabla comprimida. */}
        <div className="flex flex-col gap-2.5 md:hidden">
          {data?.rows.map(row => {
            const vBadge = verificationBadge(row);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedIssueId(row.id)}
                className="flex flex-col gap-2 rounded-[var(--nx-radius-card)] border p-3 text-left"
                style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                    {row.rule_title}
                  </span>
                  <StatusBadge {...issueStatusBadge(row.status)} size="sm" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge {...severityBadge(row.severity)} size="sm" />
                  {vBadge && <StatusBadge {...vBadge} size="sm" />}
                  {row.active_review_case_id && <StatusBadge label={`Caso #${row.active_review_case_id}`} tone="neutral" size="sm" />}
                </div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {entityTypeLabel(row.entity_type)}: {row.entity_key}
                </div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  Última detección: {row.last_seen_at ? new Date(row.last_seen_at).toLocaleString("es-CL") : "-"}
                </div>
              </button>
            );
          })}
        </div>
      </ResponsiveTableShell>

      <ExplorerDetailDrawer
        entity={selectedIssueId ? "issues" : null}
        entityKey={selectedIssueId}
        role={role}
        onClose={() => setSelectedIssueId(null)}
        onChanged={refetch}
      />
    </div>
  );
}
