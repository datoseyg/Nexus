"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FieldbeatReportDetailDrawer } from "@/components/fieldbeat/quality/FieldbeatReportDetailDrawer";
import { ExplorerDetailDrawer } from "./ExplorerDetailDrawer";
import { TechnicianIdentityCorrectionDrawer } from "./TechnicianIdentityCorrectionDrawer";
import { ExplorerEntityTabs } from "./ExplorerEntityTabs";
import { ExplorerEntitySummary } from "./ExplorerEntitySummary";
import { ExplorerFilterPanel } from "./ExplorerFilterPanel";
import { ExplorerTableToolbar } from "./ExplorerTableToolbar";
import { ExplorerTableFooter } from "./ExplorerTableFooter";
import { EXPLORER_ENTITY_CONFIG, formatCell } from "@/lib/explorer-entity-config";
import { triggerBlobDownload } from "@/lib/csv-export";
import { readExplorerUrlState, buildExplorerQueryString, hasActiveExplorerFilters, type ExplorerFilters } from "@/lib/explorer-url-state";
import type { TableDensity } from "@/components/ui/ResponsiveTableShell";
import type { ExplorerEntity, ExplorerListResponse } from "@/types/explorer";

interface ExplorerShellProps {
  role: "gerencia" | "administracion";
}

// Explorador semántico (Gate B, B13/B20-B23) - navegación por entidad de
// negocio real, nunca por schema.tabla física. Composición recompuesta para
// fidelidad visual con la referencia (corrección obligatoria): header
// blanco propio, selector de entidad tipo píldora, tarjeta de resumen,
// tarjeta de filtros, barra de herramientas de tabla (búsqueda/columnas/
// densidad), tabla clara sin scroll interno dominante, footer con
// paginación real. Entidad/página/búsqueda/filtros viven en la URL (mismo
// idioma que AuditManualReviewShell/lib/audit-bandeja-url-state.ts).
export function ExplorerShell({ role }: ExplorerShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { entity, page, q, filters, key: urlKey } = readExplorerUrlState(searchParams);
  const config = EXPLORER_ENTITY_CONFIG[entity];

  const [data, setData] = useState<ExplorerListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // La clave del detalle abierto vive en la URL (ver lib/explorer-url-state.ts)
  // - nunca solo en useState local, para que un link "Ver equipo"/"Ver
  // cliente" desde el detalle de OTRA entidad navegue reemplazando el
  // contenido (URL canónica), en vez de apilar un segundo drawer sobre el
  // primero. reportDrawerId (Reportes, usesExternalDrawer) sigue local: ese
  // drawer nunca se enlaza desde otra entidad hoy.
  const selectedKey = config.usesExternalDrawer ? null : (urlKey ?? null);
  const [reportDrawerId, setReportDrawerId] = useState<string | null>(null);
  const [technicianCorrectionTarget, setTechnicianCorrectionTarget] = useState<{ normalizedName: string; displayName: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [qDraft, setQDraft] = useState(q);
  const [helpOpen, setHelpOpen] = useState(false);
  const [clientes, setClientes] = useState<string[]>([]);

  // Columnas visibles/densidad - preferencia de sesión, no de URL (sección 7:
  // "persistir razonablemente durante la sesión"), por entidad, y nunca
  // revela una columna fuera del allowlist (solo alterna las marcadas
  // optional en EXPLORER_ENTITY_CONFIG).
  const [hiddenColumnsByEntity, setHiddenColumnsByEntity] = useState<Partial<Record<ExplorerEntity, Set<string>>>>({});
  const [density, setDensity] = useState<TableDensity>("comfortable");
  const hiddenColumns = hiddenColumnsByEntity[entity] ?? new Set<string>();
  const visibleColumns = config.listColumns.filter(c => !hiddenColumns.has(c.key));

  useEffect(() => {
    fetch("/api/dashboard/operacional/filters")
      .then(res => res.json())
      .then(body => setClientes(body.clientes ?? []))
      .catch(() => setClientes([]));
  }, []);

  useEffect(() => {
    setQDraft(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, q]);

  function pushState(patch: Partial<{ entity: ExplorerEntity; page: number; q: string; filters: ExplorerFilters; key: string | undefined }>) {
    const next = { entity, page, q, filters, key: urlKey, ...patch };
    const qs = buildExplorerQueryString(next);
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function handleEntityChange(next: ExplorerEntity) {
    setData(null);
    // Cambiar de entidad con un drawer abierto dejaba selectedKey/reportDrawerId
    // de la entidad ANTERIOR con vida - un click posterior podía reabrir
    // ExplorerDetailDrawer con la entidad nueva pero la clave vieja (B22:
    // ningún drawer debe sobrevivir a un cambio de universo de navegación).
    setReportDrawerId(null);
    pushState({ entity: next, page: 1, q: "", filters: {}, key: undefined });
  }

  // Navegación cruzada entre entidades ("Ver equipo"/"Ver cliente"/"Ver
  // contrato" desde el detalle de OTRA entidad, ej. Contrato -> Equipo) -
  // SIEMPRE vía URL canónica (cambia entity+key juntos), nunca apilando un
  // segundo drawer sobre el que ya está abierto.
  function navigateToDetail(nextEntity: ExplorerEntity, nextKey: string) {
    setData(null);
    setReportDrawerId(null);
    pushState({ entity: nextEntity, page: 1, q: "", filters: {}, key: nextKey });
  }

  function handleFilterChange(key: keyof ExplorerFilters, value: string) {
    pushState({ filters: { ...filters, [key]: value || undefined }, page: 1 });
  }

  function handleClearFilters() {
    setQDraft("");
    pushState({ q: "", filters: {}, page: 1 });
  }

  function toggleColumn(key: string) {
    setHiddenColumnsByEntity(prev => {
      const current = new Set(prev[entity] ?? []);
      if (current.has(key)) current.delete(key);
      else current.add(key);
      return { ...prev, [entity]: current };
    });
  }

  // Gate B - Familia 7: exportación server-side de la entidad activa
  // (universo completo hasta MAX_EXPORT_ROWS, no solo la página cargada),
  // respetando los mismos filtros/búsqueda de la vista actual.
  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const params = buildFetchParams();
      const res = await fetch(`/api/explorer/${entity}/export?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setExportError(body?.error ?? `No fue posible exportar (HTTP ${res.status}).`);
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] ?? `nexus-explorador-${entity}.csv`;
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
    } catch {
      setExportError("No fue posible exportar - revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  function buildFetchParams() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    return params;
  }

  function refetch() {
    setLoading(true);
    setError(null);
    const params = buildFetchParams();
    params.set("page", String(page));
    params.set("pageSize", "25");
    fetch(`/api/explorer/${entity}?${params.toString()}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }

  useEffect(refetch, [entity, page, q, filters.client, filters.taskType, filters.dateFrom, filters.dateTo, filters.severity, filters.status, filters.entityType]);

  function handleRowClick(row: Record<string, unknown>) {
    const key = String(row[config.detailKeyColumn]);
    if (config.usesExternalDrawer) {
      setReportDrawerId(key);
    } else {
      pushState({ key });
    }
  }

  const dynamicOptions = useMemo(() => ({ clientes, taskTypes: data?.facets?.taskTypes ?? [] }), [clientes, data?.facets?.taskTypes]);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header blanco propio - franja separada del contenido, sin el texto
          técnico "cada entidad usa una consulta curada" como subtítulo
          permanente (sección 3: eso vive en la ayuda contextual). */}
      <div className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: "var(--nx-text-primary)" }}>
              Explorador de datos
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              Consulta entidades de negocio, aplica filtros y navega sus relaciones.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHelpOpen(v => !v)}
            aria-expanded={helpOpen}
            className="rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-accent-indigo)" }}
          >
            {helpOpen ? "Ocultar detalle" : "Qué incluye esta vista"}
          </button>
        </div>
        {helpOpen && (
          <div className="mt-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
            Clientes, equipos, técnicos, reportes, tickets, repuestos declarados, productos de catálogo, contratos e incidencias - cada entidad usa una
            consulta curada propia (nunca una tabla física completa) y comparte el mismo detalle canónico usado en el resto de Nexus.
          </div>
        )}
      </div>

      <ExplorerEntityTabs entity={entity} onChange={handleEntityChange} />

      <div role="tabpanel" id="explorer-tabpanel" aria-labelledby={`explorer-tab-${entity}`} className="flex flex-col gap-4">
        <ExplorerEntitySummary
          title={config.label}
          description={config.description}
          totalRows={data?.totalRows}
          activeFilterCount={activeFilterCount}
          onExport={handleExport}
          exporting={exporting}
        />

        <ExplorerFilterPanel
          entity={entity}
          filters={filters}
          onChange={handleFilterChange}
          onClear={handleClearFilters}
          hasActiveFilters={hasActiveExplorerFilters({ q, filters })}
          dynamicOptions={dynamicOptions}
        />

        {exportError && (
          <div role="alert" className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--nx-danger-fg, #c0392b)", color: "var(--nx-danger-fg, #c0392b)" }}>
            {exportError}
          </div>
        )}

        <div className="rounded-[var(--nx-radius-card)] overflow-hidden" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
          <ExplorerTableToolbar
            query={qDraft}
            onQueryChange={setQDraft}
            onQueryCommit={() => pushState({ q: qDraft, page: 1 })}
            columns={config.listColumns}
            hiddenColumns={hiddenColumns}
            onToggleColumn={toggleColumn}
            density={density}
            onDensityChange={setDensity}
          />

          {loading ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              Cargando…
            </p>
          ) : error ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--nx-danger-fg, #c0392b)" }}>
              {error}
            </p>
          ) : (data?.rows.length ?? 0) === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              {q || activeFilterCount > 0 ? `Sin resultados para este filtro.` : `Sin ${config.label.toLowerCase()} para mostrar.`}
            </p>
          ) : (
            <>
              {/* Tabla clara - sin panel oscuro, sin scroll interno
                  dominante (sección 9): altura natural, scroll de página
                  normal. Solo escritorio/tablet ancho; mobile usa tarjetas
                  (abajo). */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--nx-page-bg)" }}>
                      {visibleColumns.map(col => (
                        <th
                          key={col.key}
                          className={`text-left font-semibold ${density === "compact" ? "px-3 py-1.5" : "px-4 py-2.5"}`}
                          style={{ color: "var(--nx-text-secondary)" }}
                        >
                          {col.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data?.rows.map((row, idx) => (
                      <tr
                        key={idx}
                        onClick={() => handleRowClick(row)}
                        className="cursor-pointer border-t transition-colors hover:bg-[var(--nx-page-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
                        style={{ borderColor: "var(--nx-border)", outlineColor: "var(--nx-focus-ring-color)" }}
                        tabIndex={0}
                        onKeyDown={event => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleRowClick(row);
                          }
                        }}
                      >
                        {visibleColumns.map(col => (
                          <td key={col.key} className={density === "compact" ? "px-3 py-1.5" : "px-4 py-2.5"} style={{ color: "var(--nx-text-primary)" }}>
                            {formatCell(col, row)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas - vista real en mobile (< md). */}
              <div className="flex flex-col gap-2.5 p-3 md:hidden">
                {data?.rows.map((row, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleRowClick(row)}
                    className="flex flex-col gap-1 rounded-[var(--nx-radius-card)] border p-3 text-left"
                    style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}
                  >
                    {visibleColumns.map((col, colIdx) => (
                      <div key={col.key} className="flex items-baseline justify-between gap-2 text-xs">
                        <span style={{ color: "var(--nx-text-secondary)" }}>{col.header}</span>
                        <span className={colIdx === 0 ? "text-sm font-semibold" : ""} style={{ color: "var(--nx-text-primary)" }}>
                          {formatCell(col, row)}
                        </span>
                      </div>
                    ))}
                  </button>
                ))}
              </div>
            </>
          )}

          {data && (
            <ExplorerTableFooter
              page={data.page}
              totalPages={data.totalPages}
              pageSize={data.pageSize}
              onPageChange={next => pushState({ page: next })}
              contextLabel={selectedKey || reportDrawerId ? "Selecciona otra fila para ver su detalle" : "Selecciona una fila para ver el detalle"}
            />
          )}
        </div>
      </div>

      {config.usesExternalDrawer ? (
        <FieldbeatReportDetailDrawer reportId={reportDrawerId} onClose={() => setReportDrawerId(null)} role={role} />
      ) : (
        <ExplorerDetailDrawer
          entity={selectedKey ? entity : null}
          entityKey={selectedKey}
          role={role}
          onClose={() => pushState({ key: undefined })}
          onChanged={refetch}
          onNavigate={navigateToDetail}
          resolveIdentityAction={
            entity === "technicians" && role === "administracion"
              ? (summary: Record<string, unknown>) => {
                  pushState({ key: undefined });
                  setTechnicianCorrectionTarget({
                    normalizedName: String(summary.normalized_name),
                    displayName: (summary.display_name as string | null) ?? null
                  });
                }
              : undefined
          }
        />
      )}

      <TechnicianIdentityCorrectionDrawer
        open={technicianCorrectionTarget !== null}
        normalizedName={technicianCorrectionTarget?.normalizedName ?? null}
        currentDisplayName={technicianCorrectionTarget?.displayName ?? null}
        onClose={() => setTechnicianCorrectionTarget(null)}
        onApplied={refetch}
      />
    </div>
  );
}
