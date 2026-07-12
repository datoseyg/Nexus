"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/components/ui/MetricCard";
import { HorizontalBarChart } from "@/components/HorizontalBarChart";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageContainer } from "@/components/ui/PageContainer";
import { PageHeader } from "@/components/ui/PageHeader";

interface DashboardData {
  kpis: Record<string, number> | null;
  dataQuality: Array<{ report_quality_status: string; report_count: number }>;
  reportsByClient: Array<{ client_name: string; total_reports: number }>;
  partsConsumptionByClient: Array<{ client_name: string; used_parts_count: number }>;
  topEquipmentByParts: Array<{ equipment_internal_id: string; used_parts_count: number }>;
}

const KPI_FIELDS: Array<{ key: string; label: string }> = [
  { key: "total_fieldbeat_reports", label: "Total reportes FieldBeat" },
  { key: "reports_with_used_parts", label: "Reportes con repuestos" },
  { key: "total_used_parts", label: "Total repuestos usados" },
  { key: "matched_used_parts", label: "Repuestos matcheados" },
  { key: "unmatched_used_parts", label: "Repuestos sin match" },
  { key: "placeholder_used_parts", label: "Repuestos placeholder" },
  { key: "ambiguous_used_parts", label: "Repuestos ambiguos" }
];

export default function FieldBeatDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/dashboard/fieldbeat")
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw body;
        if (!cancelled) setData(body);
      })
      .catch(body => {
        if (!cancelled) setError({ message: body?.error ?? "Error desconocido", code: body?.code });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <PageContainer>
        <p style={{ color: "var(--text-muted)" }}>Cargando dashboard…</p>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorBanner message={error.message} code={error.code} />
      </PageContainer>
    );
  }

  if (!data) return null;

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Dashboard Operacional FieldBeat"
          description={
            <>
              Universo report-céntrico completo: {data.kpis?.total_fieldbeat_reports?.toLocaleString("es-CL") ?? "-"}{" "}
              reportes FieldBeat, con o sin ticket Zendesk. Ver{" "}
              <a href="../../../../docs/SCOPE_AND_LIMITATIONS.md" style={{ color: "var(--eyg-green-dark)" }}>
                alcance y limitaciones
              </a>
              .
            </>
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {KPI_FIELDS.map(field => (
            <MetricCard key={field.key} label={field.label} value={data.kpis?.[field.key] ?? null} />
          ))}
        </div>

        {data.dataQuality.length > 0 && (
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
            <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Reportes por estado de calidad de dato
            </h3>
            <div className="flex flex-wrap gap-4 text-sm">
              {data.dataQuality.map(row => (
                <div key={row.report_quality_status} className="flex items-baseline gap-1">
                  <span className="tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                    {row.report_count.toLocaleString("es-CL")}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>{row.report_quality_status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <HorizontalBarChart
            title="Reportes por cliente (top 10)"
            data={data.reportsByClient}
            categoryKey="client_name"
            valueKey="total_reports"
            valueLabel="Reportes"
          />
          <HorizontalBarChart
            title="Consumo de repuestos por cliente (top 10)"
            data={data.partsConsumptionByClient}
            categoryKey="client_name"
            valueKey="used_parts_count"
            valueLabel="Repuestos"
          />
          <HorizontalBarChart
            title="Equipos con más consumo (top 10)"
            data={data.topEquipmentByParts}
            categoryKey="equipment_internal_id"
            valueKey="used_parts_count"
            valueLabel="Repuestos"
          />
        </div>
      </div>
    </PageContainer>
  );
}
