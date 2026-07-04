"use client";

import { useEffect, useState } from "react";
import { HorizontalBarChart } from "@/components/HorizontalBarChart";
import { AfterHoursFilterBar, type AfterHoursFilterValues } from "./AfterHoursFilterBar";
import { AfterHoursKpiGrid } from "./AfterHoursKpiGrid";
import { AfterHoursDetailTable } from "./AfterHoursDetailTable";
import { AfterHoursByPeriodChart } from "./AfterHoursByPeriodChart";
import { ConfidenceDistributionChart } from "./ConfidenceDistributionChart";
import type { AfterHoursByDimensionRow, AfterHoursSummary, ConfidenceDistributionRow } from "@/types/after-hours";

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

// Orquestador de /dashboard/after-hours: filtros compartidos -> KPIs ->
// gráficos -> tabla de detalle, todo en una sola página (sin tabs, a
// diferencia de Auditoría/Dashboard Operacional) - ver
// docs/AFTER_HOURS_METRICS.md.
export function AfterHoursShell() {
  const [filters, setFilters] = useState<AfterHoursFilterValues>({});
  const [summary, setSummary] = useState<AfterHoursSummary | null>(null);
  const [byClient, setByClient] = useState<AfterHoursByDimensionRow[]>([]);
  const [byTaskType, setByTaskType] = useState<AfterHoursByDimensionRow[]>([]);
  const [byTechnician, setByTechnician] = useState<AfterHoursByDimensionRow[]>([]);
  const [byPeriod, setByPeriod] = useState<AfterHoursByDimensionRow[]>([]);
  const [confidenceDistribution, setConfidenceDistribution] = useState<ConfidenceDistributionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const query = toQuery({
      client: filters.client,
      technician: filters.technician,
      taskType: filters.taskType,
      from: filters.from,
      to: filters.to,
      confidenceLevel: filters.confidenceLevel,
      onlyAfterHours: filters.onlyAfterHours,
      onlyLowConfidence: filters.onlyLowConfidence
    });

    setLoading(true);

    Promise.all([
      fetch(`/api/dashboard/after-hours/summary?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/by-client?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/by-task-type?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/by-technician?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/by-period?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/confidence-distribution?${query}`).then(res => res.json())
    ])
      .then(([summaryBody, clientBody, taskTypeBody, technicianBody, periodBody, confidenceBody]) => {
        setSummary(summaryBody);
        setByClient(clientBody.rows ?? []);
        setByTaskType(taskTypeBody.rows ?? []);
        setByTechnician(technicianBody.rows ?? []);
        setByPeriod(periodBody.rows ?? []);
        setConfidenceDistribution(confidenceBody.rows ?? []);
      })
      .finally(() => setLoading(false));
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
