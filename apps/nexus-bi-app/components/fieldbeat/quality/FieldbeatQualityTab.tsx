"use client";

import { useEffect } from "react";
import { Line } from "react-chartjs-2";
import "@/lib/chartjs-setup";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { DASHBOARD_PALETTE } from "@/lib/dashboard-formatters";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import { viewKpi1, viewKpi2, viewKpi3, viewKpi4, viewKpi5 } from "@/lib/fieldbeat-quality-kpi-view";
import { isQualityEmpty } from "@/lib/fieldbeat-tab-empty-predicates";
import { periodLabel } from "@/lib/fieldbeat-period-label";
import type { FieldbeatHeaderMeta } from "@/lib/fieldbeat-header-meta";
import type { FieldbeatQualityResponse } from "@/types/fieldbeat-quality";
import { FieldbeatQualityKpiCard } from "./FieldbeatQualityKpiCard";

interface FieldbeatQualityTabProps {
  query: string;
  onMeta?: (meta: FieldbeatHeaderMeta) => void;
}

// Calidad y trazabilidad (Phase 3 §8) - único consumidor de GET /quality
// (1 round-trip). Nunca duplica KPI de forma ornamental: cada bloque
// muestra desglose que el KPI card ya resume, no el mismo número repetido.
export function FieldbeatQualityTab({ query, onMeta }: FieldbeatQualityTabProps) {
  const { status, data, error, retry } = useAfterHoursSection<FieldbeatQualityResponse>("/api/dashboard/fieldbeat/quality", query, isQualityEmpty);
  const loading = status === "idle" || status === "loading";

  useEffect(() => {
    if (data) onMeta?.({ generatedAt: data.meta.generatedAt, effectiveDateFrom: data.meta.effectiveDateFrom, effectiveDateTo: data.meta.effectiveDateTo, totalReports: data.kpi1.denominator });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <ErrorBanner message={error ?? "No fue posible cargar Calidad y trazabilidad."} />
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

  const cards = data ? [viewKpi1(data.kpi1), viewKpi2(data.kpi2), viewKpi3(data.kpi3), viewKpi4(data.kpi4), viewKpi5(data.kpi5)] : [];

  const labels = data?.teamEvolution.map(p => periodLabel(p.period)) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="sr-only">
        {loading ? "Cargando Calidad y trazabilidad…" : status === "empty" ? "Sin reportes evaluables para el filtro actual." : ""}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(loading ? Array.from({ length: 5 }) : cards).map((view, index) => (
          <FieldbeatQualityKpiCard key={data ? cards[index]?.id : index} view={loading ? null : (view as ReturnType<typeof viewKpi1>)} loading={loading} />
        ))}
      </div>

      {status === "empty" && <EmptyState title="Sin reportes evaluables" description="No hay reportes FieldBeat que coincidan con los filtros actuales." />}

      {data && status !== "empty" && (
        <>
          <div
            role="note"
            className="rounded-[var(--nx-radius-card)] p-3.5 text-[13px]"
            style={{ background: "var(--nx-warning-bg, var(--nx-page-bg))", color: "var(--nx-text-secondary)", border: "1px solid var(--nx-border)" }}
          >
            {data.historicalAliasLimitation}
            {data.kpi4.lineGrain.historicalAliasMatches === 0 && " (0 matches históricos hoy - la limitación, no una alarma del sistema)."}
          </div>

          <ChartCard
            title="Identificación de equipos - estructurado vs. texto"
            subtitle="Evolución mensual, universo cerrado."
            size="line"
            available={data.teamEvolution.length > 0}
            unavailableReason="Sin datos suficientes para graficar la evolución."
            accessibleData={{
              labels,
              values: data.teamEvolution.map(p => p.structured.percentage ?? 0),
              unitLabel: "meses",
              valueSuffix: "% estructurado"
            }}
          >
            <Line
              data={{
                labels,
                datasets: [
                  { label: "Estructurado", data: data.teamEvolution.map(p => p.structured.percentage ?? 0), borderColor: DASHBOARD_PALETTE.green, backgroundColor: "transparent", tension: 0.2, pointRadius: 2 },
                  { label: "Texto confiable", data: data.teamEvolution.map(p => p.textConfident.percentage ?? 0), borderColor: DASHBOARD_PALETTE.teal, backgroundColor: "transparent", tension: 0.2, pointRadius: 2 },
                  { label: "Ambiguo", data: data.teamEvolution.map(p => p.textAmbiguous.percentage ?? 0), borderColor: DASHBOARD_PALETTE.warning, backgroundColor: "transparent", tension: 0.2, pointRadius: 2 },
                  { label: "Ausente", data: data.teamEvolution.map(p => p.missing.percentage ?? 0), borderColor: DASHBOARD_PALETTE.danger, backgroundColor: "transparent", tension: 0.2, pointRadius: 2 }
                ]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } },
                scales: { y: { beginAtZero: true, max: 100, ticks: { font: { size: 12 }, callback: v => `${v}%` } }, x: { ticks: { font: { size: 12 } } } }
              }}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            <section className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
              <h3 className="mb-2.5 text-[13px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
                Repuestos - grano línea (nunca mezclado con grano reporte)
              </h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                <dt style={{ color: "var(--nx-text-muted)" }}>Total de líneas</dt>
                <dd className="text-right font-semibold">{data.kpi4.lineGrain.totalLines.toLocaleString("es-CL")}</dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Match directo</dt>
                <dd className="text-right font-semibold">{data.kpi4.lineGrain.directMatches.toLocaleString("es-CL")}</dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Alias histórico</dt>
                <dd className="text-right font-semibold">{data.kpi4.lineGrain.historicalAliasMatches.toLocaleString("es-CL")}</dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Sin match</dt>
                <dd className="text-right font-semibold">{data.kpi4.lineGrain.noMatch.toLocaleString("es-CL")}</dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Ambiguos</dt>
                <dd className="text-right font-semibold">{data.kpi4.lineGrain.ambiguous.toLocaleString("es-CL")}</dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Placeholder</dt>
                <dd className="text-right font-semibold">{data.kpi4.lineGrain.placeholders.toLocaleString("es-CL")}</dd>
              </dl>
            </section>

            <section className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
              <h3 className="mb-2.5 text-[13px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
                Consistencia temporal - advertencias separadas
              </h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                <dt style={{ color: "var(--nx-text-muted)" }}>Cronología imposible</dt>
                <dd className="text-right font-semibold" style={{ color: data.kpi5.impossibleChronology > 0 ? "var(--nx-danger-fg)" : undefined }}>
                  {data.kpi5.impossibleChronology.toLocaleString("es-CL")}
                </dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Duración = 0 (advertencia)</dt>
                <dd className="text-right font-semibold">{data.kpi5.zeroDurationWarnings.toLocaleString("es-CL")}</dd>
                <dt style={{ color: "var(--nx-text-muted)" }}>Duración sin registrar (advertencia)</dt>
                <dd className="text-right font-semibold">{data.kpi5.nullDurationWarnings.toLocaleString("es-CL")}</dd>
              </dl>
              <p className="mt-2 text-[11.5px] italic" style={{ color: "var(--nx-text-muted)" }}>
                {data.kpi5.apparentCreationLagDisclaimer}
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
