"use client";

import { useEffect, useRef, useState } from "react";
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
import { readExplorerUrlState, buildExplorerQueryString, hasActiveExplorerFilters, deriveExplorerDrawerKeys, type ExplorerFilters } from "@/lib/explorer-url-state";
import { resolveLegacyContractClientFilter } from "@/lib/contract-client-filter";
import type { ExplorerFilterOption } from "@/lib/explorer-filters-config";
import type { TableDensity } from "@/components/ui/ResponsiveTableShell";
import type { ExplorerEntity, ExplorerListResponse, ExplorerLoadState } from "@/types/explorer";
import { hasCapability } from "@/lib/auth/capabilities-shared";
import { useDataRefreshEpoch } from "@/components/data-refresh/DataRefreshEpochProvider";

interface ExplorerShellProps {
  role: "gerencia" | "administracion";
  capabilities: string[];
}

// Explorador semántico (Gate B, B13/B20-B23) - navegación por entidad de
// negocio real, nunca por schema.tabla física. Composición recompuesta para
// fidelidad visual con la referencia (corrección obligatoria): header
// blanco propio, selector de entidad tipo píldora, tarjeta de resumen,
// tarjeta de filtros, barra de herramientas de tabla (búsqueda/columnas/
// densidad), tabla clara sin scroll interno dominante, footer con
// paginación real. Entidad/página/búsqueda/filtros viven en la URL (mismo
// idioma que AuditManualReviewShell/lib/audit-bandeja-url-state.ts).
export function ExplorerShell({ role, capabilities }: ExplorerShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { entity, page, q, filters, key: urlKey } = readExplorerUrlState(searchParams);
  const config = EXPLORER_ENTITY_CONFIG[entity];
  const epoch = useDataRefreshEpoch();

  // Sección 9 - contrato único de carga/error (types/explorer.ts). Nunca
  // tres booleans independientes (data/loading/error) que podían quedar en
  // combinaciones imposibles o ambiguas (ej. loading=true Y error!=null a
  // la vez) - un solo estado con forma discriminada por status.
  const [loadState, setLoadState] = useState<ExplorerLoadState>({ status: "idle" });
  // Sección 2/6 - protección por generación: una respuesta que ya no
  // corresponde a la última consulta disparada (por cambio de entidad,
  // filtro o página mientras esa respuesta seguía en vuelo) se descarta en
  // vez de pisar el estado con datos de forma equivocada (causa raíz real
  // del "Encountered two children with the same key, `undefined`" - ver
  // reporte final, sección A).
  const requestGenerationRef = useRef(0);
  // La clave del detalle abierto vive en la URL (ver lib/explorer-url-state.ts)
  // - nunca solo en useState local, para que un link "Ver equipo"/"Ver
  // cliente" desde el detalle de OTRA entidad navegue reemplazando el
  // contenido (URL canónica), en vez de apilar un segundo drawer sobre el
  // primero. Sección 14 del encargo NEXUS V3 After-Hours - reportDrawerId
  // (Reportes, usesExternalDrawer) YA NO es un useState local aparte:
  // colapsaba dos mecanismos de selección paralelos (uno por URL para las
  // otras 8 entidades, otro por estado local solo para Reportes) y hacía
  // que un deep-link ?entity=reports&key=<id> se ignorara en silencio (el
  // estado local siempre arrancaba en null). Ambos se derivan ahora del
  // MISMO valor de URL en cada render - reactivo a atrás/adelante del
  // navegador sin lógica adicional, gated únicamente por qué drawer usa
  // cada entidad.
  const { selectedKey, reportDrawerId } = deriveExplorerDrawerKeys(config.usesExternalDrawer ?? false, urlKey);
  const [technicianCorrectionTarget, setTechnicianCorrectionTarget] = useState<{ normalizedName: string; displayName: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [qDraft, setQDraft] = useState(q);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, ExplorerFilterOption[]>>({});

  // Columnas visibles/densidad - preferencia de sesión, no de URL (sección 7:
  // "persistir razonablemente durante la sesión"), por entidad, y nunca
  // revela una columna fuera del allowlist (solo alterna las marcadas
  // optional en EXPLORER_ENTITY_CONFIG).
  const [hiddenColumnsByEntity, setHiddenColumnsByEntity] = useState<Partial<Record<ExplorerEntity, Set<string>>>>({});
  const [density, setDensity] = useState<TableDensity>("comfortable");
  const hiddenColumns = hiddenColumnsByEntity[entity] ?? new Set<string>();
  const visibleColumns = config.listColumns.filter(c => !hiddenColumns.has(c.key));

  // Facets (sección 14: "carga únicamente las facets de la entidad activa,
  // nunca las 9 entidades al montar el Explorador") - antes pegaba
  // incondicionalmente a /api/dashboard/operacional/filters (endpoint
  // compartido del Dashboard, 7 queries no relacionadas) solo para leer
  // `.clientes`, sin importar la entidad activa ni si esa entidad siquiera
  // tenía un filtro de cliente. Ahora re-consulta solo cuando cambia la
  // entidad, scoped a lo que esa entidad realmente declara.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/explorer/${entity}/facets`)
      .then(res => res.json())
      .then((body: { facets?: Record<string, ExplorerFilterOption[]> }) => {
        if (!cancelled) setDynamicOptions(body.facets ?? {});
      })
      .catch(() => {
        if (!cancelled) setDynamicOptions({});
      });
    return () => {
      cancelled = true;
    };
  }, [entity]);

  // Migración de un `client` heredado en la URL de Contratos (Bloque 2
  // NEXUS V3) - solo corre para esa entidad, y solo una vez que el facet
  // contractClients ya llegó (dynamicOptions.contractClients !== undefined
  // - evita un falso "no disponible" mientras la request de facets sigue en
  // vuelo). MIGRATED reescribe la URL con router.replace (nunca push, para
  // no ensuciar el historial con una migración transparente) y se resuelve
  // solo: en el próximo render el valor ya es EXACT_MATCH. UNRESOLVED nunca
  // toca la URL -unresolvedContractClient dispara el mensaje distinguible
  // más abajo, en vez del panel genérico de cero resultados.
  const [unresolvedContractClient, setUnresolvedContractClient] = useState(false);
  useEffect(() => {
    if (entity !== "contracts" || !filters.client || !dynamicOptions.contractClients) {
      setUnresolvedContractClient(false);
      return;
    }
    const resolution = resolveLegacyContractClientFilter(filters.client, dynamicOptions.contractClients);
    if (resolution.kind === "EXACT_MATCH") {
      setUnresolvedContractClient(false);
    } else if (resolution.kind === "MIGRATED") {
      setUnresolvedContractClient(false);
      pushState({ filters: { ...filters, client: resolution.value } }, { replace: true });
    } else {
      setUnresolvedContractClient(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, filters.client, dynamicOptions.contractClients]);

  useEffect(() => {
    setQDraft(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, q]);

  // Corrección aplicada (Sección 14 del encargo NEXUS V3 After-Hours) -
  // `replace` opcional (default push, comportamiento sin cambios para
  // entidad/filtros/página, que SÍ son navegación real que el usuario
  // puede querer deshacer con "atrás"). La selección de fila (abrir/cerrar
  // el drawer, cambiar solo `key`) pasa replace:true - antes, cada clic de
  // fila apilaba una entrada de historial nueva; con varias filas visitadas
  // "atrás" tenía que pasar fila por fila antes de salir del Explorador.
  function pushState(patch: Partial<{ entity: ExplorerEntity; page: number; q: string; filters: ExplorerFilters; key: string | undefined }>, options?: { replace?: boolean }) {
    const next = { entity, page, q, filters, key: urlKey, ...patch };
    const qs = buildExplorerQueryString(next);
    const href = qs ? `${pathname}?${qs}` : pathname;
    if (options?.replace) {
      router.replace(href, { scroll: false });
    } else {
      router.push(href, { scroll: false });
    }
  }

  function handleEntityChange(next: ExplorerEntity) {
    // Sección 6 - reseleccionar la entidad YA activa (doble clic incluido)
    // es idempotente: no cambia datos, no limpia filtros, no vacía rows, no
    // dispara una transición inválida. Sin este guard, buildExplorerQueryString
    // produce la MISMA URL (los valores por defecto se omiten), router.push
    // se vuelve un no-op, y el useEffect de refetch (que depende de esos
    // mismos valores) nunca vuelve a dispararse - data quedaba en null para
    // siempre (causa raíz real de "Sin X para mostrar" tras un clic
    // repetido - ver reporte final, sección E).
    if (next === entity) return;
    // Cambiar de entidad SÍ debe mostrar un loading vacío a propósito (a
    // diferencia de un refetch dentro de la MISMA entidad, que conserva los
    // resultados anteriores - ver refetch() más abajo): las filas de la
    // entidad anterior tienen columnas/identidad distintas, mostrarlas un
    // instante contra la config de la entidad nueva es exactamente lo que
    // producía "undefined" como key de React.
    setLoadState({ status: "loading", previousData: null });
    // Cambiar de entidad con un drawer abierto dejaba selectedKey/reportDrawerId
    // de la entidad ANTERIOR con vida - un click posterior podía reabrir
    // ExplorerDetailDrawer con la entidad nueva pero la clave vieja (B22:
    // ningún drawer debe sobrevivir a un cambio de universo de navegación).
    // Ahora basta con limpiar `key` en la URL (activeKey/reportDrawerId/
    // selectedKey se derivan de ahí, ya no hay un useState aparte que limpiar).
    pushState({ entity: next, page: 1, q: "", filters: {}, key: undefined });
  }

  // Navegación cruzada entre entidades ("Ver equipo"/"Ver cliente"/"Ver
  // contrato" desde el detalle de OTRA entidad, ej. Contrato -> Equipo) -
  // SIEMPRE vía URL canónica (cambia entity+key juntos), nunca apilando un
  // segundo drawer sobre el que ya está abierto.
  function navigateToDetail(nextEntity: ExplorerEntity, nextKey: string) {
    setLoadState({ status: "loading", previousData: null });
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

  // `signal` es opcional (AbortController) - callers automáticos (el efecto
  // de abajo) lo pasan para cancelar la request en vuelo si entity/page/q/
  // filtros/epoch cambian antes de que responda; callers manuales (drawer
  // onChanged/onApplied) lo omiten, no participan de esa carrera. La
  // protección REAL contra una respuesta fuera de orden es el contador de
  // generación (requestGenerationRef) - AbortController es una optimización
  // de red complementaria, nunca la única defensa (sección 6 del encargo:
  // "no dependas solamente de él").
  function refetch(signal?: AbortSignal) {
    const generation = ++requestGenerationRef.current;
    setLoadState(prev => ({
      status: "loading",
      previousData: prev.status === "success" || prev.status === "empty" ? prev.data : prev.status === "loading" ? prev.previousData : null
    }));
    const params = buildFetchParams();
    params.set("page", String(page));
    params.set("pageSize", "25");
    fetch(`/api/explorer/${entity}?${params.toString()}`, { signal })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        if (generation !== requestGenerationRef.current) return; // respuesta obsoleta - se descarta sin tocar el estado
        const listResponse = body as ExplorerListResponse;
        setLoadState(listResponse.rows.length === 0 ? { status: "empty", data: listResponse } : { status: "success", data: listResponse });
      })
      .catch((body: unknown) => {
        if (body instanceof DOMException && body.name === "AbortError") return; // abort esperado, nunca un error visible
        if (generation !== requestGenerationRef.current) return;
        const err = body as { error?: string; requestId?: string } | undefined;
        setLoadState({ status: "error", message: err?.error ?? "Error desconocido", requestId: err?.requestId });
      });
  }

  // Dependencia serializada (nunca listar cada filtro a mano, sección 14) -
  // buildFetchParams() ya es genérico sobre TODOS los filtros declarados;
  // esta era la única dependencia hardcodeada del Explorador - listar cada
  // clave nueva acá manualmente rompería silenciosamente el refetch de
  // cualquier filtro agregado después sin tocar esta línea.
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    const controller = new AbortController();
    refetch(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, page, q, filtersKey, epoch]);

  const effectiveData: ExplorerListResponse | null =
    loadState.status === "success" || loadState.status === "empty" ? loadState.data : loadState.status === "loading" ? loadState.previousData : null;

  function getRowKey(row: Record<string, unknown>): string {
    return String(row[config.detailKeyColumn]);
  }

  function isRowSelected(row: Record<string, unknown>): boolean {
    const key = getRowKey(row);
    return config.usesExternalDrawer ? reportDrawerId === key : selectedKey === key;
  }

  // Corrección aplicada (Sección 14 del encargo NEXUS V3 After-Hours) - ya
  // no bifurca por usesExternalDrawer (las 9 entidades comparten el mismo
  // mecanismo de `key` en la URL, ver activeKey arriba); replace:true
  // porque seleccionar una fila nunca debe apilar una entrada de historial
  // nueva.
  function handleRowClick(row: Record<string, unknown>) {
    pushState({ key: getRowKey(row) }, { replace: true });
  }

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
          totalRows={effectiveData?.totalRows}
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

          {loadState.status === "error" ? (
            // Sección 9 - una caída de base de datos nunca se representa
            // como "Sin X para mostrar" (eso implicaría, falsamente, que la
            // consulta funcionó y el universo real está vacío). Mensaje
            // distinto + acción de recuperación real, sin reiniciar nada.
            <div role="alert" className="px-4 py-8 text-center text-sm" style={{ color: "var(--nx-danger-fg, #c0392b)" }}>
              <p>No fue posible cargar {config.label.toLowerCase()}.</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--nx-danger-fg, #c0392b)", color: "var(--nx-danger-fg, #c0392b)" }}
              >
                Reintentar
              </button>
              {loadState.requestId && (
                <p className="mt-1.5 text-xs" style={{ color: "var(--nx-text-muted)" }}>
                  ID de referencia: {loadState.requestId}
                </p>
              )}
            </div>
          ) : !effectiveData ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--nx-text-secondary)" }} aria-busy="true">
              Cargando…
            </p>
          ) : effectiveData.rows.length === 0 && unresolvedContractClient ? (
            // Bloque 2 NEXUS V3 - un client= de un enlace viejo que no
            // resolvió contra el facet actual (ver el efecto de migración
            // arriba) nunca se presenta como el panel genérico de cero
            // resultados - el usuario no eligió un cliente sin contratos,
            // el enlace quedó apuntando a un valor que ya no existe.
            <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              <p>El cliente del enlace ya no está disponible en el listado actual.</p>
              <button
                type="button"
                onClick={() => handleFilterChange("client", "")}
                className="mt-2.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--nx-border)", color: "var(--nx-accent-indigo)" }}
              >
                Limpiar filtro de cliente
              </button>
            </div>
          ) : effectiveData.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              {q || activeFilterCount > 0 ? `Sin resultados para este filtro.` : `Sin ${config.label.toLowerCase()} para mostrar.`}
            </p>
          ) : (
            <>
              {/* Tabla clara - sin panel oscuro, sin scroll interno
                  dominante (sección 9): altura natural, scroll de página
                  normal. Solo escritorio/tablet ancho; mobile usa tarjetas
                  (abajo). aria-busy cuando hay un refetch en vuelo pero
                  todavía se muestran resultados anteriores (nunca se
                  blanquea la tabla solo por estar recargando la MISMA
                  entidad). */}
              <div className="hidden md:block overflow-x-auto" aria-busy={loadState.status === "loading"}>
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
                    {effectiveData.rows.map(row => {
                      const selected = isRowSelected(row);
                      return (
                        <tr
                          key={getRowKey(row)}
                          onClick={() => handleRowClick(row)}
                          aria-selected={selected}
                          data-selected={selected || undefined}
                          className="cursor-pointer border-t transition-colors hover:bg-[var(--nx-page-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
                          style={{
                            borderColor: "var(--nx-border)",
                            outlineColor: "var(--nx-focus-ring-color)",
                            ...(selected
                              ? { background: "var(--nx-row-selected-bg)", boxShadow: "inset 3px 0 0 var(--nx-row-selected-border)" }
                              : undefined)
                          }}
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
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas - vista real en mobile (< md). */}
              <div className="flex flex-col gap-2.5 p-3 md:hidden" aria-busy={loadState.status === "loading"}>
                {effectiveData.rows.map(row => {
                  const selected = isRowSelected(row);
                  return (
                    <button
                      key={getRowKey(row)}
                      type="button"
                      onClick={() => handleRowClick(row)}
                      aria-pressed={selected}
                      data-selected={selected || undefined}
                      className="flex flex-col gap-1 rounded-[var(--nx-radius-card)] border p-3 text-left"
                      style={{
                        borderColor: selected ? "var(--nx-row-selected-border)" : "var(--nx-border)",
                        background: selected ? "var(--nx-row-selected-bg)" : "var(--nx-card-bg)"
                      }}
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
                  );
                })}
              </div>
            </>
          )}

          {effectiveData && (
            <ExplorerTableFooter
              page={effectiveData.page}
              totalPages={effectiveData.totalPages}
              pageSize={effectiveData.pageSize}
              onPageChange={next => pushState({ page: next })}
              contextLabel={selectedKey || reportDrawerId ? "Selecciona otra fila para ver su detalle" : "Selecciona una fila para ver el detalle"}
            />
          )}
        </div>
      </div>

      {config.usesExternalDrawer ? (
        <FieldbeatReportDetailDrawer reportId={reportDrawerId} onClose={() => pushState({ key: undefined }, { replace: true })} role={role} capabilities={capabilities} />
      ) : (
        <ExplorerDetailDrawer
          entity={selectedKey ? entity : null}
          entityKey={selectedKey}
          role={role}
          capabilities={capabilities}
          onClose={() => pushState({ key: undefined }, { replace: true })}
          onChanged={refetch}
          onNavigate={navigateToDetail}
          resolveIdentityAction={
            entity === "technicians" && hasCapability(capabilities, "correction:technician-identity")
              ? (summary: Record<string, unknown>) => {
                  pushState({ key: undefined }, { replace: true });
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
