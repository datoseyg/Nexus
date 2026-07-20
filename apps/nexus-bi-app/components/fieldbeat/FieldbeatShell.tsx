"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useFieldbeatDashboard } from "@/lib/use-fieldbeat-dashboard";
import { evaluateFieldbeatPageStatus } from "@/lib/fieldbeat-page-status";
import { buildExecutiveSummary, buildPartsPresence, buildTicketLinkage } from "@/lib/fieldbeat-metrics";
import { toClientReportRankingRows, toEquipmentPartsRankingRows } from "@/lib/fieldbeat-ranking-view";
import { FIELDBEAT_UNAVAILABLE_SECTIONS } from "@/lib/fieldbeat-unavailable-sections";
import { FieldbeatHeader } from "./FieldbeatHeader";
import { FieldbeatAvailabilityBanner } from "./FieldbeatAvailabilityBanner";
import { FieldbeatDisabledFilters } from "./FieldbeatDisabledFilters";
import { FieldbeatExecutiveSummary } from "./FieldbeatExecutiveSummary";
import { FieldbeatUnavailablePlaceholder } from "./FieldbeatUnavailablePlaceholder";
import { FieldbeatClientEquipmentRankings } from "./FieldbeatClientEquipmentRankings";
import { FieldbeatDataQuality } from "./FieldbeatDataQuality";
import { FieldbeatSupportAndPartsSummary } from "./FieldbeatSupportAndPartsSummary";
import { FieldbeatUnavailableDetailTable } from "./FieldbeatUnavailableDetailTable";

// ETAPA 5-V - bridge de tema claro LOCAL a este árbol, mismo patrón ya
// probado en DashboardShell.tsx/AfterHoursShell.tsx (SHELL_STYLE): los
// componentes mandatorios reutilizados en esta pantalla (PageHeader,
// MetricCard si se usara, SectionCard, ErrorBanner, EmptyState) y el
// propio <body> consumen la familia de tokens legacy --eyg-*/--text-*/
// --surface-1/--page-plane, que SÍ tiene una variante real
// @media (prefers-color-scheme: dark) en globals.css (ROOT_CAUSE_DARK_THEME,
// investigado con systematic-debugging antes de este cambio). Sin este
// bridge, un visor con el SO/navegador en modo oscuro ve esos componentes
// oscuros mientras el resto (--nx-*, sin variante oscura) permanece claro.
// Valores literales = los mismos ya definidos en :root de globals.css (no
// inventados), idénticos a los que copia DashboardShell.tsx.
const FIELDBEAT_LIGHT_SCOPE_STYLE = {
  background: "var(--nx-page-bg)",
  "--eyg-card": "#ffffff",
  "--eyg-border": "#dde6e3",
  "--eyg-green-dark": "#3c8c2e",
  "--eyg-warning": "#f4b740",
  "--eyg-danger": "#d9534f",
  "--surface-1": "#ffffff",
  "--page-plane": "#f4f7f6",
  "--text-primary": "#243033",
  "--text-secondary": "#5e6b70",
  "--text-muted": "#8a9a95",
  "--gridline": "#dde6e3",
  "--axis": "#b7c9c3",
  "--border": "#dde6e3",
  "--series-1": "#3c8c2e",
  "--status-good": "#3c8c2e",
  "--status-warning": "#f4b740",
  "--status-serious": "#e08e3e",
  "--status-critical": "#d9534f"
} as React.CSSProperties;

const UNAVAILABLE_BY_KEY = new Map(FIELDBEAT_UNAVAILABLE_SECTIONS.map(s => [s.key, s]));

// ETAPA 5-V - orquestador de /dashboard/fieldbeat, recompuesto para seguir
// el orden EXACTO del mockup de referencia (docs/design-revolution/Nexus -
// Dashboard FieldBeat.dc.html): encabezado -> banner de alcance -> filtros
// deshabilitados -> resumen ejecutivo (6 posiciones fijas) -> evolución
// (no disponible) -> tipo de tarea (no disponible) -> clientes y máquinas
// -> cruce cliente×máquina (no disponible) -> cruce cliente×tipo de tarea
// (no disponible) -> calidad de datos -> vinculación con tickets +
// presencia de repuesto -> detalle (no disponible). El fetch/estado de
// página (useFieldbeatDashboard/evaluateFieldbeatPageStatus) no cambia
// respecto de ETAPA 5 - solo cambia la composición visual.
export function FieldbeatShell() {
  const { status, data, error, retry } = useFieldbeatDashboard();

  const isLoading = status === "idle" || status === "loading";
  const pageStatus = data ? evaluateFieldbeatPageStatus(data) : null;
  const showRealSections = !isLoading && data && (pageStatus === "success" || pageStatus === "partial_inconsistent");

  const executiveSummary = buildExecutiveSummary(data?.kpis ?? null);
  const evolution = UNAVAILABLE_BY_KEY.get("evolution")!;
  const taskType = UNAVAILABLE_BY_KEY.get("task_type")!;
  const clientEquipmentCross = UNAVAILABLE_BY_KEY.get("client_equipment_cross")!;
  const clientTaskTypeCross = UNAVAILABLE_BY_KEY.get("client_task_type_cross")!;

  return (
    <div className="overflow-hidden rounded-[var(--nx-radius-shell)]" style={FIELDBEAT_LIGHT_SCOPE_STYLE}>
      <FieldbeatHeader recentActivityReason="Información todavía no disponible" />

      <div className="flex flex-col gap-4 p-4 sm:p-7">
        <FieldbeatAvailabilityBanner />
        <FieldbeatDisabledFilters />

        {status === "error" ? (
          <div className="flex flex-col items-start gap-3">
            <ErrorBanner message={error ?? "No fue posible cargar la información de FieldBeat."} />
            <button
              type="button"
              onClick={retry}
              className="rounded-[var(--nx-radius-chip)] px-3.5 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
              style={{ background: "var(--nx-accent-indigo)", color: "#fff" }}
            >
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <div>
              <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
                Resumen ejecutivo
              </div>
              <FieldbeatExecutiveSummary summary={executiveSummary} loading={isLoading} />
            </div>

            {!isLoading && pageStatus === "empty" && <EmptyState title="No hay registros FieldBeat disponibles." />}
            {!isLoading && pageStatus === "zero_universe" && (
              <EmptyState title="El universo actual no tiene reportes registrados." description="La base de datos conectada no tiene actividad FieldBeat para mostrar." />
            )}
            {!isLoading && pageStatus === "partial_inconsistent" && (
              <EmptyState
                title="Respuesta con datos inconsistentes"
                description="El resumen general no coincide con la actividad encontrada en otras secciones - se muestra la información disponible a continuación."
              />
            )}

            <FieldbeatUnavailablePlaceholder title={evolution.title} subtitle={evolution.subtitle} reason={evolution.reason} />
            <FieldbeatUnavailablePlaceholder title={taskType.title} subtitle={taskType.subtitle} reason={taskType.reason} />

            {(isLoading || showRealSections) && (
              <FieldbeatClientEquipmentRankings
                clientRows={data ? toClientReportRankingRows(data.reportsByClient) : []}
                equipmentRows={data ? toEquipmentPartsRankingRows(data.topEquipmentByParts) : []}
                loading={isLoading}
              />
            )}

            <FieldbeatUnavailablePlaceholder title={clientEquipmentCross.title} subtitle={clientEquipmentCross.subtitle} reason={clientEquipmentCross.reason} />
            <FieldbeatUnavailablePlaceholder title={clientTaskTypeCross.title} subtitle={clientTaskTypeCross.subtitle} reason={clientTaskTypeCross.reason} />

            {(isLoading || showRealSections) && <FieldbeatDataQuality rows={data?.dataQuality ?? []} totalReports={data?.kpis?.total_fieldbeat_reports ?? 0} loading={isLoading} />}

            {!isLoading && data?.kpis && <FieldbeatSupportAndPartsSummary linkage={buildTicketLinkage(data.kpis)} presence={buildPartsPresence(data.kpis)} />}

            <FieldbeatUnavailableDetailTable />
          </>
        )}
      </div>
    </div>
  );
}
