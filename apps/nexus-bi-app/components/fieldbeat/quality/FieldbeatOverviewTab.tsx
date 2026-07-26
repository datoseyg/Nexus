"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import { viewKpi1, viewKpi2, viewKpi3, viewKpi4, viewKpi5, viewKpi6 } from "@/lib/fieldbeat-quality-kpi-view";
import { isOverviewEmpty } from "@/lib/fieldbeat-tab-empty-predicates";
import type { EvolutionSeriesKey } from "@/lib/fieldbeat-tabs-url-state";
import type { FieldbeatHeaderMeta } from "@/lib/fieldbeat-header-meta";
import type { FieldbeatOverviewResponse } from "@/types/fieldbeat-quality";
import { FieldbeatQualityKpiCard } from "./FieldbeatQualityKpiCard";
import { FieldbeatEvolutionChart } from "./FieldbeatEvolutionChart";

interface FieldbeatOverviewTabProps {
  query: string;
  evolutionSeries: EvolutionSeriesKey;
  onEvolutionSeriesChange: (series: EvolutionSeriesKey) => void;
  onDrillDown: (patch: Record<string, string>) => void;
  onMeta?: (meta: FieldbeatHeaderMeta) => void;
}

// Visión ejecutiva (Phase 3 §7) - único consumidor de GET /overview (1
// round-trip, ver lib/fieldbeat-quality-queries.ts). Nunca precarga
// quality/crossings/reports.
export function FieldbeatOverviewTab({ query, evolutionSeries, onEvolutionSeriesChange, onDrillDown, onMeta }: FieldbeatOverviewTabProps) {
  const { status, data, error, retry } = useAfterHoursSection<FieldbeatOverviewResponse>("/api/dashboard/fieldbeat/overview", query, isOverviewEmpty);

  useEffect(() => {
    if (data) onMeta?.({ generatedAt: data.meta.generatedAt, effectiveDateFrom: data.meta.effectiveDateFrom, effectiveDateTo: data.meta.effectiveDateTo, totalReports: data.kpi1.denominator });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const loading = status === "idle" || status === "loading";
  const isError = status === "error";
  const liveRegionMessage =
    status === "loading" || status === "refreshing"
      ? "Cargando Visión ejecutiva…"
      : status === "error"
        ? `Error: ${error ?? "no fue posible cargar la Visión ejecutiva."}`
        : status === "empty"
          ? "Sin reportes evaluables para el filtro actual."
          : "";

  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <ErrorBanner message={error ?? "No fue posible cargar la Visión ejecutiva."} />
        <button
          type="button"
          onClick={retry}
          className="rounded-[var(--nx-radius-chip)] px-3.5 py-1.5 text-[13px] font-semibold"
          style={{ background: "var(--nx-accent-indigo)", color: "#fff" }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  const cards = data
    ? [viewKpi1(data.kpi1), viewKpi2(data.kpi2), viewKpi3(data.kpi3), viewKpi4(data.kpi4), viewKpi5(data.kpi5), viewKpi6(data.kpi6)]
    : [];

  const distributionByCode = data?.kpi6.distributionByCode ?? [];
  const topCauses = distributionByCode.slice(0, 6);

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="sr-only">
        {liveRegionMessage}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(loading ? Array.from({ length: 6 }) : cards).map((view, index) => (
          <FieldbeatQualityKpiCard
            key={data ? cards[index]?.id : index}
            view={loading ? null : (view as ReturnType<typeof viewKpi1>)}
            loading={loading}
            onDrillDown={data ? () => onDrillDown({ tab: "reports" }) : undefined}
          />
        ))}
      </div>

      {status === "empty" && (
        <EmptyState title="Sin reportes evaluables" description="No hay reportes FieldBeat que coincidan con los filtros actuales." />
      )}

      {data && status !== "empty" && (
        <>
          <FieldbeatEvolutionChart points={data.evolution} selected={evolutionSeries} onSelectedChange={onEvolutionSeriesChange} loading={loading} />

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            <section
              aria-labelledby="fieldbeat-causes-heading"
              className="rounded-[var(--nx-radius-card)] p-4"
              style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
            >
              <h3 id="fieldbeat-causes-heading" className="mb-2.5 text-[13px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
                Principales causas de inconsistencias
              </h3>
              {topCauses.length === 0 ? (
                <p className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
                  No hay inconsistencias registradas para el filtro actual.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {topCauses.map(cause => (
                    <li key={cause.code} className="flex items-center justify-between gap-2 text-[13px]">
                      <span style={{ color: "var(--nx-text-secondary)" }}>
                        {cause.code} <span style={{ color: "var(--nx-text-muted)" }}>({cause.severity})</span>
                      </span>
                      <span className="font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                        {cause.reportCount.toLocaleString("es-CL")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="fieldbeat-concentration-heading"
              className="rounded-[var(--nx-radius-card)] p-4"
              style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
            >
              <h3 id="fieldbeat-concentration-heading" className="mb-2.5 text-[13px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
                Concentración de problemas
              </h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                <dt style={{ color: "var(--nx-text-muted)" }}>Código dominante</dt>
                <dd className="text-right font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  {data.kpi6.dominantCode ?? "-"}
                </dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Severidad Alta</dt>
                <dd className="text-right font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  {data.kpi6.highSeverityReports.toLocaleString("es-CL")}
                </dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Problemas secundarios</dt>
                <dd className="text-right font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  {data.kpi6.totalSecondaryIssues.toLocaleString("es-CL")}
                </dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Caso afectado más antiguo</dt>
                <dd className="text-right font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  {data.kpi6.oldestAffectedReportDate ? new Date(data.kpi6.oldestAffectedReportDate).toLocaleDateString("es-CL") : "-"}
                </dd>
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
