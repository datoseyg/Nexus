"use client";

import { useEffect, useState } from "react";
import { HorizontalBarChart } from "@/components/HorizontalBarChart";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AfterHoursFilterBar, type AfterHoursFilterValues } from "./AfterHoursFilterBar";
import { AfterHoursKpiGrid } from "./AfterHoursKpiGrid";
import { AfterHoursDetailTable } from "./AfterHoursDetailTable";
import { AfterHoursByPeriodChart } from "./AfterHoursByPeriodChart";
import { ConfidenceDistributionChart } from "./ConfidenceDistributionChart";
import {
  getAfterHoursSummary,
  getAfterHoursByClient,
  getAfterHoursByTaskType,
  getAfterHoursByTechnician,
  getAfterHoursByPeriod,
  getAfterHoursConfidenceDistribution
} from "@/lib/data-client";
import type { AfterHoursByDimensionRow, AfterHoursSummary, ConfidenceDistributionRow } from "@/types/after-hours";

// Orquestador de /dashboard/after-hours: filtros compartidos -> KPIs ->
// gráficos -> tabla de detalle, todo en una sola página (sin tabs, a
// diferencia de Auditoría/Dashboard Operacional) - ver
// docs/AFTER_HOURS_METRICS.md. Pega contra /api/dashboard/after-hours/*
// (local-duckdb) o /api/d1/after-hours/* (d1) vía lib/data-client.ts, según
// NEXT_PUBLIC_DATA_MODE - ver docs/CLOUDFLARE_D1_MIGRATION.md.
export function AfterHoursShell() {
  const [filters, setFilters] = useState<AfterHoursFilterValues>({});
  const [summary, setSummary] = useState<AfterHoursSummary | null>(null);
  const [byClient, setByClient] = useState<AfterHoursByDimensionRow[]>([]);
  const [byTaskType, setByTaskType] = useState<AfterHoursByDimensionRow[]>([]);
  const [byTechnician, setByTechnician] = useState<AfterHoursByDimensionRow[]>([]);
  const [byPeriod, setByPeriod] = useState<AfterHoursByDimensionRow[]>([]);
  const [confidenceDistribution, setConfidenceDistribution] = useState<ConfidenceDistributionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getAfterHoursSummary(filters),
      getAfterHoursByClient(filters),
      getAfterHoursByTaskType(filters),
      getAfterHoursByTechnician(filters),
      getAfterHoursByPeriod(filters),
      getAfterHoursConfidenceDistribution(filters)
    ])
      .then(([summaryBody, clientBody, taskTypeBody, technicianBody, periodBody, confidenceBody]) => {
        if (cancelled) return;
        setSummary(summaryBody as unknown as AfterHoursSummary);
        setByClient((clientBody.rows as AfterHoursByDimensionRow[]) ?? []);
        setByTaskType((taskTypeBody.rows as AfterHoursByDimensionRow[]) ?? []);
        setByTechnician((technicianBody.rows as AfterHoursByDimensionRow[]) ?? []);
        setByPeriod((periodBody.rows as AfterHoursByDimensionRow[]) ?? []);
        setConfidenceDistribution((confidenceBody.rows as ConfidenceDistributionRow[]) ?? []);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters]);

  function handleChange(key: keyof AfterHoursFilterValues, value: string) {
    setFilters(prev => ({ ...prev, [key]: value || undefined }));
  }

  return (
    <div className="space-y-4">
      <AfterHoursFilterBar
        clientes={summary?.filterOptions.clientes ?? []}
        tecnicos={summary?.filterOptions.tecnicos ?? []}
        tiposTarea={summary?.filterOptions.tiposTarea ?? []}
        values={filters}
        onChange={handleChange}
        onClear={() => setFilters({})}
      />

      {error && <ErrorBanner message={error} />}

      <AfterHoursKpiGrid summary={summary} loading={loading} />

      <div className="grid gap-4 lg:grid-cols-2">
        <AfterHoursByPeriodChart data={byPeriod} />
        <ConfidenceDistributionChart data={confidenceDistribution} />
        <HorizontalBarChart
          title="Top clientes por horas fuera de horario"
          data={byClient.slice(0, 10) as unknown as Record<string, unknown>[]}
          categoryKey="key"
          valueKey="after_hours_total_hours"
          valueLabel="Horas fuera de horario"
        />
        <HorizontalBarChart
          title="Horas fuera de horario por tipo de tarea"
          data={byTaskType as unknown as Record<string, unknown>[]}
          categoryKey="key"
          valueKey="after_hours_total_hours"
          valueLabel="Horas fuera de horario"
        />
        <HorizontalBarChart
          title="Horas fuera de horario por técnico"
          data={byTechnician.slice(0, 15) as unknown as Record<string, unknown>[]}
          categoryKey="key"
          valueKey="after_hours_total_hours"
          valueLabel="Horas fuera de horario"
        />
      </div>

      <AfterHoursDetailTable filters={filters} />
    </div>
  );
}
